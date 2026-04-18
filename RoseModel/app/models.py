from pydantic import BaseModel, Field
from typing import Optional


class Message(BaseModel):
    role: str
    content: str


class ToolParameter(BaseModel):
    type: str
    description: str = ""


class Tool(BaseModel):
    name: str
    description: str = ""
    parameters: dict[str, ToolParameter] = {}
    callback_url: str


class GenerateRequest(BaseModel):
    messages: list[Message]
    agent_md: Optional[str] = None
    tools: list[Tool] = Field(default_factory=list)


class CompressRequest(BaseModel):
    messages: list[Message]


class CompressResponse(BaseModel):
    messages: list[Message]


class ToolCallResult(BaseModel):
    tool: str
    params: dict = {}
    success: bool
    content: Optional[str] = None
    error: Optional[str] = None


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0


class GenerateDone(BaseModel):
    tool_calls_made: list[ToolCallResult] = Field(default_factory=list)
    context_warning: bool = False
    usage: UsageInfo = Field(default_factory=UsageInfo)
    tools_supported: bool = True
