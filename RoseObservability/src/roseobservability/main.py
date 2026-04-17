import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from roseobservability import __version__
from roseobservability.config import get_settings
from roseobservability.db import Database
from roseobservability.routes.ingest import router as ingest_router
from roseobservability.routes.query import router as query_router

logger = logging.getLogger("roseobservability")

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    data_dir = Path(settings.data_dir)
    db = Database(data_dir, max_payload_bytes=settings.max_payload_bytes)
    db.retention_sweep(settings.retention_days)
    app.state.db = db
    app.state.settings = settings
    logger.info("RoseObservability %s started (data_dir=%s)", __version__, data_dir)
    yield
    db.close()


app = FastAPI(title="RoseObservability", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(query_router)


@app.get("/healthz")
async def health():
    return {"name": "RoseObservability", "version": __version__}


@app.get("/request/{trace_id}")
async def request_detail_page(trace_id: str):
    path = STATIC_DIR / "request-detail.html"
    if not path.is_file():
        return {"error": "dashboard not built"}
    return FileResponse(path)


@app.get("/library")
async def library_page():
    path = STATIC_DIR / "library.html"
    if not path.is_file():
        return {"error": "dashboard not built"}
    return FileResponse(path)


if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


def run():
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    uvicorn.run(
        "roseobservability.main:app", host=settings.host, port=settings.port
    )
