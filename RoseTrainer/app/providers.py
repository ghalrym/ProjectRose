import httpx
import json
from typing import AsyncIterator, Optional


async def _openai_models(api_key: str) -> list[str]:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        return sorted(
            [m["id"] for m in data["data"] if "gpt" in m["id"].lower()],
            reverse=True,
        )


async def _anthropic_models(api_key: str) -> list[str]:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        return [m["id"] for m in data.get("data", [])]


async def _groq_models(api_key: str) -> list[str]:
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        return sorted([m["id"] for m in data.get("data", [])])


async def _ollama_models(base_url: str) -> list[str]:
    url = base_url.rstrip("/") + "/api/tags"
    async with httpx.AsyncClient() as client:
        r = await client.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        return [m["name"] for m in data.get("models", [])]


async def fetch_models(provider: str, api_key: Optional[str], base_url: Optional[str]) -> list[str]:
    if provider == "openai":
        return await _openai_models(api_key)
    elif provider == "anthropic":
        return await _anthropic_models(api_key)
    elif provider == "groq":
        return await _groq_models(api_key)
    elif provider == "ollama":
        return await _ollama_models(base_url or "http://localhost:11434")
    return []


async def complete_chat(
    provider: str,
    model: str,
    messages: list[dict],
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    tools: Optional[list[dict]] = None,
    system: Optional[str] = None,
) -> tuple[str, list[dict]]:
    """Returns (text_content, tool_calls). tool_calls is list of {name, arguments}."""
    if provider == "openai":
        return await _openai_complete(model, messages, api_key, tools, system)
    elif provider == "anthropic":
        return await _anthropic_complete(model, messages, api_key, tools, system)
    elif provider == "groq":
        return await _groq_complete(model, messages, api_key, tools, system)
    elif provider == "ollama":
        return await _ollama_complete(model, messages, base_url, tools, system)
    raise ValueError(f"Unknown provider: {provider}")


async def _openai_complete(
    model: str,
    messages: list[dict],
    api_key: str,
    tools: Optional[list[dict]],
    system: Optional[str],
) -> tuple[str, list[dict]]:
    payload: dict = {"model": model, "messages": messages}
    if system:
        payload["messages"] = [{"role": "system", "content": system}] + messages
    if tools:
        payload["tools"] = [{"type": "function", "function": t} for t in tools]
        payload["tool_choice"] = "auto"

    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=120,
        )
        r.raise_for_status()
        data = r.json()

    msg = data["choices"][0]["message"]
    text = msg.get("content") or ""
    tool_calls = []
    for tc in msg.get("tool_calls") or []:
        tool_calls.append({
            "name": tc["function"]["name"],
            "arguments": json.loads(tc["function"]["arguments"]),
        })
    return text, tool_calls


async def _anthropic_complete(
    model: str,
    messages: list[dict],
    api_key: str,
    tools: Optional[list[dict]],
    system: Optional[str],
) -> tuple[str, list[dict]]:
    payload: dict = {"model": model, "max_tokens": 4096, "messages": messages}
    if system:
        payload["system"] = system
    if tools:
        payload["tools"] = [
            {
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": {"type": "object", "properties": t.get("parameters", {}).get("properties", {}), "required": t.get("parameters", {}).get("required", [])},
            }
            for t in tools
        ]

    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120,
        )
        r.raise_for_status()
        data = r.json()

    text = ""
    tool_calls = []
    for block in data.get("content", []):
        if block["type"] == "text":
            text += block["text"]
        elif block["type"] == "tool_use":
            tool_calls.append({"name": block["name"], "arguments": block["input"]})
    return text, tool_calls


async def _groq_complete(
    model: str,
    messages: list[dict],
    api_key: str,
    tools: Optional[list[dict]],
    system: Optional[str],
) -> tuple[str, list[dict]]:
    payload: dict = {"model": model, "messages": messages}
    if system:
        payload["messages"] = [{"role": "system", "content": system}] + messages
    if tools:
        payload["tools"] = [{"type": "function", "function": t} for t in tools]

    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=120,
        )
        r.raise_for_status()
        data = r.json()

    msg = data["choices"][0]["message"]
    text = msg.get("content") or ""
    tool_calls = []
    for tc in msg.get("tool_calls") or []:
        tool_calls.append({
            "name": tc["function"]["name"],
            "arguments": json.loads(tc["function"]["arguments"]),
        })
    return text, tool_calls


async def _ollama_complete(
    model: str,
    messages: list[dict],
    base_url: Optional[str],
    tools: Optional[list[dict]],
    system: Optional[str],
) -> tuple[str, list[dict]]:
    url = (base_url or "http://localhost:11434").rstrip("/") + "/api/chat"
    msgs = list(messages)
    if system:
        msgs = [{"role": "system", "content": system}] + msgs
    payload: dict = {"model": model, "messages": msgs, "stream": False}
    if tools:
        payload["tools"] = [{"type": "function", "function": t} for t in tools]

    async with httpx.AsyncClient() as client:
        r = await client.post(url, json=payload, timeout=120)
        r.raise_for_status()
        data = r.json()

    msg = data.get("message", {})
    text = msg.get("content") or ""
    tool_calls = []
    for tc in msg.get("tool_calls") or []:
        fn = tc.get("function", {})
        args = fn.get("arguments", {})
        if isinstance(args, str):
            args = json.loads(args)
        tool_calls.append({"name": fn.get("name", ""), "arguments": args})
    return text, tool_calls
