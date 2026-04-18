import json
from pathlib import Path
from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.database import get_db
from app.providers import complete_chat

router = APIRouter()
templates: Jinja2Templates | None = None

_DATA_DIR = Path(__file__).parent.parent.parent / "data"


def set_templates(t: Jinja2Templates):
    global templates
    templates = t


def _load_questionnaire() -> list[dict]:
    path = _DATA_DIR / "questionnaire.json"
    return json.loads(path.read_text())


SYNTHESIS_SYSTEM = """You are a persona architect. A user has answered a set of questions describing the AI they want to build. Your job is to synthesize their answers into a structured AGENTS.md that will define that AI's identity and behavior.

The answers describe the AI — how it should communicate, how it should think, how it should handle uncertainty, failure, and frustration. Treat every answer as a design decision about the AI, not a description of the person answering. Derive the persona name from metaphors and images the user used to describe their AI.

The AGENTS.md must include these sections:
1. **Persona Name** — derived from metaphors or images in their answers, not literally stated
2. **Communication Style** — one or two sentences on tone, register, and how it presents information
3. **Verbosity** — a rating from 1 (very terse) to 5 (very verbose) with a brief explanation
4. **Emotional Register** — how this AI handles emotions, frustration, and warmth in conversation
5. **Primary Thinking Strategy** — exactly one of: Root Cause Analysis, First Principles, Divide & Conquer, Brainstorming, Trial & Error, Systems Thinking, Analogy Mapping
6. **Fallback Thinking Strategy** — a different one from the same list, used when the primary fails
7. **Uncertainty Behavior** — how this AI behaves when it doesn't know something
8. **Persona Voice** — 3-4 sentences written in first person as the AI itself, describing how it operates

Return only the AGENTS.md content, starting with a markdown heading."""


@router.get("/models/{model_id}/stage/2")
async def stage2_form(request: Request, model_id: int, db=Depends(get_db)):
    model = await db.fetchrow("SELECT * FROM trainer_models WHERE id = $1", model_id)
    questionnaire = _load_questionnaire()
    existing = await db.fetch(
        "SELECT question_id, answer FROM questionnaire_responses WHERE model_id = $1", model_id
    )
    existing_map = {r["question_id"]: r["answer"] for r in existing}
    stage = await db.fetchrow(
        "SELECT * FROM growth_stages WHERE model_id = $1 AND stage = 2", model_id
    )
    return templates.TemplateResponse(request, "stage2.html", {
        "model": dict(model),
        "questionnaire": questionnaire,
        "existing": existing_map,
        "stage": dict(stage) if stage else {},
        "agents_md": model["agents_md"],
    })


@router.post("/models/{model_id}/stage/2")
async def stage2_submit(request: Request, model_id: int, db=Depends(get_db)):
    form = await request.form()
    questionnaire = _load_questionnaire()

    async with db.transaction():
        await db.execute(
            "UPDATE growth_stages SET status = 'in_progress' WHERE model_id = $1 AND stage = 2",
            model_id,
        )
        for q in questionnaire:
            answer = (form.get(q["id"]) or "").strip()
            if not answer:
                continue
            await db.execute(
                """
                INSERT INTO questionnaire_responses (model_id, question_id, question, answer)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (model_id, question_id) DO UPDATE
                  SET answer = EXCLUDED.answer
                """,
                model_id, q["id"], q["question"], answer,
            )

    # Synthesize AGENTS.md
    responses = await db.fetch(
        "SELECT question_id, question, answer FROM questionnaire_responses WHERE model_id = $1 ORDER BY question_id",
        model_id,
    )
    creds = await db.fetch("SELECT * FROM provider_credentials LIMIT 1")
    agents_md = ""

    if responses and creds:
        cred = dict(creds[0])
        messages_content = "Here are the questionnaire responses:\n\n"
        for r in responses:
            messages_content += f"**{r['question']}**\n{r['answer']}\n\n"
        messages_content += "\nPlease produce the AGENTS.md file."

        model_row = await db.fetchrow("SELECT * FROM trainer_models WHERE id = $1", model_id)
        models_list = json.loads(cred.get("models_json") or "[]")
        if models_list:
            selected_model = models_list[0]
            try:
                agents_md, _ = await complete_chat(
                    provider=cred["provider"],
                    model=selected_model,
                    messages=[{"role": "user", "content": messages_content}],
                    api_key=cred.get("api_key"),
                    base_url=cred.get("base_url"),
                    system=SYNTHESIS_SYSTEM,
                )
            except Exception as e:
                agents_md = f"# AGENTS.md\n\n*Synthesis failed: {e}*\n\nPlease edit manually."

    if agents_md:
        await db.execute(
            "UPDATE trainer_models SET agents_md = $1, updated_at = now() WHERE id = $2",
            agents_md, model_id,
        )

    await db.execute(
        "UPDATE growth_stages SET status = 'complete', completed_at = now() WHERE model_id = $1 AND stage = 2",
        model_id,
    )
    return RedirectResponse(f"/trainer/models/{model_id}/stage/3", status_code=303)
