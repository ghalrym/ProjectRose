import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from roselibrary import __version__
from roselibrary.config import get_settings
from roselibrary.instrumentation.observability import emit, forget_trace, new_trace_id
from roselibrary.project_store import ProjectStoreManager, is_valid_project_id

logger = logging.getLogger("roselibrary")

PROJECT_ID_HEADER = "X-Project-Id"

# Paths that don't require a project context.
PROJECT_EXEMPT_PATHS = {"/", "/docs", "/redoc", "/openapi.json"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    data_dir = Path(settings.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    app.state.settings = settings

    from roselibrary.indexing.embeddings import EmbeddingService
    from roselibrary.parsing.parser import CodeParser
    from roselibrary.parsing.references import ReferenceExtractor

    app.state.project_manager = ProjectStoreManager(data_dir)
    app.state.parser = CodeParser()
    app.state.ref_extractor = ReferenceExtractor()

    embedding_service = EmbeddingService(
        settings.ollama_base_url, settings.ollama_embedding_model
    )
    app.state.embedding_service = embedding_service

    logger.info("RoseLibrary %s started (data_dir=%s)", __version__, data_dir)
    yield

    await embedding_service.close()
    app.state.project_manager.close_all()


app = FastAPI(title="RoseLibrary", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


RICH_INSTRUMENTED_PATHS = {"/search", "/update-files"}


@app.middleware("http")
async def resolve_project(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or path in PROJECT_EXEMPT_PATHS:
        return await call_next(request)

    project_id = request.headers.get(PROJECT_ID_HEADER)
    if not project_id:
        return JSONResponse(
            {"detail": f"Missing required header: {PROJECT_ID_HEADER}"},
            status_code=400,
        )
    if not is_valid_project_id(project_id):
        return JSONResponse(
            {"detail": f"Invalid {PROJECT_ID_HEADER} format"},
            status_code=400,
        )

    store = request.app.state.project_manager.get(project_id)
    request.state.project_id = project_id
    request.state.db = store.db
    request.state.vectorstore = store.vectorstore
    return await call_next(request)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    trace_id = request.headers.get("X-Trace-Id") or new_trace_id()
    request.state.trace_id = trace_id
    request.state.observability_emitted = False
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Trace-Id"] = trace_id
    logger.info(
        "%s %s -> %s (%.1fms)",
        request.method, request.url.path, response.status_code, duration_ms,
    )
    path = request.url.path
    if path not in RICH_INSTRUMENTED_PATHS and not getattr(
        request.state, "observability_emitted", False
    ):
        emit(
            "request",
            {
                "endpoint": path,
                "method": request.method,
                "status_code": response.status_code,
                "query": {},
                "response_summary": {},
            },
            trace_id,
            duration_ms=duration_ms,
        )
        forget_trace(trace_id)
    return response


from roselibrary.routes.check import router as check_router
from roselibrary.routes.clear import router as clear_router
from roselibrary.routes.overview import router as overview_router
from roselibrary.routes.references import router as references_router
from roselibrary.routes.search import router as search_router
from roselibrary.routes.status import router as status_router
from roselibrary.routes.update import router as update_router

app.include_router(check_router)
app.include_router(update_router)
app.include_router(status_router)
app.include_router(search_router)
app.include_router(references_router)
app.include_router(clear_router)
app.include_router(overview_router)


@app.get("/")
async def health():
    return {"name": "RoseLibrary", "version": __version__}


def run():
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    uvicorn.run("roselibrary.main:app", host=settings.host, port=settings.port)
