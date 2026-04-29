# ProjectRose

ProjectRose is an AI-native desktop IDE and **agent harness** — a platform where AI agents act on your development environment directly: editing code, running commands, managing infrastructure, and communicating on your behalf. It pairs a full-featured code editor with a built-in agent runtime and an extensible plugin ecosystem.

![ProjectRose — editor, terminal, and AI agent panel](screenshots/editor--view.png)

## Editor

- Monaco Editor (the VS Code engine) with syntax highlighting, IntelliSense, and quick-open file search
- Integrated terminal with full PTY support
- Language Server Protocol for TypeScript and Python (Pyright)
- Multi-file tab management with session persistence

## Agent Runtime

The agent panel lives natively in the IDE sidebar. Agents are tool-use enabled, meaning they invoke extensions to act — not just describe actions.

- **Configurable**: system prompt customization and session management per project
- **Action-oriented**: agents call extension tools directly, with results flowing back into the conversation

![Agent panel with session management and AI chat](screenshots/chat--view.png)

### Supported AI Providers

| Provider | Models |
|----------|--------|
| **Ollama** | Any locally-running model (Llama, Mistral, Gemma, etc.) |
| **Anthropic** | Claude (Opus, Sonnet, Haiku) |
| **OpenAI** | GPT-4o, GPT-4, and others |
| **Amazon Bedrock** | Claude, Llama, Titan, and other hosted models |

## Extensions

Extensions add capabilities the agent can call as tools — and, optionally, UI panels in the sidebar. Each extension lives in its own repo and installs from the in-app store. The known extensions today: `rose-crm`, `rose-discord`, `rose-docker`, `rose-email`, `rose-git`, and `rose-heartbeat` (a background process that processes deferred notes and runs scheduled agent tasks).
