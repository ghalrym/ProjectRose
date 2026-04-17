# RoseLibrary

Code intelligence API — indexes codebases for symbol graphs, natural language search, and reference finding. Supports Python and JavaScript.

## Quick Start

```bash
uv sync                    # Install dependencies
uv run roselibrary         # Start server (default: 0.0.0.0:8000)
uv run pytest -v           # Run all tests
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ROSE_OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `ROSE_OLLAMA_EMBEDDING_MODEL` | `snowflake-arctic-embed2` | Embedding model name |
| `ROSE_HOST` | `0.0.0.0` | Server bind host |
| `ROSE_PORT` | `8000` | Server bind port |
| `ROSE_DATA_DIR` | `./data` | SQLite + ChromaDB storage directory |

## Architecture

- **`config.py`** — Pydantic Settings model, env var configuration
- **`models/database.py`** — SQLite schema (files, symbols, references), CRUD operations
- **`models/schemas.py`** — Pydantic request/response models
- **`parsing/parser.py`** — tree-sitter symbol extraction for Python and JavaScript
- **`parsing/references.py`** — Import/call/assignment/destructure reference extraction
- **`indexing/embeddings.py`** — Ollama embedding client with chunking support
- **`indexing/vectorstore.py`** — ChromaDB dual-collection vector store (metadata + code)
- **`routes/`** — FastAPI endpoints: check, update, search, findReferences, status

## API Endpoints

- `POST /check-file` — Batch check file hashes against index
- `POST /update-file` — Index a file (always accepts, reports broken references)
- `GET /status` — Index health: stats + unresolved references
- `POST /search` — Natural language code search with configurable weights
- `POST /findReferences` — Find inbound/outbound references for a symbol
