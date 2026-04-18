"""LiteLLM-backed provider layer.

Single entry point for chat completion, embedding, and capability checks across
every supported provider (Ollama, OpenAI, Anthropic, any OpenAI-compatible
endpoint). Uses role→model mapping from app.config.

Streaming chunks are yielded in OpenAI delta shape:
    {"content": str, "tool_call": dict | None, "usage": UsageInfo | None, "done": bool}

A tool_call is yielded once — after its arguments have been fully accumulated.
"""
from __future__ import annotations

import json
from typing import Any, AsyncGenerator

import litellm

from app import config

litellm.drop_params = True  # silently drop provider-unsupported params (e.g. logit_bias)


def _resolve(role: str) -> tuple[str, dict[str, Any]]:
    """Return (litellm_model, kwargs) for the named config assigned to `role`."""
    entry = config.get_role_config(role)
    if not entry:
        raise RuntimeError(f"No config assigned to role '{role}'")
    return _build_call(entry)


def _build_call(entry: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    ptype = entry.get("provider_type")
    model = entry.get("model") or ""
    kwargs: dict[str, Any] = {}
    if ptype == "ollama":
        base = (entry.get("base_url") or "http://host.docker.internal:11434").rstrip("/")
        kwargs["api_base"] = base
        return f"ollama/{model}", kwargs
    if ptype == "openai":
        key = entry.get("api_key")
        if key:
            kwargs["api_key"] = key
        return model, kwargs
    if ptype == "anthropic":
        key = entry.get("api_key")
        if key:
            kwargs["api_key"] = key
        return f"anthropic/{model}", kwargs
    if ptype == "openai_compatible":
        kwargs["api_base"] = (entry.get("base_url") or "").rstrip("/")
        key = entry.get("api_key")
        kwargs["api_key"] = key if key else "sk-none"
        return f"openai/{model}", kwargs
    raise ValueError(f"Unknown provider_type: {ptype}")


def supports_tools(role: str = "chat") -> bool:
    """Return True if the model for `role` can accept function/tool specs.

    LiteLLM's capability DB covers OpenAI/Anthropic well but has no visibility
    into user-local Ollama models or arbitrary OpenAI-compatible endpoints.
    For those provider_types we default to True — Ollama ignores unsupported
    tool specs gracefully, and most OpenAI-compatible backends accept them.
    """
    entry = config.get_role_config(role) or {}
    ptype = entry.get("provider_type", "")
    try:
        model, _ = _resolve(role)
        if litellm.supports_function_calling(model=model):
            return True
    except Exception:
        pass
    return ptype in ("ollama", "openai_compatible")


def _tools_to_openai(tools: list[dict]) -> list[dict]:
    """Convert our internal {name, description, parameters: {pname: {type, description}}}
    into OpenAI-format tool specs."""
    out = []
    for t in tools:
        properties: dict[str, dict[str, str]] = {}
        required: list[str] = []
        for pname, pinfo in t.get("parameters", {}).items():
            properties[pname] = {
                "type": pinfo.get("type", "string"),
                "description": pinfo.get("description", ""),
            }
            required.append(pname)
        out.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        })
    return out


async def chat_stream(
    messages: list[dict],
    tools: list[dict] | None = None,
    role: str = "chat",
) -> AsyncGenerator[dict, None]:
    """Stream a chat completion. Yields dicts with fields:
        content: str | None         — incremental text token
        tool_call: dict | None      — {"id", "name", "arguments": dict} (complete)
        usage: {"prompt_tokens", "completion_tokens"} | None (final chunk only)
        done: bool                  — True on final chunk
    """
    model, kwargs = _resolve(role)
    call_kwargs: dict[str, Any] = dict(kwargs)
    call_kwargs["model"] = model
    call_kwargs["messages"] = messages
    call_kwargs["stream"] = True
    call_kwargs["stream_options"] = {"include_usage": True}
    if tools:
        call_kwargs["tools"] = _tools_to_openai(tools)

    response = await litellm.acompletion(**call_kwargs)

    pending_calls: dict[int, dict[str, Any]] = {}
    emitted_indices: set[int] = set()
    final_usage: dict[str, int] | None = None

    async for chunk in response:
        choices = getattr(chunk, "choices", None) or []
        if choices:
            delta = getattr(choices[0], "delta", None)
            content = getattr(delta, "content", None) if delta else None
            tool_call_deltas = getattr(delta, "tool_calls", None) if delta else None
            finish_reason = getattr(choices[0], "finish_reason", None)

            if content:
                yield {"content": content, "tool_call": None, "usage": None, "done": False}

            if tool_call_deltas:
                for tcd in tool_call_deltas:
                    idx = getattr(tcd, "index", 0) or 0
                    pc = pending_calls.setdefault(
                        idx, {"id": None, "name": "", "arguments": ""}
                    )
                    if getattr(tcd, "id", None):
                        pc["id"] = tcd.id
                    fn = getattr(tcd, "function", None)
                    if fn is not None:
                        if getattr(fn, "name", None):
                            pc["name"] = fn.name
                        if getattr(fn, "arguments", None):
                            pc["arguments"] += fn.arguments

            if finish_reason in ("tool_calls", "stop", "length"):
                for idx, pc in pending_calls.items():
                    if idx in emitted_indices:
                        continue
                    emitted_indices.add(idx)
                    try:
                        args = json.loads(pc["arguments"]) if pc["arguments"] else {}
                    except Exception:
                        args = {"_raw": pc["arguments"]}
                    yield {
                        "content": None,
                        "tool_call": {
                            "id": pc["id"] or f"call_{idx}",
                            "name": pc["name"],
                            "arguments": args,
                        },
                        "usage": None,
                        "done": False,
                    }

        usage = getattr(chunk, "usage", None)
        if usage is not None:
            final_usage = {
                "prompt_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
                "completion_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
            }

    yield {"content": None, "tool_call": None, "usage": final_usage, "done": True}


async def chat_sync(
    messages: list[dict],
    tools: list[dict] | None = None,
    role: str = "chat",
) -> dict:
    """Non-streaming chat completion. Returns {"content": str, "tool_calls": [...]}"""
    model, kwargs = _resolve(role)
    call_kwargs: dict[str, Any] = dict(kwargs)
    call_kwargs["model"] = model
    call_kwargs["messages"] = messages
    if tools:
        call_kwargs["tools"] = _tools_to_openai(tools)

    response = await litellm.acompletion(**call_kwargs)
    choice = response.choices[0]
    msg = choice.message
    content = getattr(msg, "content", "") or ""
    tool_calls: list[dict] = []
    raw_calls = getattr(msg, "tool_calls", None) or []
    for tc in raw_calls:
        fn = getattr(tc, "function", None)
        name = getattr(fn, "name", "") if fn else ""
        raw_args = getattr(fn, "arguments", "") if fn else ""
        try:
            args = json.loads(raw_args) if raw_args else {}
        except Exception:
            args = {"_raw": raw_args}
        tool_calls.append({
            "id": getattr(tc, "id", "") or "",
            "name": name,
            "arguments": args,
        })
    return {"content": content, "tool_calls": tool_calls}


async def embed(text: str) -> list[float]:
    """Embed a single text string using the embedding role."""
    model, kwargs = _resolve("embedding")
    call_kwargs: dict[str, Any] = dict(kwargs)
    call_kwargs["model"] = model
    call_kwargs["input"] = [text]
    response = await litellm.aembedding(**call_kwargs)
    data = response.data
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            return list(first.get("embedding") or [])
        return list(getattr(first, "embedding", []) or [])
    return []
