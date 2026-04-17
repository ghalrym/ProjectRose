import random
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from roselibrary import __version__
from roselibrary.config import Settings
from roselibrary.indexing.embeddings import EmbeddingService
from roselibrary.main import PROJECT_EXEMPT_PATHS, PROJECT_ID_HEADER
from roselibrary.parsing.parser import CodeParser
from roselibrary.parsing.references import ReferenceExtractor
from roselibrary.project_store import ProjectStoreManager, is_valid_project_id

TEST_PROJECT_ID = "test-project"


@pytest.fixture
def tmp_data_dir(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def settings(tmp_data_dir):
    return Settings(data_dir=str(tmp_data_dir))


def _fake_embed(texts: list[str]) -> list[list[float]]:
    """Generate deterministic fake embeddings based on text content."""
    results = []
    for text in texts:
        seed = hash(text) & 0xFFFFFFFF
        rng = random.Random(seed)
        vec = [rng.gauss(0, 1) for _ in range(1024)]
        norm = sum(x * x for x in vec) ** 0.5
        results.append([x / norm for x in vec])
    return results


async def _fake_generate(name, qualified_name, symbol_type, parameters, docstring, source_code):
    meta_text = f"{symbol_type} {qualified_name}"
    code_text = source_code
    meta_vec = _fake_embed([meta_text])[0]
    code_vec = _fake_embed([code_text])[0]
    return [(meta_text, meta_vec)], [(code_text, code_vec)]


@pytest.fixture
async def client(settings):
    app = FastAPI(title="RoseLibrary", version=__version__)

    data_dir = Path(settings.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    manager = ProjectStoreManager(data_dir)
    app.state.project_manager = manager
    app.state.settings = settings
    app.state.parser = CodeParser()
    app.state.ref_extractor = ReferenceExtractor()

    embedding_service = EmbeddingService.__new__(EmbeddingService)
    embedding_service.model = "test"
    embedding_service.embed = AsyncMock(side_effect=_fake_embed)
    embedding_service.generate_symbol_embeddings = _fake_generate
    app.state.embedding_service = embedding_service

    @app.middleware("http")
    async def resolve_project(request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or path in PROJECT_EXEMPT_PATHS:
            return await call_next(request)
        project_id = request.headers.get(PROJECT_ID_HEADER)
        if not project_id or not is_valid_project_id(project_id):
            return JSONResponse(
                {"detail": f"Missing or invalid {PROJECT_ID_HEADER}"},
                status_code=400,
            )
        store = request.app.state.project_manager.get(project_id)
        request.state.project_id = project_id
        request.state.db = store.db
        request.state.vectorstore = store.vectorstore
        return await call_next(request)

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

    project_store = manager.get(TEST_PROJECT_ID)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Project-Id": TEST_PROJECT_ID},
    ) as c:
        async def update_file(path: str, content: str):
            return await c.post(
                "/update-files",
                json={"files": [{"path": path, "content": content}]},
            )

        c.update_file = update_file  # type: ignore[attr-defined]
        c.db = project_store.db  # type: ignore[attr-defined]
        c.vectorstore = project_store.vectorstore  # type: ignore[attr-defined]
        yield c

    manager.close_all()
