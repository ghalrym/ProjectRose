import hashlib
import os

import chromadb

from app.ollama import embed

KNOWLEDGE_DIR = os.path.join(os.path.dirname(__file__), "..", "prompts", "knowledge")
CHROMA_DIR = os.path.join(os.path.dirname(__file__), "..", ".chromadb")
COLLECTION_NAME = "knowledge"

TOP_K = 3
MIN_SIMILARITY = 0.7
MAX_GAP = 0.15

_client = None
_collection = None


def _get_collection():
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=os.path.normpath(CHROMA_DIR))
        _collection = _client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def _file_hash(filepath: str) -> str:
    with open(filepath, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


async def index_knowledge() -> None:
    """Scan knowledge directory and index new/changed files into ChromaDB."""
    knowledge_dir = os.path.normpath(KNOWLEDGE_DIR)
    if not os.path.isdir(knowledge_dir):
        print(f"Knowledge directory not found: {knowledge_dir}")
        return

    collection = _get_collection()
    existing = collection.get()
    existing_ids = set(existing["ids"]) if existing["ids"] else set()
    existing_meta = {}
    if existing["ids"] and existing["metadatas"]:
        for id_, meta in zip(existing["ids"], existing["metadatas"]):
            existing_meta[id_] = meta

    current_files = set()

    for filename in os.listdir(knowledge_dir):
        if not filename.endswith(".md"):
            continue
        filepath = os.path.join(knowledge_dir, filename)
        file_id = filename
        current_files.add(file_id)
        current_hash = _file_hash(filepath)

        if file_id in existing_ids:
            stored_hash = existing_meta.get(file_id, {}).get("hash", "")
            if stored_hash == current_hash:
                continue
            collection.delete(ids=[file_id])

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read().strip()

        embedding = await embed(content)
        collection.add(
            ids=[file_id],
            embeddings=[embedding],
            documents=[content],
            metadatas=[{"hash": current_hash, "filename": filename}],
        )
        print(f"Indexed knowledge file: {filename}")

    stale_ids = existing_ids - current_files
    if stale_ids:
        collection.delete(ids=list(stale_ids))
        print(f"Removed stale knowledge entries: {stale_ids}")

    print(f"Knowledge index ready: {len(current_files)} files")


async def retrieve_knowledge(query: str) -> str:
    """Retrieve relevant knowledge files using embedding similarity search."""
    collection = _get_collection()

    if collection.count() == 0:
        return ""

    query_embedding = await embed(query)

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(TOP_K, collection.count()),
        include=["documents", "distances"],
    )

    if not results["documents"] or not results["documents"][0]:
        return ""

    documents = results["documents"][0]
    distances = results["distances"][0]

    # ChromaDB cosine distance: 0 = identical, 2 = opposite
    # Convert to similarity: similarity = 1 - (distance / 2)
    similarities = [1 - (d / 2) for d in distances]

    filtered = []
    top_similarity = similarities[0] if similarities else 0

    for doc, sim in zip(documents, similarities):
        if sim < MIN_SIMILARITY:
            continue
        if (top_similarity - sim) > MAX_GAP:
            continue
        filtered.append(doc)

    if not filtered:
        return ""

    parts = [f"## Reference Knowledge\n"]
    for doc in filtered:
        parts.append(doc)
    return "\n\n---\n\n".join(parts)
