# Write Extension

Create a fully functional ProjectRose extension from scratch.

The user may supply a description in `$ARGUMENTS`. If omitted, ask what the extension should do before proceeding.

---

## What a ProjectRose Extension Is

A ProjectRose extension is a set of TypeScript source files that live in the `RoseExtensions/` directory at the repo root. An extension can:

- Add a **page** to the sidebar nav (`PageView` component exported from `renderer.ts`)
- Add a **settings panel** to the settings sidebar (`SettingsView` component exported from `renderer.ts`)
- Register **AI tools** the agent can call (`register()` in `main.ts` + `ctx.registerTools()`)
- Run **background logic** in the main process (`register()` in `main.ts`)

---

## Folder Structure

```
RoseExtensions/
└── rose-{name}/
    ├── rose-extension.json        # Manifest — required
    ├── renderer.ts                # Re-exports PageView / SettingsView from src/
    ├── main.ts                    # Exports register() from src/ (if provides.main)
    └── src/
        ├── renderer/
        │   ├── MyView.tsx         # PageView component
        │   ├── MyView.module.css  # CSS Modules — supported
        │   └── MySettings.tsx     # SettingsView component (optional)
        └── main/
            ├── types.ts           # Local type definitions
            ├── handlers.ts        # IPC handler registration
            └── tools.ts           # Tool definitions (optional)
```

---

## 1. Manifest — rose-extension.json

```json
{
  "id": "rose-{name}",
  "name": "Display Name",
  "version": "1.0.0",
  "description": "One-line description",
  "author": "ProjectRose",
  "navItem": { "label": "Label", "iconName": "icon" },
  "provides": {
    "pageView": true,
    "globalSettings": true,
    "main": true,
    "agentTools": true,
    "tools": [
      {
        "name": "tool_name",
        "displayName": "Tool Name",
        "description": "What this tool does"
      }
    ]
  }
}
```

**Field rules:**
- `id` — kebab-case, prefix `rose-`. Must be unique.
- `navItem` — omit entirely if the extension has no sidebar page.
- `provides.pageView` — `true` if `renderer.ts` exports `PageView`.
- `provides.globalSettings` — `true` if `renderer.ts` exports `SettingsView`.
- `provides.main` — `true` if `main.ts` is included.
- `provides.agentTools` + `provides.tools` — only needed if registering AI tools.

---

## 2. renderer.ts (entry point)

This file re-exports components from `src/renderer/` and the manifest. The build script compiles it to a CJS bundle.

```ts
export { default as manifest } from './rose-extension.json'
export { MyView as PageView } from './src/renderer/MyView'
export { MySettings as SettingsView } from './src/renderer/MySettings'
```

### Component source — src/renderer/MyView.tsx

```tsx
import { useSettingsStore } from '@renderer/stores/useSettingsStore'
import { useProjectStore } from '@renderer/stores/useProjectStore'
import styles from './MyView.module.css'

export function MyView(): JSX.Element {
  const rootPath = useProjectStore(s => s.rootPath)
  return (
    <div className={styles.container}>
      <h2>My Extension</h2>
      <p>Project: {rootPath}</p>
    </div>
  )
}
```

### Available store imports (renderer)

```ts
import { useProjectStore }  from '@renderer/stores/useProjectStore'   // rootPath
import { useSettingsStore } from '@renderer/stores/useSettingsStore'   // settings, update()
import { useChatStore }     from '@renderer/stores/useChatStore'
import { useFileStore }     from '@renderer/stores/useFileStore'
import { useThemeStore }    from '@renderer/stores/useThemeStore'
import { useViewStore }     from '@renderer/stores/useViewStore'
import { useServiceStore }  from '@renderer/stores/useServiceStore'
```

### Reading and writing extension settings

Extension settings are stored on the top-level `AppSettings` object. Add new fields to `AppSettings` in `ProjectRose/src/main/ipc/settingsHandlers.ts` and `ProjectRose/src/renderer/src/stores/useSettingsStore.ts` if needed.

```tsx
// Read top-level settings
const { myExtensionApiKey, myExtensionEnabled, update } = useSettingsStore()

// Write them back
update({ myExtensionApiKey: newValue })
update({ myExtensionEnabled: true })
```

### Calling main-process handlers from the renderer

```ts
const result = await window.api.invoke('rose-{name}:some-action', arg1, arg2) as { ok: boolean }
```

### SettingsView example — src/renderer/MySettings.tsx

```tsx
import { useSettingsStore } from '@renderer/stores/useSettingsStore'

export function MySettings(): JSX.Element {
  const { myExtensionApiKey, update } = useSettingsStore()

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          API Key
        </div>
        <input
          type="password"
          placeholder="Enter API key…"
          value={myExtensionApiKey ?? ''}
          onChange={(e) => update({ myExtensionApiKey: e.target.value })}
          style={{ width: '100%', padding: '6px 10px', background: 'var(--color-input-bg, var(--color-bg))', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm, 4px)', color: 'var(--color-text-primary)', fontSize: 13, boxSizing: 'border-box' }}
        />
      </div>
    </div>
  )
}
```

### CSS Modules

CSS Modules work in extensions — import a `.module.css` file and use the class map. The build script handles scoping automatically.

---

## 3. main.ts (entry point, optional)

Exports a single `register(ctx)` function. Keep it thin — delegate to `src/main/`.

```ts
import { registerHandlers } from './src/main/handlers'
import { MY_TOOLS } from './src/main/tools'
import type { ExtensionMainContext } from './src/main/types'

export function register(ctx: ExtensionMainContext): () => void {
  ctx.registerTools(MY_TOOLS)
  return registerHandlers(ctx)
}
```

### src/main/types.ts

Define the types locally — do not import from the host app.

```ts
export interface ExtensionToolEntry {
  name: string
  description: string
  schema: Record<string, unknown>
  execute: (input: Record<string, unknown>, projectRoot: string) => Promise<string>
}

export interface ExtensionMainContext {
  rootPath: string
  getSettings: () => Promise<Record<string, unknown>>
  updateSettings: (patch: Record<string, unknown>) => Promise<void>
  broadcast: (channel: string, data: unknown) => void
  registerTools: (tools: ExtensionToolEntry[]) => void
  runBackgroundAgent: (prompt: string, systemPrompt: string) => Promise<string>
  registerHooks: (hooks: ChatHook[]) => void
  openAgentSession: (opts: { systemPrompt: string }) => AgentSession
}

export type HookType = 'on_thought' | 'on_message' | 'on_tool_call'

export type HookEvent =
  | { type: 'on_thought'; content: string; turnId: string }
  | { type: 'on_message'; content: string; turnId: string }
  | { type: 'on_tool_call'; toolName: string; params: Record<string, unknown>; result: string; error: boolean; turnId: string }

export interface ChatHook {
  type: HookType
  handler: (event: HookEvent) => Promise<{ inject?: string } | void> | { inject?: string } | void
  // Defaults to false (one injection per user turn). Set true to allow up to
  // 5 injections per user turn from this extension.
  allowMultiple?: boolean
}

export interface AgentSession {
  send: (text: string) => Promise<string>
  close: () => void
}
```

### src/main/handlers.ts

```ts
import { ipcMain } from 'electron'
import type { ExtensionMainContext } from './types'

export function registerHandlers(ctx: ExtensionMainContext): () => void {
  ipcMain.handle('rose-{name}:fetch-items', async () => {
    const settings = await ctx.getSettings()
    const apiKey = String(settings['myExtensionApiKey'] ?? '')
    if (!apiKey) return { ok: false, error: 'No API key configured' }
    // do work…
    return { ok: true, items: [] }
  })

  ipcMain.handle('rose-{name}:create-item', async (_event, title: string, body: string) => {
    try {
      // do work…
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  return () => {
    ipcMain.removeHandler('rose-{name}:fetch-items')
    ipcMain.removeHandler('rose-{name}:create-item')
  }
}
```

### src/main/tools.ts

The schema must follow JSON Schema format: `type: 'object'` with a `properties` map. Use `required` for mandatory params.

```ts
import type { ExtensionToolEntry } from './types'

export const MY_TOOLS: ExtensionToolEntry[] = [
  {
    name: 'search_items',
    description: 'Search items by keyword. Returns a list of matching results.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        limit: { type: 'number', description: 'Max results to return (default 10)' }
      },
      required: ['query']
    },
    execute: async (args, projectRoot) => {
      const query = String(args.query ?? '')
      // do work using projectRoot…
      return JSON.stringify({ results: [] })
    }
  },
  {
    name: 'create_item',
    description: 'Create a new item with a title and body.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Item title' },
        body: { type: 'string', description: 'Item body text' }
      },
      required: ['title', 'body']
    },
    execute: async (args, _projectRoot) => {
      const title = String(args.title ?? '')
      const body = String(args.body ?? '')
      if (!title) return 'Missing title.'
      // do work…
      return `Item "${title}" created.`
    }
  }
]
```

### ExtensionMainContext API

```ts
ctx.rootPath                            // absolute path to project root
ctx.getSettings()                       // Promise<Record<string, unknown>>
ctx.updateSettings(patch)               // Promise<void>
ctx.broadcast(channel, data)            // send IPC event to all renderer windows
ctx.registerTools(tools)                // register AI tools
ctx.runBackgroundAgent(prompt, sys)     // one-shot agent run with a system prompt
ctx.registerHooks(hooks)                // observe + inject into the user's chat
ctx.openAgentSession({ systemPrompt })  // multi-turn agent session, returns { send, close }
```

### Chat hooks

Hooks let an extension observe and steer the user's main chat. Three event types:

- `on_thought` — fires once per completed thinking block. Hook may return `{ inject }`.
- `on_message` — fires once per completed assistant text segment. Hook may return `{ inject }`.
- `on_tool_call` — fires after every tool call (including `error: true`). Read-only; injection is ignored here.

When a hook returns `{ inject: 'text' }`, that text is added to the chat as a "guided agent" cell and sent to the model as a `role: 'system'` message in the next turn — which the agent answers immediately, before returning control to the user. The model never receives the cell label; only the text after `[Extension <name>] `.

**Important constraints:**

- Hooks are **synchronous**: the chat stream pauses while every hook awaits. No timeout — a hung hook hangs the chat. Keep handlers fast.
- Hooks fire in **registration order** (load order of extensions). The **first** hook to return `{ inject }` for a given segment wins; remaining hooks for that segment are skipped.
- Default budget is **1 injection per extension per user turn**. Set `allowMultiple: true` on a hook to raise the per-extension cap to 5 per turn. Counts reset when the user sends a new message.
- Hooks fire **only for the user-visible main chat**. They do NOT fire inside `ctx.runBackgroundAgent()` or `session.send()` — even when those calls are made from inside a hook handler. This guarantees no recursive hook loops.

```ts
import type { ExtensionMainContext, ChatHook } from './types'

export function register(ctx: ExtensionMainContext): () => void {
  const hooks: ChatHook[] = [
    {
      type: 'on_message',
      handler: async (event) => {
        if (event.type !== 'on_message') return
        if (event.content.includes('TODO')) {
          return { inject: 'You left a TODO — finish it before reporting done.' }
        }
      }
    },
    {
      type: 'on_tool_call',
      handler: (event) => {
        if (event.type !== 'on_tool_call') return
        if (event.toolName === 'run_command' && event.error) {
          // log, no injection — on_tool_call cannot inject
          console.warn('[my-ext] run_command failed:', event.result)
        }
      }
    }
  ]
  ctx.registerHooks(hooks)
  return () => { /* cleanup if needed */ }
}
```

### Multi-turn agent sessions

`ctx.openAgentSession({ systemPrompt })` returns a session with persistent message history. Each `session.send(text)` call appends to the conversation and returns the agent's reply. Use `session.close()` to drop history.

```ts
const session = ctx.openAgentSession({ systemPrompt: 'You are a haiku poet.' })
const first  = await session.send('snow')
const second = await session.send('again, but with the sea')
session.close()
```

Sessions are isolated: hooks do not fire, and a session's messages do not appear in the user-visible chat. If the extension is disabled or unloaded, all of its open sessions are closed automatically.

---

## 4. Building and Packaging

From the **repo root**:

```bash
make package-extensions
```

This compiles every extension in `RoseExtensions/` and outputs installable zips to `dist/extensions/{id}.zip`.

No per-extension build config is needed — the root `scripts/package-extensions.mjs` handles everything.

---

## 5. Step-by-Step

1. **Ask the user** what the extension should do (if not in the prompt).
2. **Choose the ID** — `rose-{kebab-name}`.
3. **Write `rose-extension.json`** with the right `provides` flags.
4. **Write `renderer.ts`** + component source in `src/renderer/` if it has a UI.
5. **Write `main.ts`** + `src/main/types.ts`, `src/main/handlers.ts`, and/or `src/main/tools.ts` if it has background logic or tools.
6. If the extension adds new settings fields, add them to `AppSettings` in `settingsHandlers.ts` and `useSettingsStore.ts`.
7. Run `make package-extensions` to build and package.
8. Install via Settings → Extensions → INSTALL FROM DISK → select `dist/extensions/{id}.zip`.
