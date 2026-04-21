# ProjectRose

An extensible desktop coding IDE with a built-in AI agent. Bring your own LLM provider.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     RoseEditor (Electron)                        │
│                                                                  │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Monaco     │  │ Integrated   │  │ AI Chat Panel            │ │
│  │ Code       │  │ Terminal     │  │ (streaming responses,    │ │
│  │ Editor     │  │ (xterm.js)   │  │  tool-call visualization)│ │
│  └────────────┘  └──────────────┘  └──────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  AI Service  (Vercel AI SDK v6, in-process)                  ││
│  │  Tools: read_file, write_file, list_directory,               ││
│  │         search_code, find_references, run_command            ││
│  └──────────────────────┬───────────────────────────────────────┘│
└─────────────┬───────────┼───────────────────────────────────────┘
              │           │
        HTTP :8000     LLM API
              │           │
  ┌───────────▼───┐  ┌────▼──────────────────────────────────────┐
  │  RoseLibrary  │  │  LLM Providers                            │
  │  (optional)   │  │                                           │
  │  Code intel   │  │  Anthropic · OpenAI · Ollama (local)      │
  │  Symbol index │  │  OpenAI-compatible · AWS Bedrock          │
  │  Semantic     │  │                                           │
  │  search       │  │  Configured in Settings → Models          │
  └───────────────┘  └───────────────────────────────────────────┘
```

## Components

### RoseEditor

The desktop IDE, built with **Electron**, **React 19**, and **TypeScript**.

- **Monaco Editor** — Full-featured code editor with syntax highlighting, IntelliSense, and multi-cursor support
- **Integrated Terminal** — xterm.js-based terminal with PTY support
- **AI Chat Panel** — Conversational interface that streams responses from the configured LLM and displays tool calls in real-time
- **AI Service** — Runs entirely inside the Electron main process using the **Vercel AI SDK v6**. When the model calls a tool (read a file, write code, search the codebase, run a command), the handler executes the action on the local filesystem and feeds the result back for the next iteration — no separate process or HTTP round-trip required
- **File Indexing** — Automatically keeps RoseLibrary's index up to date as the AI writes or modifies files (when RoseLibrary is running)

### RoseLibrary

An **optional** Python/FastAPI code intelligence server that indexes your codebase and makes it searchable.

- **Tree-sitter parsing** — Extracts functions, classes, methods, and variables from Python, JavaScript, and TypeScript source files
- **Symbol graph** — Tracks definitions and references across files using SQLite, building a navigable dependency graph
- **Semantic search** — Embeds code and metadata into ChromaDB vector collections, enabling natural language queries like "find the authentication middleware"
- **Reference finding** — Locates all inbound and outbound references for any symbol across the entire indexed codebase
- **Repository overview** — Ranks files by importance and generates LLM-powered summaries

**API endpoints:** `/check-file`, `/update-file`, `/status`, `/search`, `/findReferences`, `/overview`, `/clear`

## Extension System

RoseEditor ships with four built-in views: **Chat**, **Editor**, **Heartbeat**, and **Settings**. Everything else is an extension — installable on demand via **Settings → Extensions** or the [website](https://github.com/RoseAgent/ProjectRose).

### First-party extensions

| Extension | ID | Description |
|---|---|---|
| Discord | `rose-discord` | Read and send Discord channel messages |
| Email | `rose-email` | IMAP inbox access for the AI agent |
| Git | `rose-git` | Git log, diff, and branch management |
| Docker | `rose-docker` | Container and image management |
| Listen | `rose-listen` | Active listening via microphone |

### Extension capabilities

Each extension can provide any combination of:
- **Page view** — a full tab added to the nav bar
- **Global settings** — configuration stored in the app's user data
- **Project settings** — configuration stored in `.rose/config.json` alongside your code
- **Agent tools** — new tools the AI can call during chat sessions

Extensions are installed to `<userData>/extensions/<id>/` and appear in the nav bar immediately — no restart required for first-party extensions.

## LLM Providers

Configure your provider in **Settings → Models**. All providers share the same tool-calling interface.

| Provider | Notes |
|---|---|
| **Anthropic** | Claude models via `api.anthropic.com` |
| **OpenAI** | GPT models via `api.openai.com` |
| **Ollama** | Fully local inference on `localhost:11434` |
| **OpenAI-compatible** | Any server that speaks the OpenAI API (LM Studio, vLLM, etc.) |
| **AWS Bedrock** | Claude and other models via AWS |

Multiple model configurations can be saved and switched per-project. A router model can be configured to automatically select the best model for each request.

## How It Works

The agentic loop runs entirely inside the Electron main process:

1. **User sends a message** in the Chat panel
2. **RoseEditor builds a system prompt** using project context (ROSE.md), heartbeat summaries, and active extension tools
3. **Vercel AI SDK calls the configured LLM** with the conversation history and available tools
4. **If the model requests a tool call** (e.g., `read_file`, `search_code`, `run_command`), the in-process handler executes it against the local filesystem
5. **The tool result is fed back** to the model for the next iteration
6. **Steps 3–5 repeat** until the model produces a final response (up to 100 tool steps per message)
7. **RoseEditor streams** tokens and tool calls to the UI in real-time

No backend processes, no callback servers, no network round-trips for tool execution.

## Prerequisites

- **[Node.js](https://nodejs.org/) 20+** and **npm** — required to build and run RoseEditor
- **LLM provider** — one of:
  - An API key for Anthropic, OpenAI, or AWS Bedrock
  - **[Ollama](https://ollama.com)** running locally for fully offline inference
- **[Docker](https://www.docker.com/products/docker-desktop/)** — optional, only needed to run RoseLibrary for code intelligence

## Quick Start

```bash
# Install dependencies and build
make build

# Launch in dev mode
make run
```

Then open **Settings → Models** to configure your LLM provider.

**Optional — start RoseLibrary for code intelligence:**
```bash
make up      # starts RoseLibrary on :8000
```

## Building

```bash
# Package as a distributable installer
make dist
```

Output is written to `RoseEditor/release/`. GitHub Actions (`.github/workflows/release.yml`) builds for Windows, macOS, and Linux on every `v*` tag push and attaches the artifacts to a GitHub Release.

## Makefile Reference

| Target | Description |
|---|---|
| `build` | Install npm dependencies and build RoseEditor |
| `run` | Launch RoseEditor in development mode |
| `dist` | Package RoseEditor as a platform installer |
| `up` | Start RoseLibrary in production mode (Docker) |
| `down` | Stop RoseLibrary |
| `dev` | Start RoseLibrary with hot reload (Docker) |
| `dev-down` | Stop dev RoseLibrary |
| `logs` | Tail logs from RoseLibrary container |
| `start` | Start RoseLibrary then launch editor |
| `clean` | Remove Docker volumes and build artifacts |
| `help` | Show all available targets |

## Project Structure

```
ProjectRose/
├── RoseEditor/          # Electron + React desktop IDE
│   ├── src/
│   │   ├── main/        # Electron main process (IPC, AI service, tools)
│   │   ├── preload/     # Context bridge
│   │   ├── renderer/    # React UI components and stores
│   │   └── shared/      # Types and IPC channel definitions
│   └── package.json
├── RoseLibrary/         # Optional code intelligence server
│   ├── src/roselibrary/
│   │   ├── models/      # Database and schemas
│   │   ├── parsing/     # Tree-sitter symbol extraction
│   │   ├── indexing/    # Embeddings and vector store
│   │   └── routes/      # API endpoints
│   └── pyproject.toml
├── RoseTrainer/         # Model fine-tuning utilities
├── extensions/          # First-party extension manifests and registry
│   ├── registry.json    # Extension catalog (fetched by website and in-app store)
│   ├── rose-discord/
│   ├── rose-email/
│   ├── rose-git/
│   ├── rose-docker/
│   └── rose-listen/
├── website/             # Next.js marketing site (Vercel)
│   └── app/             # /download, /extensions, /docs pages
├── .github/workflows/   # CI: release builds for Win/Mac/Linux
├── docker-compose.yml   # RoseLibrary production deployment
├── Makefile
└── README.md
```
