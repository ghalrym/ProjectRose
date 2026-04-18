from pydantic import BaseModel
from typing import Optional
import datetime


class TrainerModel(BaseModel):
    id: int
    name: str
    size: str
    current_version: Optional[str]
    agents_md: Optional[str]
    created_at: datetime.datetime
    updated_at: datetime.datetime


class ModelVersion(BaseModel):
    id: int
    model_id: int
    version: str
    checkpoint_path: str
    tokenizer_path: str
    is_deployed: bool
    created_at: datetime.datetime


class GrowthStage(BaseModel):
    id: int
    model_id: int
    stage: int
    status: str
    completed_at: Optional[datetime.datetime]


class QuestionnaireResponse(BaseModel):
    question_id: str
    question: str
    answer: str


class TrainingDataRow(BaseModel):
    id: int
    model_id: int
    stage: int
    source: str
    input: str
    thinking: str
    output: str
    reviewed: bool
    deleted: bool
    created_at: datetime.datetime


class ProviderCredential(BaseModel):
    provider: str
    api_key: Optional[str]
    base_url: Optional[str]
    models_json: list


class TrainingRun(BaseModel):
    id: int
    model_id: int
    stage: int
    from_version: Optional[str]
    to_version: str
    status: str
    loss_data: list
    log_text: str
    error: Optional[str]
    started_at: Optional[datetime.datetime]
    finished_at: Optional[datetime.datetime]
    created_at: datetime.datetime
