"""Level-2 selector: LLM picks categories (not individual files).

Delegates all filesystem work to app.categories. This module owns the prompt
engineering for the selector LLM and the response-parsing logic.
"""
from __future__ import annotations

import json

from app import categories, providers


def load_skills() -> None:
    """No-op retained for backward compatibility. Category scans are lazy."""
    return None


def get_manifest() -> str:
    return categories.get_manifest()


async def select_skills(messages: list[dict]) -> list[str]:
    """Ask the skill_router model which category names are relevant. Returns
    category display names (the same strings that appear in the manifest).
    """
    manifest = categories.get_manifest()
    if not manifest:
        return []

    selection_prompt = [
        {
            "role": "system",
            "content": (
                "You are a skill-category selector. Given a conversation and a "
                "list of available skill categories, return ONLY a JSON array of "
                "category names that are relevant to what the user is discussing. "
                "Return an empty array if none apply. No explanation, just the "
                f"JSON array.\n\nAvailable categories:\n{manifest}"
            ),
        },
        *messages,
        {
            "role": "user",
            "content": (
                "Based on this conversation, which categories are relevant? "
                "Return only a JSON array of category names."
            ),
        },
    ]

    try:
        response = await providers.chat_sync(selection_prompt, role="skill_router")
    except Exception:
        return []

    content = (response.get("content") or "").strip()
    if content.startswith("```"):
        # strip code fence
        try:
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        except Exception:
            pass

    try:
        selected = json.loads(content)
    except Exception:
        return []
    if not isinstance(selected, list):
        return []

    valid_names = {c["name"].lower() for c in categories.list_categories()}
    return [s for s in selected if isinstance(s, str) and s.lower() in valid_names]


def get_skill_content(names: list[str]) -> str:
    """Return concatenated markdown for every file in the picked categories."""
    return categories.get_category_content(names)
