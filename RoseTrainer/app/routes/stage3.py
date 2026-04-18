import asyncio
import json

from pathlib import Path
from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sse_starlette.sse import EventSourceResponse

from app.database import get_db, get_pool
from app.providers import complete_chat

router = APIRouter()
templates: Jinja2Templates | None = None

_QUESTIONS: list[dict] = []
_DATA_DIR = Path(__file__).parent.parent.parent / "data"
_collection_queues: dict[int, asyncio.Queue] = {}


def set_templates(t: Jinja2Templates):
    global templates
    templates = t


def _load_questions() -> list[dict]:
    global _QUESTIONS
    if not _QUESTIONS:
        path = _DATA_DIR / "chat_questions.json"
        data = json.loads(path.read_text())
        for cat in data["categories"].values():
            _QUESTIONS.extend(cat["questions"])
    return _QUESTIONS


@router.get("/models/{model_id}/stage/3")
async def stage3_page(request: Request, model_id: int, db=Depends(get_db)):
    model = await db.fetchrow("SELECT * FROM trainer_models WHERE id = $1", model_id)
    creds_rows = await db.fetch("SELECT * FROM provider_credentials ORDER BY provider")
    questions = _load_questions()
    collected = await db.fetchval(
        "SELECT COUNT(*) FROM training_data WHERE model_id = $1 AND stage = 3 AND deleted = FALSE",
        model_id,
    )
    creds = []
    for r in creds_rows:
        c = dict(r)
        if isinstance(c.get("models_json"), str):
            c["models_json"] = json.loads(c["models_json"])
        creds.append(c)
    return templates.TemplateResponse(request, "stage3.html", {
        "model": dict(model),
        "creds": creds,
        "question_count": len(questions),
        "collected": collected,
    })


@router.post("/models/{model_id}/stage/3/collect")
async def start_collection(
    request: Request,
    model_id: int,
    db=Depends(get_db),
):
    form = await request.form()
    selected = form.getlist("models")  # list of "provider:model_id" strings

    questions = _load_questions()

    # Load credentials upfront while request connection is live
    creds_rows = await db.fetch("SELECT * FROM provider_credentials")
    creds_map = {r["provider"]: dict(r) for r in creds_rows}

    queue: asyncio.Queue = asyncio.Queue()
    _collection_queues[model_id] = queue

    async def _collect():
        # Acquire a fresh connection — request connection is released after response
        async with get_pool().acquire() as conn:
            await conn.execute(
                "UPDATE growth_stages SET status = 'in_progress' WHERE model_id = $1 AND stage = 3",
                model_id,
            )
            total = len(questions) * len(selected)
            done = 0
            for provider_model in selected:
                provider, model_name = provider_model.split(":", 1)
                cred = creds_map.get(provider, {})
                api_key = cred.get("api_key")
                base_url = cred.get("base_url")
                source = f"{provider}/{model_name}"

                for q in questions:
                    try:
                        output, _ = await complete_chat(
                            provider=provider,
                            model=model_name,
                            messages=[{"role": "user", "content": q["text"]}],
                            api_key=api_key,
                            base_url=base_url,
                        )
                        await conn.execute(
                            """
                            INSERT INTO training_data (model_id, stage, source, input, thinking, output)
                            VALUES ($1, 3, $2, $3, '', $4)
                            """,
                            model_id, source, q["text"], output,
                        )
                        done += 1
                        await queue.put({"type": "progress", "done": done, "total": total, "source": source, "question": q["text"][:60]})
                    except Exception as e:
                        done += 1
                        await queue.put({"type": "error", "source": source, "question": q["text"][:60], "error": str(e)})

            await conn.execute(
                "UPDATE growth_stages SET status = 'complete', completed_at = now() WHERE model_id = $1 AND stage = 3",
                model_id,
            )
            await queue.put({"type": "done", "total": done})

    asyncio.create_task(_collect())
    return {"ok": True}


@router.get("/models/{model_id}/stage/3/stream")
async def collection_stream(model_id: int, request: Request):
    queue = _collection_queues.get(model_id)
    if not queue:
        queue = asyncio.Queue()
        _collection_queues[model_id] = queue

    async def generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=2.0)
            except asyncio.TimeoutError:
                yield {"data": json.dumps({"type": "heartbeat"})}
                continue
            yield {"data": json.dumps(event)}
            if event.get("type") == "done":
                break

    return EventSourceResponse(generator())
