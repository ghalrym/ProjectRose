import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request

from app.conversation_log import init_db as init_conversation_db
from app.knowledge import index_knowledge
from app.migrate import migrate_skills_to_categories
from app.observability import new_trace_id
from app.routes import router
from app.webui import router as admin_router, mount_static


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_conversation_db()
    result = migrate_skills_to_categories()
    if result["moved"]:
        print(f"Migrated {result['moved']} flat skill file(s) into prompts/skills/general/")
    try:
        await index_knowledge()
    except Exception as e:
        # Don't block startup — admin UI needs to be reachable so the user can
        # fix a bad embedding config. Reindex can be triggered manually from
        # /admin/ once the backend is reachable.
        print(f"[startup] knowledge indexing skipped: {type(e).__name__}: {e}")
    yield


app = FastAPI(title="RoseModel", lifespan=lifespan)


@app.middleware("http")
async def trace_middleware(request: Request, call_next):
    trace_id = request.headers.get("X-Trace-Id") or new_trace_id()
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response


app.include_router(router)
app.include_router(admin_router)
mount_static(app)

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8010, reload=True)
