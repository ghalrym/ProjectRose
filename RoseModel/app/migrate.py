"""Idempotent upgrade steps that run on RoseModel startup.

- Flat `prompts/skills/*.md` → `prompts/skills/general/*.md` + `general/category.yaml`
- Already-categorized trees are left untouched.
"""
from __future__ import annotations

import os
import shutil

from app.categories import SKILLS_DIR, CATEGORY_META_FILENAME, _write_meta

GENERAL_SLUG = "general"
GENERAL_NAME = "General"
GENERAL_DESCRIPTION = (
    "Uncategorized skills. Migrated from the pre-category flat layout; "
    "re-home these into more specific categories when it makes sense."
)


def migrate_skills_to_categories() -> dict[str, int]:
    """Move any top-level prompts/skills/*.md into prompts/skills/general/.

    Returns {"moved": N, "already_categorized": bool}.
    """
    if not os.path.isdir(SKILLS_DIR):
        os.makedirs(SKILLS_DIR, exist_ok=True)
        return {"moved": 0, "already_categorized": True}

    flat_files = [
        f for f in os.listdir(SKILLS_DIR)
        if f.endswith(".md") and os.path.isfile(os.path.join(SKILLS_DIR, f))
    ]

    if not flat_files:
        return {"moved": 0, "already_categorized": True}

    general_dir = os.path.join(SKILLS_DIR, GENERAL_SLUG)
    os.makedirs(general_dir, exist_ok=True)
    meta_path = os.path.join(general_dir, CATEGORY_META_FILENAME)
    if not os.path.isfile(meta_path):
        _write_meta(general_dir, GENERAL_NAME, GENERAL_DESCRIPTION)

    moved = 0
    for fname in flat_files:
        src = os.path.join(SKILLS_DIR, fname)
        dst = os.path.join(general_dir, fname)
        if os.path.exists(dst):
            # Collision: prefix the new arrival to avoid data loss.
            stem, ext = os.path.splitext(fname)
            i = 2
            while os.path.exists(os.path.join(general_dir, f"{stem}-{i}{ext}")):
                i += 1
            dst = os.path.join(general_dir, f"{stem}-{i}{ext}")
        shutil.move(src, dst)
        moved += 1

    return {"moved": moved, "already_categorized": False}
