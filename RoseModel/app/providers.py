"""LiteLLM-backed provider layer.

Single entry point for chat completion, embedding, and capability checks across
every supported provider (Ollama, OpenAI, Anthropic, any OpenAI-compatible
endpoint). Uses role→model mapping from app.config.

Streaming chunks are yielded in OpenAI delta shape:
    {"content": str, "tool_call": dict | None, "usage": UsageInfo | None, "done": bool}

A tool_call is yielded once — after its arguments have been fully accumulated.
Content is buffered per-stream and emitted as a single chunk after completion so
that text-based tool call output (models that emit JSON instead of tool_calls delta)
can be detected and re-routed before being forwarded as text.
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


def _try_parse_text_tool_call(text: str, tool_names: set[str]) -> dict[str, Any] | None:
    """Detect a tool call encoded as plain JSON text (models that don't use tool_calls delta).

    Returns a tool_call dict {"id", "name", "arguments", "_text_based": True} if the text
    is a JSON object whose "name" key matches a known tool, otherwise returns None.
    """
    try:
        data = json.loads(text)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    name = data.get("name")
    if not name or not isinstance(name, str):
        return None
    if tool_names and name not in tool_names:
        return None
    args = data.get("arguments", data.get("parameters", {}))
    return {
        "id": "call_text_0",
        "name": name,
        "arguments": args if isinstance(args, dict) else {},
        "_text_based": True,
    }


def _try_unwrap_message_object(text: str) -> str | None:
    """If text is a JSON message object {"role": ..., "content": ...}, return the content.

    Some models (e.g. glm-4.7-flash via Ollama) wrap their responses in OpenAI message
    format when they are confused by tool_calls conversation history.
    """
    try:
        data = json.loads(text)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if data.get("role") in ("assistant", "model") and isinstance(data.get("content"), str):
        return data["content"]
    return None


async def chat_stream(
    messages: list[dict],
    tools: list[dict] | None = None,
    role: str = "chat",
) -> AsyncGenerator[dict, None]:
    """Stream a chat completion. Yields dicts with fields:
        content: str | None         — text (emitted as one chunk after stream ends)
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
    buffered_content: list[str] = []
    has_delta_tool_calls = False

    async for chunk in response:
        choices = getattr(chunk, "choices", None) or []
        if choices:
            delta = getattr(choices[0], "delta", None)

            content = (
                getattr(delta, "content", None)
                or getattr(delta, "reasoning_content", None)
            ) if delta else None

            tool_call_deltas = getattr(delta, "tool_calls", None) if delta else None
            finish_reason = getattr(choices[0], "finish_reason", None)

            if content:
                buffered_content.append(content)

            if tool_call_deltas:
                has_delta_tool_calls = True
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

    # Flush buffered content. If the model emitted tool-call JSON as plain text
    # (instead of using delta.tool_calls), intercept it and re-emit as a tool_call chunk.
    full_content = "".join(buffered_content)
    stripped = full_content.strip()
    if stripped and not has_delta_tool_calls and tools:
        tool_names = {t["name"] for t in tools}
        text_tc = _try_parse_text_tool_call(stripped, tool_names)
        if text_tc is not None:
            yield {"content": None, "tool_call": text_tc, "usage": None, "done": False}
            yield {"content": None, "tool_call": None, "usage": final_usage, "done": True}
            return

    # Some models wrap their response in a JSON message object when confused by tool history.
    if stripped:
        unwrapped = _try_unwrap_message_object(stripped)
        if unwrapped is not None:
            full_content = unwrapped

    if full_content:
        yield {"content": full_content, "tool_call": None, "usage": None, "done": False}

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
