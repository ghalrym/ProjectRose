import os
import yaml

from app.ollama import chat_sync

SKILLS_DIR = os.path.join(os.path.dirname(__file__), "..", "prompts", "skills")

_skills_cache: dict[str, dict] = {}


def load_skills() -> None:
    """Load all skill files from the skills directory, parsing frontmatter."""
    _skills_cache.clear()
    skills_dir = os.path.normpath(SKILLS_DIR)
    if not os.path.isdir(skills_dir):
        return

    for filename in os.listdir(skills_dir):
        if not filename.endswith(".md"):
            continue
        filepath = os.path.join(skills_dir, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            raw = f.read()

        name, description, content = _parse_skill(raw, filename)
        _skills_cache[name] = {
            "name": name,
            "description": description,
            "content": content,
        }


def _parse_skill(raw: str, filename: str) -> tuple[str, str, str]:
    """Parse a skill file with YAML frontmatter. Returns (name, description, content)."""
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            frontmatter = yaml.safe_load(parts[1])
            content = parts[2].strip()
            name = frontmatter.get("name", filename.replace(".md", ""))
            description = frontmatter.get("description", "")
            return name, description, content
    return filename.replace(".md", ""), "", raw.strip()


def get_manifest() -> str:
    """Build a manifest string listing all available skills with descriptions."""
    if not _skills_cache:
        load_skills()

    lines = []
    for skill in _skills_cache.values():
        lines.append(f"- {skill['name']}: {skill['description']}")
    return "\n".join(lines)


async def select_skills(messages: list[dict]) -> list[str]:
    """Use the LLM to pick relevant skills from the manifest based on conversation."""
    manifest = get_manifest()
    if not manifest:
        return []

    selection_prompt = [
        {
            "role": "system",
            "content": (
                "You are a skill selector. Given a conversation and a list of available skills, "
                "return ONLY a JSON array of skill names that are relevant to the conversation. "
                "Return an empty array if none are relevant. No explanation, just the JSON array.\n\n"
                f"Available skills:\n{manifest}"
            ),
        },
        *messages,
        {
            "role": "user",
            "content": "Based on this conversation, which skills from the list are relevant? Return only a JSON array of skill names.",
        },
    ]

    response = await chat_sync(selection_prompt)
    content = response.get("message", {}).get("content", "[]")

    try:
        # Extract JSON array from response
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        selected = __import__("json").loads(content)
        if isinstance(selected, list):
            return [s for s in selected if s in _skills_cache]
    except Exception:
        pass
    return []


def get_skill_content(names: list[str]) -> str:
    """Return the full markdown content of the selected skills."""
    parts = []
    for name in names:
        if name in _skills_cache:
            parts.append(f"## Skill: {name}\n\n{_skills_cache[name]['content']}")
    return "\n\n".join(parts)
