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

## Installing on macOS

ProjectRose isn't signed by an Apple Developer ID yet, so the first launch is blocked by Gatekeeper with a "damaged" or "unidentified developer" warning. After dragging the app from the DMG into `Applications`, clear the quarantine attribute once:

```sh
xattr -dr com.apple.quarantine /Applications/ProjectRose.app
```

No-terminal alternative: right-click the app in Finder → **Open** → click **Open** in the dialog that appears. macOS remembers the choice for subsequent launches. Auto-updates are disabled on macOS until the app is signed.

## Extensions

Extensions add capabilities the agent can call as tools — and, optionally, UI panels in the sidebar. Each extension lives in its own repo and installs from the in-app store. The known extensions today: `rose-crm`, `rose-discord`, `rose-docker`, `rose-email`, `rose-git`, and `rose-heartbeat` (a background process that processes deferred notes and runs scheduled agent tasks).

## Connecting Google services

Google Contacts sync (and future Gmail / Calendar / Drive integrations) requires you to supply your own Google OAuth credentials. ProjectRose is open source so it doesn't — and can't — ship a shared client secret. **Settings → Providers → Google** has an inline walkthrough: create a Google Cloud project, enable the People API, generate an OAuth 2.0 client ID of type "Desktop app", and paste the two values into the form. Your credentials stay on your computer (the secret is sealed with the OS keychain). See [ADR 0009](docs/adr/0009-byo-google-oauth-credentials.md) for the rationale.
