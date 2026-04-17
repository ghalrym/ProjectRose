import httpx
import json
import os
from typing import AsyncGenerator

OLLAMA_BASE_URL = os.environ.get("ROSE_OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
CHAT_MODEL = "glm-4.7-flash"
EMBED_MODEL = "nomic-embed-text"


def _build_ollama_tools(tools: list[dict]) -> list[dict]:
    """Convert our tool format to Ollama's native tool calling format."""
    ollama_tools = []
    for tool in tools:
        properties = {}
        required = []
        for param_name, param_info in tool.get("parameters", {}).items():
            properties[param_name] = {
                "type": param_info.get("type", "string"),
                "description": param_info.get("description", ""),
            }
            required.append(param_name)

        ollama_tools.append({
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        })
    return ollama_tools


async def chat_stream(
    messages: list[dict],
    tools: list[dict] | None = None,
) -> AsyncGenerator[dict, None]:
    """Stream a chat completion from Ollama. Yields parsed JSON chunks."""
    payload = {
        "model": CHAT_MODEL,
        "messages": messages,
        "stream": True,
    }
    if tools:
        payload["tools"] = _build_ollama_tools(tools)

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.strip():
                    yield json.loads(line)


async def chat_sync(
    messages: list[dict],
    tools: list[dict] | None = None,
) -> dict:
    """Non-streaming chat completion. Returns the full response."""
    payload = {
        "model": CHAT_MODEL,
        "messages": messages,
        "stream": False,
    }
    if tools:
        payload["tools"] = _build_ollama_tools(tools)

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def embed(text: str) -> list[float]:
    """Get an embedding vector for a text string."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        response.raise_for_status()
        return response.json()["embedding"]
