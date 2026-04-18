import asyncio
import functools
import json
import time
from pathlib import Path
from typing import AsyncIterator

import torch

from .architecture import RoseGPT, ModelConfig
from .tokenizer import load_tokenizer

_model_cache: dict[str, tuple[RoseGPT, object, ModelConfig]] = {}


def _load_model(checkpoint_path: str, tokenizer_path: str, size: str):
    cache_key = checkpoint_path
    if cache_key in _model_cache:
        return _model_cache[cache_key]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    config = ModelConfig.from_size(size)
    model = RoseGPT(config)
    state = torch.load(checkpoint_path, map_location="cpu")
    model.load_state_dict(state)
    model = model.to(device).eval()
    tokenizer = load_tokenizer(tokenizer_path)
    _model_cache[cache_key] = (model, tokenizer, config)
    return model, tokenizer, config


def _messages_to_text(messages: list[dict]) -> str:
    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        parts.append(f"<|im_start|>{role}\n{content}<|im_end|>")
    parts.append("<|im_start|>assistant\n")
    return "\n".join(parts)


async def generate_completion(
    checkpoint_path: str,
    tokenizer_path: str,
    size: str,
    messages: list[dict],
    max_tokens: int = 512,
    temperature: float = 0.8,
    top_p: float = 0.9,
    stream: bool = False,
) -> str | AsyncIterator[str]:
    loop = asyncio.get_event_loop()

    def _run() -> torch.Tensor:
        model, tokenizer, config = _load_model(checkpoint_path, tokenizer_path, size)
        prompt = _messages_to_text(messages)
        token_ids = tokenizer.encode(prompt).ids
        tokens = torch.tensor([token_ids], dtype=torch.long)
        device = next(model.parameters()).device
        tokens = tokens.to(device)
        with torch.no_grad():
            out = model.generate(tokens, max_new_tokens=max_tokens, temperature=temperature, top_p=top_p)
        new_tokens = out[0, len(token_ids):].tolist()
        return tokenizer.decode(new_tokens)

    text = await loop.run_in_executor(None, _run)
    return text
