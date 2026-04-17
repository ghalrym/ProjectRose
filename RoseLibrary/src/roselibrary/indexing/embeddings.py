import httpx

TOKEN_LIMIT = 8192
CHUNK_OVERLAP = 512
CHARS_PER_TOKEN = 4


class EmbeddingService:
    def __init__(self, base_url: str, model: str):
        self.model = model
        self.client = httpx.AsyncClient(base_url=base_url, timeout=60.0)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        response = await self.client.post(
            "/api/embed",
            json={"model": self.model, "input": texts},
        )
        response.raise_for_status()
        return response.json()["embeddings"]

    def prepare_metadata_text(
        self,
        name: str,
        qualified_name: str,
        symbol_type: str,
        parameters: str | None,
        docstring: str | None,
    ) -> str:
        parts = [f"{symbol_type} {qualified_name}"]
        if parameters:
            parts.append(f"Parameters: {parameters}")
        if docstring:
            parts.append(f"\n{docstring}")
        return "\n".join(parts)

    def prepare_code_text(self, source_code: str) -> str:
        return source_code

    def chunk_text(self, text: str) -> list[str]:
        char_limit = TOKEN_LIMIT * CHARS_PER_TOKEN
        if len(text) <= char_limit:
            return [text]

        overlap_chars = CHUNK_OVERLAP * CHARS_PER_TOKEN
        chunks = []
        start = 0
        while start < len(text):
            end = start + char_limit
            chunks.append(text[start:end])
            start = end - overlap_chars
            if start + overlap_chars >= len(text):
                break
        return chunks

    async def generate_symbol_embeddings(
        self,
        name: str,
        qualified_name: str,
        symbol_type: str,
        parameters: str | None,
        docstring: str | None,
        source_code: str,
    ) -> tuple[list[tuple[str, list[float]]], list[tuple[str, list[float]]]]:
        metadata_text = self.prepare_metadata_text(
            name, qualified_name, symbol_type, parameters, docstring
        )
        code_text = self.prepare_code_text(source_code)

        metadata_chunks = self.chunk_text(metadata_text)
        code_chunks = self.chunk_text(code_text)

        all_texts = metadata_chunks + code_chunks
        all_embeddings = await self.embed(all_texts)

        meta_results = list(zip(
            metadata_chunks, all_embeddings[:len(metadata_chunks)]
        ))
        code_results = list(zip(
            code_chunks, all_embeddings[len(metadata_chunks):]
        ))
        return meta_results, code_results

    async def close(self):
        await self.client.aclose()
