import random

from roselibrary.indexing.vectorstore import VectorStore

DIMS = 1024


def _rand_vec(seed: int) -> list[float]:
    rng = random.Random(seed)
    vec = [rng.gauss(0, 1) for _ in range(DIMS)]
    norm = sum(x * x for x in vec) ** 0.5
    return [x / norm for x in vec]  # Normalize for cosine


def test_add_and_search(tmp_path):
    vs = VectorStore(tmp_path)
    vec1 = _rand_vec(1)
    vec2 = _rand_vec(2)

    vs.add_symbol_embeddings(
        symbol_id=1,
        metadata_chunks=[("function foo", vec1)],
        code_chunks=[("def foo(): pass", vec1)],
    )
    vs.add_symbol_embeddings(
        symbol_id=2,
        metadata_chunks=[("function bar", vec2)],
        code_chunks=[("def bar(): pass", vec2)],
    )

    results = vs.search(vec1, "symbol_metadata", limit=2)
    assert len(results) == 2
    # Symbol 1 should be the best match for vec1
    assert results[0][0] == 1


def test_remove_then_search(tmp_path):
    vs = VectorStore(tmp_path)
    vec1 = _rand_vec(1)

    vs.add_symbol_embeddings(
        symbol_id=1,
        metadata_chunks=[("function foo", vec1)],
        code_chunks=[("def foo(): pass", vec1)],
    )

    vs.remove_symbol_embeddings([1])

    results = vs.search(vec1, "symbol_metadata", limit=5)
    assert len(results) == 0


def test_combined_search_weighting(tmp_path):
    vs = VectorStore(tmp_path)
    # Symbol 1: high metadata relevance, low code relevance
    meta_vec_a = _rand_vec(10)
    code_vec_a = _rand_vec(20)
    # Symbol 2: low metadata relevance, high code relevance
    meta_vec_b = _rand_vec(30)
    code_vec_b = _rand_vec(40)

    vs.add_symbol_embeddings(
        symbol_id=1,
        metadata_chunks=[("meta A", meta_vec_a)],
        code_chunks=[("code A", code_vec_a)],
    )
    vs.add_symbol_embeddings(
        symbol_id=2,
        metadata_chunks=[("meta B", meta_vec_b)],
        code_chunks=[("code B", code_vec_b)],
    )

    # Query with meta_vec_a should favor symbol 1 when metadata_weight is high
    results = vs.search_combined(
        metadata_embedding=meta_vec_a,
        code_embedding=meta_vec_a,  # Same vector to test metadata dominance
        metadata_weight=0.9,
        code_weight=0.1,
        limit=2,
    )
    assert results[0][0] == 1

    # Query with code_vec_b should favor symbol 2 when code_weight is high
    results = vs.search_combined(
        metadata_embedding=code_vec_b,
        code_embedding=code_vec_b,
        metadata_weight=0.1,
        code_weight=0.9,
        limit=2,
    )
    assert results[0][0] == 2


def test_multi_chunk_deduplication(tmp_path):
    vs = VectorStore(tmp_path)
    vec = _rand_vec(1)
    slightly_different = _rand_vec(2)

    # One symbol with multiple chunks
    vs.add_symbol_embeddings(
        symbol_id=1,
        metadata_chunks=[("chunk 1", vec), ("chunk 2", slightly_different)],
        code_chunks=[("code chunk 1", vec)],
    )

    results = vs.search(vec, "symbol_metadata", limit=5)
    # Should only have one entry for symbol 1, not two
    symbol_ids = [r[0] for r in results]
    assert symbol_ids.count(1) == 1


def test_empty_search(tmp_path):
    vs = VectorStore(tmp_path)
    results = vs.search(_rand_vec(1), "symbol_metadata", limit=5)
    assert results == []

    results = vs.search_combined(_rand_vec(1), _rand_vec(1), 0.5, 0.5, 5)
    assert results == []
