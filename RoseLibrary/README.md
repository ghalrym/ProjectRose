# RoseLibrary

A code intelligence API that indexes codebases to provide symbol graphs, natural language search, and reference finding. Designed for agents and IDEs working with Python, JavaScript, and TypeScript projects.

## Quick Start

```bash
# Install dependencies
uv sync

# Start Ollama with the embedding model
ollama pull snowflake-arctic-embed2

# Start the server
uv run roselibrary
```

The server starts on `http://0.0.0.0:8000` by default. Interactive API docs are available at `http://localhost:8000/docs`.

## Configuration

All settings are configured via environment variables (or a `.env` file):

| Variable | Default | Description |
|---|---|---|
| `ROSE_OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `ROSE_OLLAMA_EMBEDDING_MODEL` | `snowflake-arctic-embed2` | Embedding model name |
| `ROSE_HOST` | `0.0.0.0` | Server bind host |
| `ROSE_PORT` | `8000` | Server bind port |
| `ROSE_OLLAMA_GENERATION_MODEL` | `GLM-4.7-flash` | LLM model for file summaries |
| `ROSE_DATA_DIR` | `./data` | SQLite + ChromaDB storage directory |

```bash
# Example: custom port and data directory
ROSE_PORT=9000 ROSE_DATA_DIR=/tmp/rose uv run roselibrary
```

## API Endpoints

### `GET /` — Health Check

Returns the server name and version. Use this to verify the server is running.

```bash
curl http://localhost:8000/
```

```json
{
  "name": "RoseLibrary",
  "version": "0.1.0"
}
```

---

### `POST /check-file` — Batch File Hash Check

Compares file hashes against what the server has indexed. Use this to determine which files in your project need to be re-indexed before sending their full content.

**When to use:** Before calling `/update-file` for multiple files. Send all your file paths and their SHA-256 hashes in one request, then only call `/update-file` for files that come back as `"stale"` or `"unknown"`.

**Request:** An array of `{path, hash}` objects. The hash should be the SHA-256 hex digest of the raw file bytes.

```bash
curl -X POST http://localhost:8000/check-file \
  -H "Content-Type: application/json" \
  -d '[
    {"path": "src/utils.py", "hash": "a1b2c3..."},
    {"path": "src/main.py", "hash": "d4e5f6..."},
    {"path": "src/new_file.py", "hash": "g7h8i9..."}
  ]'
```

**Response:** One entry per file with a status:

- `"current"` — The file is indexed and the hash matches. No action needed.
- `"stale"` — The file is indexed but the hash differs. Call `/update-file` to re-index.
- `"unknown"` — The file has never been indexed. Call `/update-file` to index it.

```json
[
  {"path": "src/utils.py", "status": "current"},
  {"path": "src/main.py", "status": "stale"},
  {"path": "src/new_file.py", "status": "unknown"}
]
```

---

### `POST /update-file` — Index a File

Parses a source file, extracts symbols (functions, classes, methods) and references (imports, calls, assignments, destructuring), generates embeddings, and stores everything in the index. If the file was previously indexed, the old data is replaced.

**This endpoint always accepts the update.** It never rejects. If the update causes broken references in other indexed files (e.g., you removed a function that other files call), those are reported in the response so the caller knows what else needs attention.

**When to use:** After `/check-file` reports a file as `"stale"` or `"unknown"`, or whenever a file changes.

**Request:**

- `path` — The file path (relative to project root). The server normalizes slashes and formats.
- `content` — The full raw source code of the file.

```bash
curl -X POST http://localhost:8000/update-file \
  -H "Content-Type: application/json" \
  -d '{
    "path": "src/utils.py",
    "content": "def add(a, b):\n    \"\"\"Add two numbers.\"\"\"\n    return a + b\n"
  }'
```

**Response:**

- `symbols_indexed` — How many symbols were extracted and indexed from this file.
- `broken_references` — A list of symbols that were removed by this update and are still referenced by other indexed files. Each entry includes the removed symbol name and the list of files that reference it.

```json
{
  "symbols_indexed": 1,
  "broken_references": []
}
```

**Example with broken references:** If you update `utils.py` and remove the `helper` function that `main.py` was calling:

```json
{
  "symbols_indexed": 2,
  "broken_references": [
    {
      "target_symbol_name": "helper",
      "affected_files": ["src/main.py"]
    }
  ]
}
```

This tells the caller: "You should update `src/main.py` next — it references `helper` which no longer exists."

**Supported file types:** `.py` (Python), `.js`, `.jsx`, `.mjs` (JavaScript), `.ts`, `.tsx` (TypeScript). Unsupported extensions return `200` with `symbols_indexed: 0`.

---

### `GET /status` — Index Health

Returns summary statistics about the index and a list of all currently unresolved references. Use this to get a high-level view of the index state and identify what needs fixing.

**When to use:** After a batch of `/update-file` calls to verify the index is healthy, or periodically to monitor for drift.

```bash
curl http://localhost:8000/status
```

**Response:**

```json
{
  "files_indexed": 5,
  "symbols_indexed": 23,
  "references_total": 41,
  "unresolved_count": 2,
  "unresolved_references": [
    {
      "source_file": "src/main.py",
      "source_symbol": "calculate_total",
      "target_symbol_name": "helper",
      "type": "call",
      "line_number": 12
    },
    {
      "source_file": "src/app.py",
      "source_symbol": "run",
      "target_symbol_name": "missing_func",
      "type": "import",
      "line_number": 3
    }
  ]
}
```

Each unresolved reference tells you exactly which file and function has the broken reference, what it's trying to reference, the type of reference (import, call, assignment, destructure), and the line number. This gives an agent or developer enough information to fix the issue.

---

### `POST /search` — Natural Language Code Search

Search for code using plain English queries. Returns matching symbols ranked by relevance, with full source code included.

**When to use:** When an agent or user needs to find code by describing what it does rather than knowing its exact name. Examples: "calculate shipping cost", "validate user input", "database connection setup".

**Request:**

- `query` (required) — Natural language search query.
- `limit` (optional, default `10`) — Maximum number of results to return.
- `metadata_weight` (optional, default `0.5`) — Weight for metadata/docstring similarity (0.0 to 1.0).
- `code_weight` (optional, default `0.5`) — Weight for source code similarity (0.0 to 1.0).

```bash
curl -X POST http://localhost:8000/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "calculate shipping cost",
    "limit": 5,
    "metadata_weight": 0.6,
    "code_weight": 0.4
  }'
```

**Tuning weights:** The search uses two separate embeddings per symbol — one from metadata (function name, type, parameters, docstring) and one from the source code. Adjusting weights lets you control which signal matters more:

- Higher `metadata_weight` — Better for descriptive queries like "validate email address" that match docstrings and function names.
- Higher `code_weight` — Better for queries that describe implementation patterns like "loop through items and sum prices".

**Response:**

```json
[
  {
    "symbol_name": "calculate_shipping",
    "qualified_name": "calculate_shipping",
    "file_path": "src/orders/pricing.py",
    "type": "function",
    "line_start": 45,
    "line_end": 62,
    "source_code": "def calculate_shipping(order, rate):\n    \"\"\"Calculate the total shipping cost based on weight and destination.\"\"\"\n    ...",
    "score": 0.8432,
    "docstring": "Calculate the total shipping cost based on weight and destination."
  }
]
```

Results are sorted by score (highest first). The full source code is included so agents can work with it immediately without a follow-up request.

---

### `POST /findReferences` — Find Symbol References

Find all code that references a specific function, class, or method — or find everything a symbol depends on. This is the equivalent of "Find All References" and "Go to Definition" in an IDE.

**When to use:**

- Before refactoring a function, to understand what will break.
- To trace call chains and understand how code flows.
- To find all usages of a class or function across the codebase.

**Request:**

- `symbol_name` (required) — The name of the function, class, or method.
- `file_path` (optional) — The file where the symbol is defined. Required if multiple files define symbols with the same name.
- `direction` (optional, default `"both"`) — Which references to return:
  - `"inbound"` — Code that calls/imports/uses this symbol (who depends on me?).
  - `"outbound"` — Code that this symbol calls/imports/uses (what do I depend on?).
  - `"both"` — Both directions.

```bash
# Find everything that calls the 'add' function in utils.py
curl -X POST http://localhost:8000/findReferences \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "src/utils.py",
    "symbol_name": "add",
    "direction": "inbound"
  }'
```

```bash
# Find what 'calculate_total' depends on
curl -X POST http://localhost:8000/findReferences \
  -H "Content-Type: application/json" \
  -d '{
    "symbol_name": "calculate_total",
    "direction": "outbound"
  }'
```

**Response:**

```json
[
  {
    "source_file": "src/main.py",
    "source_symbol": "calculate_total",
    "target_symbol_name": "add",
    "target_file_path": "src/utils.py",
    "type": "import",
    "line_number": 1
  },
  {
    "source_file": "src/main.py",
    "source_symbol": "calculate_total",
    "target_symbol_name": "add",
    "target_file_path": "src/utils.py",
    "type": "call",
    "line_number": 5
  }
]
```

Each reference includes:
- Where the reference is (`source_file`, `source_symbol`, `line_number`).
- What it references (`target_symbol_name`, `target_file_path`).
- How it references it (`type`): `import`, `call`, `assignment`, or `destructure`.

**Ambiguous names:** If you omit `file_path` and multiple files define a symbol with that name, the server returns a `422` with a list of candidates so you can disambiguate:

```json
{
  "detail": {
    "message": "Ambiguous symbol name",
    "candidates": [
      {"qualified_name": "process", "file_path": "src/a.py"},
      {"qualified_name": "process", "file_path": "src/b.py"}
    ]
  }
}
```

---

---

### `POST /clear` — Clear All Data

Removes all indexed files, symbols, references, and embeddings. Resets the index to a clean state.

**When to use:** When you want to re-index a project from scratch, or when switching to a different project on the same server instance.

```bash
curl -X POST http://localhost:8000/clear
```

**Response:**

```json
{
  "status": "cleared"
}
```

After clearing, `/status` will report all zeros and `/check-file` will report all files as `"unknown"`.

---

### `GET /overview` — Repository Overview

Returns a compressed, structured view of the entire indexed repository. Files are ranked by importance (how many other files depend on them), and each file includes its symbols, dependency relationships, and an LLM-generated summary of what it does.

**When to use:** When an agent needs to understand the structure of a codebase before diving into specific files. This is the "big picture" endpoint — it answers "what is this project and how is it organized?"

```bash
curl http://localhost:8000/overview
```

**Response:**

```json
{
  "total_files": 3,
  "total_symbols": 8,
  "total_references": 12,
  "files": [
    {
      "path": "src/utils.py",
      "language": "python",
      "summary": "Utility module providing core math operations (add, multiply) used across the project.",
      "symbols": [
        {
          "name": "add",
          "qualified_name": "add",
          "type": "function",
          "parameters": "a, b",
          "docstring": "Add two numbers."
        },
        {
          "name": "multiply",
          "qualified_name": "multiply",
          "type": "function",
          "parameters": "a, b",
          "docstring": null
        }
      ],
      "inbound_reference_count": 5,
      "outbound_reference_count": 0,
      "depends_on": [],
      "depended_on_by": ["src/main.py", "src/calc.py"]
    },
    {
      "path": "src/main.py",
      "language": "python",
      "summary": "Entry point that calculates totals using utility functions.",
      "symbols": [...],
      "inbound_reference_count": 0,
      "outbound_reference_count": 3,
      "depends_on": ["src/utils.py"],
      "depended_on_by": []
    }
  ]
}
```

Files are sorted by `inbound_reference_count` descending — the most depended-on files appear first. This gives agents a natural reading order: understand the core modules first, then the code that uses them.

**Summaries** are generated by an LLM (via Ollama, configurable with `ROSE_OLLAMA_GENERATION_MODEL`) at index time during `/update-file`. If the LLM is unavailable, summaries are `null` but everything else still works.

---

## Typical Workflow

A typical client integration follows this pattern:

```
1. On project open / file save:
   POST /check-file  →  send all file paths + hashes
                         get back which are stale/unknown

2. For each stale/unknown file:
   POST /update-file  →  send file path + content
                          get back broken references

3. After all updates:
   GET /status         →  verify no unresolved references remain

4. During development:
   POST /search         →  "how does authentication work?"
   POST /findReferences →  "what calls this function?"
```

## Development

```bash
uv sync                     # Install dependencies
uv run pytest -v            # Run all 67 tests
uv run roselibrary          # Start the server
```

## Reference Tracking

RoseLibrary tracks four types of references between symbols:

| Type | Python Example | JavaScript Example |
|---|---|---|
| `import` | `from .utils import helper` | `import { helper } from './utils'` |
| `call` | `helper(42)` | `helper(42)` |
| `assignment` | `fn = helper` | `const fn = helper` |
| `destructure` | `a, b = get_pair()` | `const { a, b } = obj` |

**What is tracked:**
- Aliased imports (`import { foo as bar }`, `from x import y as z`)
- Single-hop re-exports (`export { foo } from './other'`)
- Direct reassignment of imported names
- Single-level destructuring

**What is not tracked:**
- Third-party packages (node_modules, pip packages)
- Multi-level reassignment through functions or arrays
- Dynamic imports or computed property access
- TypeScript type-only imports (`import type { Foo }`) — these have no runtime references
- TypeScript interfaces and type aliases — these are not runtime symbols
