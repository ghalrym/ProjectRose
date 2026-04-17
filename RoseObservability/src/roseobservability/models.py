from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


ServiceName = Literal["rosemodel", "roselibrary"]


class IngestEvent(BaseModel):
    trace_id: str
    service: ServiceName
    event_type: str
    seq: int = 0
    timestamp: Optional[datetime] = None
    duration_ms: Optional[float] = None
    payload: dict = Field(default_factory=dict)


class IngestBatch(BaseModel):
    events: list[IngestEvent]


class IngestResponse(BaseModel):
    accepted: int
