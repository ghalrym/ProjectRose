import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request

from app.knowledge import index_knowledge
from app.observability import new_trace_id
from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await index_knowledge()
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

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8010, reload=True)
