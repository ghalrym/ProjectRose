import json
import time
import uuid
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse, JSONResponse

from app.database import get_db
from app.training.serving import generate_completion

router = APIRouter()


@router.get("/v1/models")
async def list_models(db=Depends(get_db)):
    rows = await db.fetch(
        """
        SELECT mv.*, tm.name as model_name, tm.size
        FROM model_versions mv
        JOIN trainer_models tm ON tm.id = mv.model_id
        WHERE mv.is_deployed = TRUE
        ORDER BY mv.created_at DESC
        """
    )
    models = []
    for r in rows:
        model_id = f"{r['model_name']}-{r['version']}"
        models.append({
            "id": model_id,
            "object": "model",
            "created": int(r["created_at"].timestamp()),
            "owned_by": "rosetrainer",
        })
    return {"object": "list", "data": models}


@router.post("/v1/chat/completions")
async def chat_completions(request: Request, db=Depends(get_db)):
    body = await request.json()
    model_str = body.get("model", "")
    messages = body.get("messages", [])
    stream = body.get("stream", False)
    max_tokens = body.get("max_tokens", 512)
    temperature = body.get("temperature", 0.8)
    top_p = body.get("top_p", 0.9)

    # Parse "ModelName-v1.000" format
    parts = model_str.rsplit("-", 1)
    if len(parts) != 2:
        return JSONResponse({"error": {"message": "Invalid model format. Use ModelName-v1.000"}}, status_code=400)
    model_name, version = parts[0], parts[1]

    row = await db.fetchrow(
        """
        SELECT mv.checkpoint_path, mv.tokenizer_path, tm.size
        FROM model_versions mv
        JOIN trainer_models tm ON tm.id = mv.model_id
        WHERE tm.name = $1 AND mv.version = $2
        """,
        model_name, version,
    )
    if not row:
        return JSONResponse({"error": {"message": f"Model {model_str} not found"}}, status_code=404)

    text = await generate_completion(
        checkpoint_path=row["checkpoint_path"],
        tokenizer_path=row["tokenizer_path"],
        size=row["size"],
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        top_p=top_p,
        stream=False,
    )

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created = int(time.time())

    if stream:
        def _stream_chunks():
            chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_str,
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(chunk)}\n\n"
            done_chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_str,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(done_chunk)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(_stream_chunks(), media_type="text/event-stream")

    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model_str,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
