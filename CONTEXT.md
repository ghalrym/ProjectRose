# ProjectRose

ProjectRose is an **Agent Desktop** — a desktop OS-like layer that agents live in. The Electron app is the desktop, extensions are the apps, and the editor and chat are first-party apps shipped with the desktop.

## Language

**Agent Desktop**:
The product itself — the Electron app that hosts agents and the extensions they use. Preferred over "IDE" or "personal assistant", both of which describe a *configuration* of the desktop (which extensions are installed), not the desktop itself.
_Avoid_: IDE, assistant, harness, app (when referring to ProjectRose as a whole)

**Agent**:
A single persistent identity on a machine, stored at `~/.rose/`, that operates on **Workspaces**. One Agent per machine — there is no notion of multiple Agents to switch between. The Agent owns its system prompt (`~/.rose/ROSE.md`), model + provider configuration, and memory; a **Workspace** contributes optional project-specific operating instructions and per-project enable/disable + settings for installed **Extensions**. Running an agent means starting a **Turn** inside a **Conversation** with it; the LLM-loop instance is the **Turn**, not the agent itself.
_Avoid_: bot, assistant (lowercase), AI

**Conversation**:
A persistent, resumable thread of turns the user holds with an agent in the chat panel. Identified in the code as `sessionId`.
_Avoid_: chat, session (bare), thread, history

**Turn**:
A single cycle of "one user message → one agent response", together with the per-turn scratch state (abort signal, pending ask-user resolvers, modified-files list, per-extension injection budget). Constructed at the start of the cycle, disposed at the end.
_Avoid_: chat session, request, message-pair

**Agent Handle**:
A live, in-memory, multi-turn handle that an **Extension** opens against an **Agent** to talk to it programmatically (not user-visible). Returned by the `openAgentSession` capability. Distinct from a **Conversation** (no persistence) and from a **Turn** (spans many turns).
_Avoid_: agent session (when speaking canonically), sub-conversation

**Extension**:
An installable unit that adds capability to the **Agent Desktop** — tools the agent can call, hooks that fire on chat events, and optionally a UI panel. The single word covers both panelled and headless extensions; we do *not* distinguish "app" vs "service" at the language level. Lives in `RoseExtensions/`.
_Avoid_: app, plugin, add-on, integration

**Workspace**:
The folder/scope an **Agent** operates inside for a given **Conversation** — the absolute `rootPath` the agent reads, writes, and runs commands within. Survives the IDE/assistant distinction: it can be a code repo or a CRM-data folder or a documents folder; the harness doesn't care. Bounded by `projectPathGuard.ts`.
_Avoid_: project, root, working directory, folder (as a domain noun)

**Skill**:
A workspace-scoped markdown how-to that an **Agent** loads on demand to learn a specific task. Lives at `<workspace>/skills/*.md` with `description:` frontmatter and a body. Not part of an **Extension**, not a **Tool** — it's instructional content the agent reads.
_Avoid_: playbook, recipe, guide, prompt template

**Tool**:
A named, schema-typed action an **Agent** can invoke during a **Turn**. Umbrella term covering both host-supplied tools (`ask_user`, `screenshot`, `write_file`, terminal, etc.) and **Extension Tools**.
_Avoid_: action, function (in domain talk), command

**Extension Tool**:
A **Tool** contributed by an **Extension** via `ctx.registerTools()`. Distinct from a built-in tool because it crosses a trust/sandbox boundary — the extension's code, not the host's, executes when the agent calls it. Must agree with the manifest's `provides.tools[]` declaration on names.
_Avoid_: plugin tool, addon tool, third-party tool

**Hook**:
An **Extension**'s registered subscription to a chat event during a **Turn** (`on_thought`, `on_message`, `on_tool_call`, `on_user_message`, `on_token`). Has a handler, a type, and a priority. Hooks can be notification-only or can return an **Injection**.
_Avoid_: listener, interceptor, callback, watcher

**Injection**:
Content a **Hook** adds to a **Turn** by returning `{ inject: string }` from its handler. The unit of measurement for the per-extension injection budget and the target of the `first-wins` vs `all` injection policy. Not every hook produces one (`on_token` is notification-only).
_Avoid_: hook output, inject, contribution

**Worker**:
A transient, task-scoped LLM run that an **Agent** dispatches during a **Turn** to do a delegated piece of work (e.g., read-only codebase exploration). Has its own system prompt and a scoped tool set (often with destructive tools disabled). Dies when its task finishes. *Not* a persistent identity — distinct from **Agent**.
_Avoid_: subagent (in canonical talk), child agent, sub-agent

**Detached Run**:
A one-shot LLM run an **Extension** triggers via `runBackgroundAgent` — runs in isolation, returns a single result, no chat hooks fire. Sibling to **Worker** (also transient, also not an Agent), but not nested inside a **Turn**; the trigger is the extension, not an agent.
_Avoid_: background agent (in canonical talk), background run, headless agent

**Scheduled Task**:
A first-party concept owned by the **rose-heartbeat** Extension. A markdown file in `<workspace>/.projectrose/tasks/*.md` with YAML frontmatter (including a `recurrence` like `1d`, `2h`, `1mo`) and a body. The Heartbeat extension picks up due tasks on each tick, runs each one as a **Detached Run**, and writes the agent's findings back into the task body's agent-maintained `## Memory` section. The host knows nothing about scheduling — this concept lives entirely in the extension.
_Avoid_: cron job, recurring agent, deferred work item, todo

**Memory**:
The Agent's agent-global record of its life with the user, stored under `~/.rose/memory/`. Comprises three concept types:
- **Diary** — daily entry at `~/.rose/memory/diary/{yyyy}/{mm}/{dd}.md`, written by the host's diary scheduler in Traditional Narrative Structure (Header → Intro → Events → Reflection → Outlook).
- **Behavior Record** — a markdown file at `~/.rose/memory/behavior-records/{yyyy-mm-dd}-{slug}.md` capturing a standing directive the user has given the Agent ("from now on always X"). `## Decision` + `## Details` sections. Not to be confused with **ADR** (Architectural Decision Record at `docs/adr/`) — Behavior Records are about Agent conduct, ADRs are about codebase architecture.
- **Contact** — one markdown file per entity at `~/.rose/memory/contact/{entity}.md`, `# Entity: Name` followed by a `- kind: <person|business|website|other>` bullet and then bullets that are either structured-by-convention (`email:`, `phone:`, `address:`, `url:`, `org:`, `title:`) or freeform notes. Distinct from **rose-crm** contacts, which are structured business records (email/phone/company) in workspace-scoped JSON. The user manages these in the **rose-contacts** built-in extension — opened from the App Board, with a per-field detail editor and Google sync controls under its drawer-cog SettingsView. (Built-in extensions ship inside the host repo, are always loaded, and cannot be uninstalled — see ADR 0010.) Google integration is BYO-credentials: the user creates their own OAuth client in Google Cloud Console and pastes the clientId + clientSecret into **Settings > Providers > Google** — see ADR 0009 (which supersedes ADR 0008's PKCE-only model). Google's structured fields flatten into the same bullet labels the editor edits, sharing a parser/serializer at `src/shared/contactFields.ts`; the on-disk file format does not change. The Google-sync filter is per-kind — by default only `person` and `business` entries round-trip with Google.

Lives in the host because it is agent-global, not workspace-scoped (see ADR 0007). The host's chat session appends each main turn's user + assistant message to `~/.rose/memory/conversations/{date}.jsonl`, and the extension-context slicer logs every Detached Run / Agent Handle call to `~/.rose/memory/agent-activity/{date}.jsonl` — both feed the daily diary writer.
_Avoid_: notes (bare), journal, knowledge base, history (when speaking canonically)

## Relationships

- An **Agent Desktop** hosts a single **Agent** and many **Extensions**, and lets the **Agent** operate on many **Workspaces**.
- An **Agent** participates in one or more **Conversations** with the user, scoped to the **Workspace** the conversation is in.
- A **Conversation** is a sequence of **Turns**, each one a single message→response cycle.
- An **Agent** may dispatch **Workers** during a **Turn**.
- An **Extension** contributes tools, hooks, and optionally a UI panel that the user opens from the Apps Drawer (UI rename to "Extensions Drawer" is implied but not yet done).
- An **Extension** may open one or more **Agent Handles** to drive an **Agent** programmatically.

## Flagged ambiguities

- **"session" is overloaded in the code.** Three distinct lifetimes share the word:
  - `ChatSession` (per-turn scratch) → canonical name: **Turn**
  - `sessionId` (persistent thread) → canonical name: **Conversation** (`conversationId`)
  - `AgentSession` (extension's multi-turn handle) → canonical name: **Agent Handle**

  Code has not been reconciled with the canonical language; refer by canonical names in conversation and ADRs even when reading code that uses the old terms.

- **"project" in the code is the canonical "Workspace".** `recentProjects.ts`, `projectHandlers.ts`, `projectSettingsHandlers.ts`, `projectPathGuard.ts` all use "project" but refer to what the canonical language calls a **Workspace**. Do not interpret these as something distinct from a Workspace.

- **"subagent" in the code is the canonical "Worker".** `subagentTools.ts`, `AgentContext.agentIndex` (`0 = main agent, 1+ = subagents`), `saveSubagentSession`, and the `subagent:<label>` IPC events all refer to what the canonical language calls a **Worker**. Subagents are *not* a kind of **Agent** (which is a persistent identity); they are transient delegated runs.

- **"backgroundAgent" capability in the contract is the canonical "Detached Run".** `provides.backgroundAgent`, `ctx.runBackgroundAgent(...)`, and the capability label "Run scheduled background tasks" all refer to what the canonical language calls a **Detached Run**. A Detached Run is *not* an **Agent** (no persistent identity, no Persona); it is a one-shot LLM execution that an extension triggers.

- **"Bloom" in the code is the voice-mode visualisation of a Conversation, not the Conversation itself.** `BloomStage.tsx` is the animated orb that occupies the centre column of the chat view; the **Conversation** is the persistent thread of Turns, whose text appears in `ChatPanel`. When discussing the UI mode, say "bloom mode" (orb visible) vs "editor mode" (Monaco visible). Top-level `activeView` values are `'chat' | 'editor' | 'settings' | 'account'`; "bloom mode" is `activeView === 'chat'`.
