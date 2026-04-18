"""Level-3: RAG over prompts/knowledge/*.md.

Each knowledge file may optionally start with YAML frontmatter carrying a
`category` tag. The tag is stored in ChromaDB metadata purely so the Web UI can
group/filter for display; retrieval itself is pure cosine similarity across
every indexed document (no category filtering or boosting).
"""
from __future__ import annotations

import hashlib
import os
import shutil

import chromadb
import yaml

from app import config, providers

KNOWLEDGE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "prompts", "knowledge")
)
CHROMA_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", ".chromadb")
)
COLLECTION_NAME = "knowledge"

TOP_K = 3
MIN_SIMILARITY = 0.7
MAX_GAP = 0.15

_client = None
_collection = None


def _get_collection():
    global _client, _collection
    if _collection is None:
        os.makedirs(CHROMA_DIR, exist_ok=True)
        _client = chromadb.PersistentClient(path=CHROMA_DIR)
        _collection = _client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def _reset_collection() -> None:
    """Drop the cached client and wipe the collection on disk. Used when the
    embedding model changes and dimensions may no longer match."""
    global _client, _collection
    _client = None
    _collection = None
    if os.path.isdir(CHROMA_DIR):
        shutil.rmtree(CHROMA_DIR, ignore_errors=True)


def _file_hash(filepath: str) -> str:
    with open(filepath, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _parse_frontmatter(raw: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body). If no frontmatter, ({}, raw)."""
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            try:
                fm = yaml.safe_load(parts[1]) or {}
            except Exception:
                fm = {}
            if isinstance(fm, dict):
                return fm, parts[2].strip()
    return {}, raw.strip()


def _check_watermark_and_reset() -> bool:
    """If the configured embedding model doesn't match the one used to build
    the current index, wipe the index. Returns True iff we reset."""
    cfg = config.load()
    entry = config.get_role_config("embedding") or {}
    current_model = entry.get("model", "")
    watermark = cfg.get("embedding_model_used_for_index", "")
    if watermark and current_model and watermark != current_model:
        _reset_collection()
        return True
    return False


async def index_knowledge() -> None:
    """Scan prompts/knowledge/ and (re)index anything new or changed. Also
    resets the collection if the embedding model changed since last run."""
    if not os.path.isdir(KNOWLEDGE_DIR):
        print(f"Knowledge directory not found: {KNOWLEDGE_DIR}")
        return

    did_reset = _check_watermark_and_reset()
    if did_reset:
        print("Embedding model changed — rebuilding knowledge index from scratch.")

    collection = _get_collection()
    existing = collection.get()
    existing_ids = set(existing["ids"]) if existing["ids"] else set()
    existing_meta: dict[str, dict] = {}
    if existing["ids"] and existing["metadatas"]:
        for id_, meta in zip(existing["ids"], existing["metadatas"]):
            existing_meta[id_] = meta or {}

    current_files: set[str] = set()

    for filename in sorted(os.listdir(KNOWLEDGE_DIR)):
        if not filename.endswith(".md"):
            continue
        filepath = os.path.join(KNOWLEDGE_DIR, filename)
        file_id = filename
        current_files.add(file_id)
        current_hash = _file_hash(filepath)

        with open(filepath, "r", encoding="utf-8") as f:
            raw = f.read()
        fm, body = _parse_frontmatter(raw)
        category = str(fm.get("category") or "general")

        if file_id in existing_ids:
            stored = existing_meta.get(file_id, {})
            if stored.get("hash") == current_hash and stored.get("category") == category:
                continue
            collection.delete(ids=[file_id])

        if not body:
            continue

        embedding = await providers.embed(body)
        collection.add(
            ids=[file_id],
            embeddings=[embedding],
            documents=[body],
            metadatas=[{
                "hash": current_hash,
                "filename": filename,
                "category": category,
            }],
        )
        print(f"Indexed knowledge file: {filename} [{category}]")

    stale_ids = existing_ids - current_files
    if stale_ids:
        collection.delete(ids=list(stale_ids))
        print(f"Removed stale knowledge entries: {sorted(stale_ids)}")

    # Record which embedding model built the current index.
    entry = config.get_role_config("embedding") or {}
    config.set_embedding_watermark(entry.get("model", ""))

    print(f"Knowledge index ready: {len(current_files)} files")


async def retrieve_knowledge(query: str) -> str:
    collection = _get_collection()
    if collection.count() == 0:
        return ""

    try:
        query_embedding = await providers.embed(query)
    except Exception as e:
        print(f"[knowledge] embed failed, skipping RAG: {type(e).__name__}: {e}")
        return ""
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(TOP_K, collection.count()),
        include=["documents", "distances"],
    )
    if not results["documents"] or not results["documents"][0]:
        return ""

    documents = results["documents"][0]
    distances = results["distances"][0]

    # ChromaDB cosine distance: 0 = identical, 2 = opposite. Convert to similarity.
    similarities = [1 - (d / 2) for d in distances]
    top_similarity = similarities[0] if similarities else 0

    filtered: list[str] = []
    for doc, sim in zip(documents, similarities):
        if sim < MIN_SIMILARITY:
            continue
        if (top_similarity - sim) > MAX_GAP:
            continue
        filtered.append(doc)

    if not filtered:
        return ""

    parts = ["## Reference Knowledge\n"]
    parts.extend(filtered)
    return "\n\n---\n\n".join(parts)


# ---------- CRUD helpers for the Web UI ----------


def list_knowledge_files() -> list[dict[str, str]]:
    """Return [{filename, category}, ...] sorted by filename."""
    if not os.path.isdir(KNOWLEDGE_DIR):
        return []
    out: list[dict[str, str]] = []
    for filename in sorted(os.listdir(KNOWLEDGE_DIR)):
        if not filename.endswith(".md"):
            continue
        fpath = os.path.join(KNOWLEDGE_DIR, filename)
        with open(fpath, "r", encoding="utf-8") as f:
            raw = f.read()
        fm, _ = _parse_frontmatter(raw)
        out.append({
            "filename": filename,
            "category": str(fm.get("category") or "general"),
        })
    return out


def read_knowledge_file(filename: str) -> str:
    _validate_filename(filename)
    path = os.path.join(KNOWLEDGE_DIR, filename)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_knowledge_file(filename: str, content: str) -> None:
    _validate_filename(filename)
    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
    with open(os.path.join(KNOWLEDGE_DIR, filename), "w", encoding="utf-8") as f:
        f.write(content)


def delete_knowledge_file(filename: str) -> None:
    _validate_filename(filename)
    path = os.path.join(KNOWLEDGE_DIR, filename)
    if os.path.isfile(path):
        os.remove(path)
    try:
        collection = _get_collection()
        collection.delete(ids=[filename])
    except Exception:
        pass


def _validate_filename(filename: str) -> None:
    if not filename.endswith(".md"):
        raise ValueError("filename must end with .md")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("invalid filename")
