import json
import logging
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT NOT NULL,
    service TEXT NOT NULL,
    event_type TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    timestamp TEXT NOT NULL,
    duration_ms REAL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_service_ts ON events(service, timestamp DESC);

CREATE TABLE IF NOT EXISTS requests (
    trace_id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms REAL,
    status TEXT NOT NULL,
    status_code INTEGER,
    summary_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_requests_service_started ON requests(service, started_at DESC);
"""


class Database:
    def __init__(self, data_dir: Path, max_payload_bytes: int = 65536):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / "roseobservability.db"
        self.max_payload_bytes = max_payload_bytes
        self.conn = sqlite3.connect(
            self.path,
            check_same_thread=False,
            isolation_level=None,
        )
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self._lock = threading.Lock()
        self._init_schema()

    def _init_schema(self):
        with self._lock:
            self.conn.executescript(SCHEMA)

    def close(self):
        with self._lock:
            self.conn.close()

    def _truncate_payload(self, payload: dict) -> str:
        text = json.dumps(payload, default=str)
        if len(text.encode("utf-8")) > self.max_payload_bytes:
            truncated = text.encode("utf-8")[: self.max_payload_bytes].decode(
                "utf-8", errors="ignore"
            )
            return json.dumps({"_truncated": True, "partial": truncated})
        return text

    def insert_event(
        self,
        trace_id: str,
        service: str,
        event_type: str,
        seq: int,
        timestamp: str,
        duration_ms: float | None,
        payload: dict,
    ):
        with self._lock:
            self.conn.execute(
                "INSERT INTO events(trace_id, service, event_type, seq, timestamp, duration_ms, payload) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    trace_id,
                    service,
                    event_type,
                    seq,
                    timestamp,
                    duration_ms,
                    self._truncate_payload(payload),
                ),
            )

    def upsert_request_start(
        self,
        trace_id: str,
        service: str,
        endpoint: str,
        started_at: str,
        summary: dict,
    ):
        with self._lock:
            self.conn.execute(
                "INSERT INTO requests(trace_id, service, endpoint, started_at, status, summary_json) "
                "VALUES (?, ?, ?, ?, 'running', ?) "
                "ON CONFLICT(trace_id) DO UPDATE SET "
                "service=excluded.service, endpoint=excluded.endpoint, "
                "started_at=excluded.started_at, summary_json=excluded.summary_json",
                (trace_id, service, endpoint, started_at, json.dumps(summary, default=str)),
            )

    def upsert_request_end(
        self,
        trace_id: str,
        service: str,
        endpoint: str,
        started_at: str,
        ended_at: str,
        duration_ms: float | None,
        status: str,
        status_code: int | None,
        summary: dict,
    ):
        with self._lock:
            existing = self.conn.execute(
                "SELECT summary_json, started_at FROM requests WHERE trace_id=?",
                (trace_id,),
            ).fetchone()
            if existing:
                try:
                    merged = json.loads(existing["summary_json"])
                except Exception:
                    merged = {}
                merged.update(summary)
                self.conn.execute(
                    "UPDATE requests SET ended_at=?, duration_ms=?, status=?, status_code=?, "
                    "summary_json=?, endpoint=COALESCE(NULLIF(?, ''), endpoint) "
                    "WHERE trace_id=?",
                    (
                        ended_at,
                        duration_ms,
                        status,
                        status_code,
                        json.dumps(merged, default=str),
                        endpoint,
                        trace_id,
                    ),
                )
            else:
                self.conn.execute(
                    "INSERT INTO requests(trace_id, service, endpoint, started_at, ended_at, "
                    "duration_ms, status, status_code, summary_json) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        trace_id,
                        service,
                        endpoint,
                        started_at,
                        ended_at,
                        duration_ms,
                        status,
                        status_code,
                        json.dumps(summary, default=str),
                    ),
                )

    def list_requests(
        self,
        service: str | None,
        status: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        where = []
        params: list[Any] = []
        if service:
            where.append("service = ?")
            params.append(service)
        if status:
            where.append("status = ?")
            params.append(status)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""

        with self._lock:
            total = self.conn.execute(
                f"SELECT COUNT(*) AS n FROM requests {where_sql}", params
            ).fetchone()["n"]

            rows = self.conn.execute(
                f"SELECT trace_id, service, endpoint, started_at, ended_at, duration_ms, "
                f"status, status_code, summary_json FROM requests {where_sql} "
                f"ORDER BY started_at DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()

        items = []
        for r in rows:
            try:
                summary = json.loads(r["summary_json"])
            except Exception:
                summary = {}
            items.append(
                {
                    "trace_id": r["trace_id"],
                    "service": r["service"],
                    "endpoint": r["endpoint"],
                    "started_at": r["started_at"],
                    "ended_at": r["ended_at"],
                    "duration_ms": r["duration_ms"],
                    "status": r["status"],
                    "status_code": r["status_code"],
                    "summary": summary,
                }
            )
        return items, total

    def get_request(self, trace_id: str) -> dict | None:
        with self._lock:
            req_row = self.conn.execute(
                "SELECT trace_id, service, endpoint, started_at, ended_at, duration_ms, "
                "status, status_code, summary_json FROM requests WHERE trace_id=?",
                (trace_id,),
            ).fetchone()
            event_rows = self.conn.execute(
                "SELECT seq, event_type, timestamp, duration_ms, payload FROM events "
                "WHERE trace_id=? ORDER BY timestamp ASC, seq ASC",
                (trace_id,),
            ).fetchall()

        if req_row is None and not event_rows:
            return None

        try:
            summary = json.loads(req_row["summary_json"]) if req_row else {}
        except Exception:
            summary = {}

        events = []
        for e in event_rows:
            try:
                payload = json.loads(e["payload"])
            except Exception:
                payload = {"raw": e["payload"]}
            events.append(
                {
                    "seq": e["seq"],
                    "event_type": e["event_type"],
                    "timestamp": e["timestamp"],
                    "duration_ms": e["duration_ms"],
                    "payload": payload,
                }
            )

        return {
            "request": (
                {
                    "trace_id": req_row["trace_id"],
                    "service": req_row["service"],
                    "endpoint": req_row["endpoint"],
                    "started_at": req_row["started_at"],
                    "ended_at": req_row["ended_at"],
                    "duration_ms": req_row["duration_ms"],
                    "status": req_row["status"],
                    "status_code": req_row["status_code"],
                    "summary": summary,
                }
                if req_row
                else None
            ),
            "events": events,
        }

    def metrics_summary(self, window_minutes: int) -> dict:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
        ).isoformat()

        def _per_service(service: str) -> dict:
            with self._lock:
                base = self.conn.execute(
                    "SELECT COUNT(*) AS count, AVG(duration_ms) AS avg_ms, "
                    "SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS err_count "
                    "FROM requests WHERE service=? AND started_at >= ?",
                    (service, cutoff),
                ).fetchone()
                durations = [
                    r["duration_ms"]
                    for r in self.conn.execute(
                        "SELECT duration_ms FROM requests WHERE service=? AND started_at >= ? "
                        "AND duration_ms IS NOT NULL ORDER BY duration_ms ASC",
                        (service, cutoff),
                    ).fetchall()
                ]
            p95 = None
            if durations:
                idx = max(0, int(len(durations) * 0.95) - 1)
                p95 = durations[idx]
            return {
                "count": base["count"] or 0,
                "avg_duration_ms": base["avg_ms"],
                "p95_duration_ms": p95,
                "error_count": base["err_count"] or 0,
            }

        rm = _per_service("rosemodel")
        rl = _per_service("roselibrary")

        with self._lock:
            tc_row = self.conn.execute(
                "SELECT COUNT(*) AS n FROM events WHERE service='rosemodel' "
                "AND event_type='tool_call' AND timestamp >= ?",
                (cutoff,),
            ).fetchone()
            tokens = self.conn.execute(
                "SELECT summary_json FROM requests WHERE service='rosemodel' AND started_at >= ?",
                (cutoff,),
            ).fetchall()
            searches = self.conn.execute(
                "SELECT COUNT(*) AS n FROM requests WHERE service='roselibrary' "
                "AND endpoint='/search' AND started_at >= ?",
                (cutoff,),
            ).fetchone()
            updates = self.conn.execute(
                "SELECT COUNT(*) AS n FROM requests WHERE service='roselibrary' "
                "AND endpoint='/update-file' AND started_at >= ?",
                (cutoff,),
            ).fetchone()

        total_pt = 0
        total_ct = 0
        for row in tokens:
            try:
                s = json.loads(row["summary_json"])
                usage = s.get("usage") or {}
                total_pt += int(usage.get("prompt_tokens") or 0)
                total_ct += int(usage.get("completion_tokens") or 0)
            except Exception:
                continue

        rm["total_tool_calls"] = tc_row["n"] or 0
        rm["total_prompt_tokens"] = total_pt
        rm["total_completion_tokens"] = total_ct
        rl["searches_count"] = searches["n"] or 0
        rl["updates_count"] = updates["n"] or 0

        return {"rosemodel": rm, "roselibrary": rl, "window_minutes": window_minutes}

    def library_searches(self, limit: int) -> dict:
        with self._lock:
            rows = self.conn.execute(
                "SELECT trace_id, started_at, duration_ms, summary_json FROM requests "
                "WHERE service='roselibrary' AND endpoint='/search' "
                "ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()

        items = []
        latency_series = []
        for r in rows:
            try:
                s = json.loads(r["summary_json"])
            except Exception:
                s = {}
            q = s.get("query") or {}
            query_text = q.get("query") if isinstance(q, dict) else None
            rs = s.get("response_summary") or {}
            results_count = rs.get("results_count") if isinstance(rs, dict) else None
            items.append(
                {
                    "trace_id": r["trace_id"],
                    "timestamp": r["started_at"],
                    "query": query_text,
                    "results_count": results_count,
                    "duration_ms": r["duration_ms"],
                }
            )
            latency_series.append(
                {"t": r["started_at"], "duration_ms": r["duration_ms"]}
            )
        # Chronological order for the chart
        latency_series.reverse()
        return {"items": items, "latency_series": latency_series}

    def retention_sweep(self, days: int):
        if days <= 0:
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        with self._lock:
            self.conn.execute("DELETE FROM events WHERE timestamp < ?", (cutoff,))
            self.conn.execute("DELETE FROM requests WHERE started_at < ?", (cutoff,))
