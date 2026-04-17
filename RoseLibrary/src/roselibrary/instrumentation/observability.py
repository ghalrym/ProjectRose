import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _get_url() -> str:
    return os.environ.get("ROSE_OBSERVABILITY_URL", "").rstrip("/")


_client: Optional[httpx.AsyncClient] = None
_seq: dict[str, int] = {}


def new_trace_id() -> str:
    return uuid.uuid4().hex


def _next_seq(trace_id: str) -> int:
    n = _seq.get(trace_id, 0) + 1
    _seq[trace_id] = n
    return n


def _client_instance() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=2.0)
    return _client


async def _post(url: str, event: dict):
    try:
        client = _client_instance()
        await client.post(f"{url}/ingest/events", json=event)
    except Exception as e:
        logger.debug("observability post failed: %s", e)


def emit(
    event_type: str,
    payload: dict,
    trace_id: str,
    duration_ms: float | None = None,
):
    url = _get_url()
    if not url or not trace_id:
        return
    event = {
        "trace_id": trace_id,
        "service": "roselibrary",
        "event_type": event_type,
        "seq": _next_seq(trace_id),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "payload": payload,
    }
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_post(url, event))
    except RuntimeError:
        logger.debug("no running loop for observability emit")


def forget_trace(trace_id: str):
    _seq.pop(trace_id, None)
