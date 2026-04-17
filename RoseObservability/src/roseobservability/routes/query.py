from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

router = APIRouter()


@router.get("/api/requests")
async def list_requests(
    request: Request,
    service: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    db = request.app.state.db
    items, total = await run_in_threadpool(
        db.list_requests, service, status, limit, offset
    )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/api/requests/{trace_id}")
async def get_request(request: Request, trace_id: str):
    db = request.app.state.db
    result = await run_in_threadpool(db.get_request, trace_id)
    if result is None:
        raise HTTPException(404, detail="trace_id not found")
    return result


@router.get("/api/metrics/summary")
async def metrics_summary(request: Request, window_minutes: int = 60):
    window_minutes = max(1, min(window_minutes, 24 * 60 * 7))
    db = request.app.state.db
    return await run_in_threadpool(db.metrics_summary, window_minutes)


@router.get("/api/library/searches")
async def library_searches(request: Request, limit: int = 100):
    limit = max(1, min(limit, 500))
    db = request.app.state.db
    return await run_in_threadpool(db.library_searches, limit)
