import logging
from datetime import datetime, timezone
from typing import Union

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from roseobservability.models import IngestBatch, IngestEvent, IngestResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _ts(value) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _roselibrary_summary(payload: dict) -> dict:
    return {
        "query": payload.get("query"),
        "response_summary": payload.get("response_summary"),
        "method": payload.get("method"),
    }


def _write_event(db, event: IngestEvent):
    ts = _ts(event.timestamp)
    db.insert_event(
        trace_id=event.trace_id,
        service=event.service,
        event_type=event.event_type,
        seq=event.seq,
        timestamp=ts,
        duration_ms=event.duration_ms,
        payload=event.payload,
    )

    if event.event_type == "request" and event.service == "roselibrary":
        status_code = event.payload.get("status_code")
        status = "ok" if (status_code is None or 200 <= status_code < 400) else "error"
        db.upsert_request_end(
            trace_id=event.trace_id,
            service=event.service,
            endpoint=event.payload.get("endpoint") or "",
            started_at=ts,
            ended_at=ts,
            duration_ms=event.duration_ms,
            status=status,
            status_code=status_code,
            summary=_roselibrary_summary(event.payload),
        )


@router.post("/ingest/events", response_model=IngestResponse)
async def ingest_events(body: Union[IngestEvent, IngestBatch], request: Request):
    db = request.app.state.db
    events = body.events if isinstance(body, IngestBatch) else [body]

    def _write_all():
        for e in events:
            try:
                _write_event(db, e)
            except Exception:
                logger.exception("Failed to write event for trace %s", e.trace_id)

    await run_in_threadpool(_write_all)
    return IngestResponse(accepted=len(events))
