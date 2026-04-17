# ProjectRose

A fully local agentic coding platform. ProjectRose combines a desktop code editor with two backend services to deliver AI-assisted development that runs entirely on your machine — no cloud APIs, no telemetry, no data leaving your network.

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
│  │  AI Callback Server  (127.0.0.1:ephemeral)                   ││
│  │  Exposes tools: read_file, write_file, list_directory,       ││
│  │  search_code, find_references, run_command                   ││
│  └──────────────────────┬───────────────────────────────────────┘│
└─────────────┬───────────┼───────────────────────────────────────┘
              │           │
     HTTP :8000      HTTP :8010
              │           │
  ┌───────────▼───┐  ┌────▼──────────────┐
  │  RoseLibrary  │  │  RoseModel        │
  │               │  │                   │
  │  Code intel   │  │  AI agent with    │
  │  Symbol index │  │  tool-calling     │
  │  Semantic     │  │  loop, knowledge  │
  │  search       │  │  base & skills    │
  │  Reference    │  │                   │
  │  finding      │  │  Streams SSE      │
  └───────┬───────┘  └────────┬──────────┘
          │                   │
          │   ┌───────────┐   │
          └──►│  Ollama   │◄──┘
              │ :11434    │
              │ Local LLM │
              └───────────┘
```

## Components

### RoseEditor

The desktop IDE, built with **Electron**, **React 19**, and **TypeScript**.

- **Monaco Editor** — Full-featured code editor with syntax highlighting, IntelliSense, and multi-cursor support
- **Integrated Terminal** — xterm.js-based terminal with PTY support for running shell commands
- **AI Chat Panel** — Conversational interface that streams responses from RoseModel and displays tool calls in real-time
- **AI Callback Server** — A local HTTP server spun up inside the Electron main process on an ephemeral port. When the AI decides to use a tool (read a file, write code, search the codebase), RoseModel calls back to this server, which executes the action on the user's filesystem and returns the result
- **File Indexing** — Automatically keeps RoseLibrary's index up to date as the AI writes or modifies files

The editor communicates with both backend services over HTTP — RoseLibrary on port 8000 for code intelligence and RoseModel on port 8010 for AI generation.

### RoseLibrary

A **Python/FastAPI** code intelligence server that indexes your codebase and makes it searchable.

- **Tree-sitter parsing** — Extracts functions, classes, methods, and variables from Python, JavaScript, and TypeScript source files
- **Symbol graph** — Tracks definitions and references across files using SQLite, building a navigable dependency graph
- **Semantic search** — Embeds code and metadata into ChromaDB vector collections using Ollama, enabling natural language queries like "find the authentication middleware"
- **Reference finding** — Locates all inbound and outbound references for any symbol, across the entire indexed codebase
- **Repository overview** — Ranks files by importance (reference count, symbol density) and generates LLM-powered summaries

**API endpoints:** `/check-file`, `/update-file`, `/status`, `/search`, `/findReferences`, `/overview`, `/clear`

### RoseModel

A **Python/FastAPI** AI agent server that orchestrates LLM-powered coding assistance.

- **Agentic tool loop** — Sends the user's message to a local LLM (via Ollama), and when the model requests a tool call, executes it through the editor's callback server, feeds the result back, and loops until the model produces a final answer. Supports up to 100 iterations per request.
- **Streaming responses** — Uses Server-Sent Events (SSE) to stream tokens, tool calls, tool results, and context warnings to the editor in real-time
- **Knowledge base** — Markdown files in `prompts/knowledge/` are embedded into ChromaDB on startup. Relevant knowledge is automatically retrieved and injected into the system prompt based on the user's question.
- **Skill system** — Markdown files in `prompts/skills/` define specialized behaviors. The LLM dynamically selects which skills are relevant to each conversation and they are injected into the system prompt.
- **Context management** — When conversations grow long (>40 messages), automatically compresses earlier messages into a summary to stay within context limits

**API endpoints:** `/generate` (SSE streaming), `/compress`

## How It Works

The agentic loop is the core of ProjectRose:

1. **User sends a message** in the RoseEditor chat panel
2. **RoseEditor forwards it** to RoseModel's `/generate` endpoint via HTTP, along with the conversation history and a list of available tools (each with a callback URL pointing back to the editor's callback server)
3. **RoseModel builds a system prompt** by combining its internal instructions (`prompts/agent.md`), dynamically selected skills, and relevant knowledge documents retrieved from its vector store
4. **RoseModel streams the LLM response** token by token via SSE back to the editor
5. **If the LLM requests a tool call** (e.g., `read_file`, `search_code`), RoseModel executes it by POSTing to the editor's callback server
6. **The callback server handles the tool** — reading files from disk, writing code, listing directories, running shell commands, or querying RoseLibrary for search results and references
7. **The tool result flows back** to RoseModel, which appends it to the conversation and sends it back to the LLM for the next iteration
8. **Steps 4-7 repeat** until the LLM produces a final text response with no tool calls
9. **RoseEditor displays** the complete response, including a log of all tool calls made during the generation

This architecture means the AI can autonomously read your code, search for relevant symbols, write changes, and verify them — all running locally with no external API calls.

## Prerequisites

- **[Ollama](https://ollama.com)** — Local LLM runtime. Must be running on `localhost:11434`.
- **Ollama models** — Pull the required models before first run:
  ```bash
  ollama pull glm-4.7-flash
  ollama pull snowflake-arctic-embed2
  ollama pull nomic-embed-text
  ```
- **[Docker](https://www.docker.com/products/docker-desktop/)** — For running the backend servers
- **[Node.js](https://nodejs.org/) 20+** and **npm** — For building and running RoseEditor

## Quick Start

```bash
# 1. Start Ollama (if not already running)
ollama serve

# 2. Start both backend servers
make up

# 3. Launch the editor in dev mode
make run
```

Or use `make start` to do steps 2 and 3 together.

## Development

For active development on the backend servers with hot reload:

```bash
# Start servers with file watching (source changes auto-reload)
make dev

# In another terminal, launch the editor
make run
```

Edit files in `RoseLibrary/src/` or `RoseModel/app/` and the servers will automatically restart.

## Building the Editor

```bash
# Install dependencies and compile
make build

# Package as a Windows installer (.exe)
make dist
```

The installer is output to `RoseEditor/release/`.

## Makefile Reference

| Target     | Description                                        |
|------------|----------------------------------------------------|
| `build`    | Install npm dependencies and build RoseEditor      |
| `run`      | Launch RoseEditor in development mode              |
| `dist`     | Package RoseEditor as a Windows installer          |
| `up`       | Start backend servers in production mode (Docker)  |
| `down`     | Stop production servers                            |
| `dev`      | Start backend servers with hot reload (Docker)     |
| `dev-down` | Stop dev servers                                   |
| `logs`     | Tail logs from production server containers        |
| `start`    | Start servers then launch editor (combined)        |
| `clean`    | Remove Docker volumes and build artifacts          |
| `help`     | Show all available targets                         |

## Project Structure

```
ProjectRose/
├── RoseEditor/          # Electron + React desktop IDE
│   ├── src/
│   │   ├── main/        # Electron main process (IPC, services)
│   │   ├── preload/     # Context bridge
│   │   ├── renderer/    # React UI components
│   │   └── shared/      # Shared types and IPC channel definitions
│   └── package.json
├── RoseLibrary/         # Code intelligence server
│   ├── src/roselibrary/
│   │   ├── models/      # Database and schemas
│   │   ├── parsing/     # Tree-sitter symbol extraction
│   │   ├── indexing/    # Embeddings and vector store
│   │   └── routes/      # API endpoints
│   └── pyproject.toml
├── RoseModel/           # AI agent server
│   ├── app/             # FastAPI application
│   ├── prompts/         # Agent instructions, skills, knowledge
│   │   ├── agent.md
│   │   ├── skills/
│   │   └── knowledge/
│   └── requirements.txt
├── docker-compose.yml       # Production server deployment
├── docker-compose.dev.yml   # Development with hot reload
├── Makefile                 # Build and run targets
└── README.md
```
