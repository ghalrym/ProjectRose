"""Admin Web UI mounted at /admin.

Server-rendered HTML (Jinja2) with HTMX for light interactivity. No build step,
no JS bundler, no auth — bound to 127.0.0.1 only.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

templates = Jinja2Templates(directory=TEMPLATES_DIR)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "home.html")


# Mount sub-routers at the end (imports below avoid circular refs).
from app.webui import routes_config  # noqa: E402
from app.webui import routes_prompts  # noqa: E402
from app.webui import routes_reindex  # noqa: E402

router.include_router(routes_config.router)
router.include_router(routes_prompts.router)
router.include_router(routes_reindex.router)


def mount_static(app) -> None:
    """Mount /admin/static on the FastAPI app. Called from main.py."""
    os.makedirs(STATIC_DIR, exist_ok=True)
    app.mount("/admin/static", StaticFiles(directory=STATIC_DIR), name="admin_static")


__all__ = ["router", "templates", "mount_static"]
