"""Skill category scanner and CRUD.

Each category is a folder under prompts/skills/<slug>/ that contains:
    category.yaml   - {name: str, description: str}
    *.md            - any number of skill files, all concatenated when picked

The Level-2 selector LLM is shown the list of category names + descriptions,
picks one or more, and everything inside the picked folders is injected.
"""
from __future__ import annotations

import os
import re
from typing import Any

import yaml

SKILLS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "prompts", "skills")
)

CATEGORY_META_FILENAME = "category.yaml"
_SLUG_RE = re.compile(r"[^a-z0-9_-]+")


def slugify(name: str) -> str:
    s = name.strip().lower().replace(" ", "-")
    s = _SLUG_RE.sub("", s)
    return s or "untitled"


def _ensure_skills_dir() -> None:
    os.makedirs(SKILLS_DIR, exist_ok=True)


def _read_meta(cat_dir: str) -> dict[str, str]:
    meta_path = os.path.join(cat_dir, CATEGORY_META_FILENAME)
    if not os.path.isfile(meta_path):
        return {}
    with open(meta_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        return {}
    return {
        "name": str(data.get("name") or os.path.basename(cat_dir)),
        "description": str(data.get("description") or ""),
    }


def _write_meta(cat_dir: str, name: str, description: str) -> None:
    os.makedirs(cat_dir, exist_ok=True)
    with open(os.path.join(cat_dir, CATEGORY_META_FILENAME), "w", encoding="utf-8") as f:
        yaml.safe_dump(
            {"name": name, "description": description},
            f,
            sort_keys=False,
            allow_unicode=True,
        )


def list_categories() -> list[dict[str, Any]]:
    """Return [{slug, name, description, file_count}, ...] sorted by name."""
    _ensure_skills_dir()
    result: list[dict[str, Any]] = []
    for entry in sorted(os.listdir(SKILLS_DIR)):
        cat_dir = os.path.join(SKILLS_DIR, entry)
        if not os.path.isdir(cat_dir):
            continue
        meta = _read_meta(cat_dir)
        if not meta:
            continue  # folder without category.yaml is ignored
        files = [
            f for f in os.listdir(cat_dir) if f.endswith(".md") and not f.startswith("_")
        ]
        result.append({
            "slug": entry,
            "name": meta["name"],
            "description": meta["description"],
            "file_count": len(files),
        })
    result.sort(key=lambda c: c["name"].lower())
    return result


def get_manifest() -> str:
    """Plain-text manifest for the selector LLM."""
    cats = list_categories()
    if not cats:
        return ""
    lines = []
    for c in cats:
        desc = c["description"] or "(no description)"
        lines.append(f"- {c['name']}: {desc}")
    return "\n".join(lines)


def get_category_content(names: list[str]) -> str:
    """Concatenate every .md file inside each picked category.
    `names` are category display names (matched case-insensitively) or slugs.
    """
    if not names:
        return ""
    wanted = {n.strip().lower() for n in names if n}
    cats = list_categories()
    parts: list[str] = []
    for c in cats:
        if c["name"].lower() not in wanted and c["slug"].lower() not in wanted:
            continue
        cat_dir = os.path.join(SKILLS_DIR, c["slug"])
        parts.append(f"## Category: {c['name']}")
        if c["description"]:
            parts.append(c["description"])
        for fname in sorted(os.listdir(cat_dir)):
            if not fname.endswith(".md") or fname.startswith("_"):
                continue
            fpath = os.path.join(cat_dir, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                body = f.read().strip()
            if body:
                parts.append(f"### {fname[:-3]}\n\n{body}")
    return "\n\n".join(parts)


def create_category(name: str, description: str = "") -> str:
    """Create a new category folder. Returns the slug."""
    _ensure_skills_dir()
    slug = slugify(name)
    cat_dir = os.path.join(SKILLS_DIR, slug)
    if os.path.isdir(cat_dir) and os.path.isfile(
        os.path.join(cat_dir, CATEGORY_META_FILENAME)
    ):
        raise FileExistsError(f"Category already exists: {slug}")
    _write_meta(cat_dir, name, description)
    return slug


def update_category(slug: str, name: str, description: str) -> None:
    cat_dir = os.path.join(SKILLS_DIR, slug)
    if not os.path.isdir(cat_dir):
        raise FileNotFoundError(slug)
    _write_meta(cat_dir, name, description)


def delete_category(slug: str) -> None:
    cat_dir = os.path.join(SKILLS_DIR, slug)
    if not os.path.isdir(cat_dir):
        return
    for fname in os.listdir(cat_dir):
        os.remove(os.path.join(cat_dir, fname))
    os.rmdir(cat_dir)


def list_files(slug: str) -> list[str]:
    cat_dir = os.path.join(SKILLS_DIR, slug)
    if not os.path.isdir(cat_dir):
        return []
    return sorted(
        f for f in os.listdir(cat_dir) if f.endswith(".md") and not f.startswith("_")
    )


def read_file(slug: str, filename: str) -> str:
    _validate_filename(filename)
    path = os.path.join(SKILLS_DIR, slug, filename)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(slug: str, filename: str, content: str) -> None:
    _validate_filename(filename)
    cat_dir = os.path.join(SKILLS_DIR, slug)
    if not os.path.isdir(cat_dir):
        raise FileNotFoundError(slug)
    with open(os.path.join(cat_dir, filename), "w", encoding="utf-8") as f:
        f.write(content)


def delete_file(slug: str, filename: str) -> None:
    _validate_filename(filename)
    path = os.path.join(SKILLS_DIR, slug, filename)
    if os.path.isfile(path):
        os.remove(path)


def read_meta(slug: str) -> dict[str, str]:
    return _read_meta(os.path.join(SKILLS_DIR, slug))


def _validate_filename(filename: str) -> None:
    if not filename.endswith(".md"):
        raise ValueError("filename must end with .md")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("invalid filename")
    if filename.startswith("_") or filename == CATEGORY_META_FILENAME:
        raise ValueError("reserved filename")
