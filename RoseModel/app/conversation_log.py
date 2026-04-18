import asyncio
import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "conversations.db")


def _db_path() -> str:
    return os.path.normpath(_DB_PATH)


def init_db() -> None:
    with sqlite3.connect(_db_path()) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id          TEXT    NOT NULL,
                created_at        TEXT    NOT NULL,
                user_message      TEXT    NOT NULL,
                assistant_message TEXT    NOT NULL,
                thinking          TEXT,
                system_prompt     TEXT
            )
        """)
        conn.commit()


async def log_turn(
    trace_id: str,
    user_message: str,
    assistant_message: str,
    thinking: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        _write_turn,
        trace_id,
        now,
        user_message,
        assistant_message,
        thinking,
        system_prompt,
    )


def _write_turn(
    trace_id: str,
    created_at: str,
    user_message: str,
    assistant_message: str,
    thinking: Optional[str],
    system_prompt: Optional[str],
) -> None:
    with sqlite3.connect(_db_path()) as conn:
        conn.execute(
            """
            INSERT INTO conversations
                (trace_id, created_at, user_message, assistant_message, thinking, system_prompt)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (trace_id, created_at, user_message, assistant_message, thinking, system_prompt),
        )
        conn.commit()


def get_conversations(
    limit: int = 100,
    offset: int = 0,
    since: Optional[str] = None,
) -> list[dict]:
    query = "SELECT id, trace_id, created_at, user_message, assistant_message, thinking, system_prompt FROM conversations"
    params: list = []
    if since:
        query += " WHERE created_at >= ?"
        params.append(since)
    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with sqlite3.connect(_db_path()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]
