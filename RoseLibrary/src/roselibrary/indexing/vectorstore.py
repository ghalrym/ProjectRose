from pathlib import Path

import chromadb


class VectorStore:
    def __init__(self, data_dir: Path):
        self.client = chromadb.PersistentClient(path=str(data_dir / "chroma"))
        self.metadata_collection = self.client.get_or_create_collection(
            name="symbol_metadata",
            metadata={"hnsw:space": "cosine"},
        )
        self.code_collection = self.client.get_or_create_collection(
            name="symbol_code",
            metadata={"hnsw:space": "cosine"},
        )

    def add_symbol_embeddings(
        self,
        symbol_id: int,
        metadata_chunks: list[tuple[str, list[float]]],
        code_chunks: list[tuple[str, list[float]]],
    ):
        if metadata_chunks:
            self.metadata_collection.add(
                ids=[f"{symbol_id}_meta_{i}" for i in range(len(metadata_chunks))],
                documents=[text for text, _ in metadata_chunks],
                embeddings=[vec for _, vec in metadata_chunks],
                metadatas=[{"symbol_id": symbol_id, "chunk_index": i} for i in range(len(metadata_chunks))],
            )
        if code_chunks:
            self.code_collection.add(
                ids=[f"{symbol_id}_code_{i}" for i in range(len(code_chunks))],
                documents=[text for text, _ in code_chunks],
                embeddings=[vec for _, vec in code_chunks],
                metadatas=[{"symbol_id": symbol_id, "chunk_index": i} for i in range(len(code_chunks))],
            )

    def remove_symbol_embeddings(self, symbol_ids: list[int]):
        if not symbol_ids:
            return

        for collection in (self.metadata_collection, self.code_collection):
            try:
                results = collection.get(
                    where={"symbol_id": {"$in": symbol_ids}},
                )
                if results["ids"]:
                    collection.delete(ids=results["ids"])
            except Exception:
                # Collection might be empty or IDs might not exist
                pass

    def search(
        self,
        query_embedding: list[float],
        collection_name: str,
        limit: int,
    ) -> list[tuple[int, float]]:
        collection = (
            self.metadata_collection
            if collection_name == "symbol_metadata"
            else self.code_collection
        )

        if collection.count() == 0:
            return []

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=min(limit * 3, collection.count()),
        )

        # Deduplicate by symbol_id, keeping best (lowest distance) per symbol
        best: dict[int, float] = {}
        if results["metadatas"] and results["distances"]:
            for meta, dist in zip(results["metadatas"][0], results["distances"][0]):
                sym_id = meta["symbol_id"]
                similarity = 1.0 - dist  # Cosine distance to similarity
                if sym_id not in best or similarity > best[sym_id]:
                    best[sym_id] = similarity

        return sorted(best.items(), key=lambda x: x[1], reverse=True)[:limit]

    def search_combined(
        self,
        metadata_embedding: list[float],
        code_embedding: list[float],
        metadata_weight: float,
        code_weight: float,
        limit: int,
    ) -> list[tuple[int, float]]:
        meta_results = dict(
            self.search(metadata_embedding, "symbol_metadata", limit * 3)
        )
        code_results = dict(
            self.search(code_embedding, "symbol_code", limit * 3)
        )

        all_ids = set(meta_results.keys()) | set(code_results.keys())
        combined: dict[int, float] = {}
        for sym_id in all_ids:
            meta_score = meta_results.get(sym_id, 0.0)
            code_score = code_results.get(sym_id, 0.0)
            combined[sym_id] = metadata_weight * meta_score + code_weight * code_score

        return sorted(combined.items(), key=lambda x: x[1], reverse=True)[:limit]
