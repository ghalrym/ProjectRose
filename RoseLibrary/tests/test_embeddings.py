from unittest.mock import AsyncMock, patch

import pytest

from roselibrary.indexing.embeddings import EmbeddingService


def test_chunk_text_short():
    svc = EmbeddingService.__new__(EmbeddingService)
    svc.model = "test"
    text = "short text"
    chunks = svc.chunk_text(text)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_chunk_text_long():
    svc = EmbeddingService.__new__(EmbeddingService)
    svc.model = "test"
    # Create text that exceeds 8192 tokens * 4 chars = 32768 chars
    text = "x" * 70000
    chunks = svc.chunk_text(text)
    assert len(chunks) > 1
    # Each chunk should be at most 32768 chars
    for chunk in chunks:
        assert len(chunk) <= 32768
    # Chunks should have overlap
    if len(chunks) >= 2:
        overlap = 512 * 4  # 2048 chars
        end_of_first = chunks[0][-overlap:]
        start_of_second = chunks[1][:overlap]
        assert end_of_first == start_of_second


def test_prepare_metadata_text_full():
    svc = EmbeddingService.__new__(EmbeddingService)
    svc.model = "test"
    text = svc.prepare_metadata_text(
        "my_func", "MyClass.my_func", "method", "self, x", "Does something"
    )
    assert "method MyClass.my_func" in text
    assert "Parameters: self, x" in text
    assert "Does something" in text


def test_prepare_metadata_text_minimal():
    svc = EmbeddingService.__new__(EmbeddingService)
    svc.model = "test"
    text = svc.prepare_metadata_text("func", "func", "function", None, None)
    assert "function func" in text
    assert "Parameters" not in text


def test_prepare_code_text():
    svc = EmbeddingService.__new__(EmbeddingService)
    svc.model = "test"
    code = "def foo():\n    return 42"
    assert svc.prepare_code_text(code) == code


@pytest.mark.asyncio
async def test_embed_calls_ollama():
    svc = EmbeddingService.__new__(EmbeddingService)
    svc.model = "test-model"

    mock_response = AsyncMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = lambda: None
    mock_response.json = lambda: {"embeddings": [[0.1, 0.2], [0.3, 0.4]]}

    svc.client = AsyncMock()
    svc.client.post.return_value = mock_response

    result = await svc.embed(["text1", "text2"])
    assert len(result) == 2
    assert result[0] == [0.1, 0.2]
    svc.client.post.assert_called_once_with(
        "/api/embed",
        json={"model": "test-model", "input": ["text1", "text2"]},
    )


@pytest.mark.asyncio
async def test_generate_symbol_embeddings():
    svc = EmbeddingService.__new__(EmbeddingService)
    svc.model = "test"

    fake_embedding = [0.1] * 10
    svc.embed = AsyncMock(return_value=[fake_embedding, fake_embedding])

    meta_chunks, code_chunks = await svc.generate_symbol_embeddings(
        name="func",
        qualified_name="func",
        symbol_type="function",
        parameters="x",
        docstring="A function",
        source_code="def func(x): pass",
    )

    assert len(meta_chunks) == 1
    assert len(code_chunks) == 1
    assert meta_chunks[0][1] == fake_embedding
    assert code_chunks[0][1] == fake_embedding
