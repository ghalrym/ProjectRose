"""Manual reindex trigger."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from app.knowledge import _reset_collection, index_knowledge

router = APIRouter()


@router.post("/reindex")
async def reindex():
    _reset_collection()
    await index_knowledge()
    return RedirectResponse(url="/admin/?reindexed=1", status_code=303)
