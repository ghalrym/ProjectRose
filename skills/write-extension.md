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

Extensions live at `RoseExtensions/{id}/`. The structure mirrors `rose-discord` as the canonical reference:

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

This file just re-exports components from `src/renderer/`. The build script compiles it to a CJS bundle.

```ts
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

Extension settings are stored on the top-level `AppSettings` object under dedicated fields (like `discordBotToken`, `discordChannels`). Add new fields to `AppSettings` in `ProjectRose/src/main/ipc/settingsHandlers.ts` and `ProjectRose/src/renderer/src/stores/useSettingsStore.ts` if needed.

```tsx
// Read a top-level setting
const { discordBotToken, update } = useSettingsStore()

// Write it back
update({ discordBotToken: newValue })
```

### Calling main-process handlers from the renderer

```ts
const result = await window.api.invoke('rose-{name}:some-action') as { ok: boolean }
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

```ts
export type { ExtensionMainContext } from '@main/extensions/types'
```

### src/main/handlers.ts

```ts
import { ipcMain } from 'electron'
import type { ExtensionMainContext } from './types'

export function registerHandlers(ctx: ExtensionMainContext): () => void {
  ipcMain.handle('rose-{name}:some-action', async () => {
    // do something with ctx.rootPath, ctx.getSettings(), etc.
    return { ok: true }
  })

  return () => {
    ipcMain.removeHandler('rose-{name}:some-action')
  }
}
```

### src/main/tools.ts

```ts
import type { ExtensionToolEntry } from '@main/extensions/types'

export const MY_TOOLS: ExtensionToolEntry[] = [
  {
    name: 'tool_name',
    description: 'What this tool does',
    schema: {
      input: { type: 'string', description: 'The input value' }
    },
    execute: async (args, projectRoot) => {
      return 'result string'
    }
  }
]
```

### ExtensionMainContext API

```ts
ctx.rootPath                            // absolute path to project root
ctx.getSettings()                       // Promise<AppSettings>
ctx.updateSettings(patch)               // Promise<void>
ctx.broadcast(channel, data)            // send IPC event to all renderer windows
ctx.registerTools(tools)                // register AI tools
ctx.runBackgroundAgent(prompt)          // invoke the AI agent
```

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
5. **Write `main.ts`** + `src/main/handlers.ts` and/or `src/main/tools.ts` if it has background logic or tools.
6. If the extension adds new settings fields, add them to `AppSettings` in `settingsHandlers.ts` and `useSettingsStore.ts`.
7. Run `make package-extensions` to build and package.
8. Install via Settings → Extensions → INSTALL FROM DISK → select `dist/extensions/{id}.zip`.

---

## 6. Reference: rose-discord

The most complete example is `RoseExtensions/rose-discord/`. It has a `PageView`, a `SettingsView`, a main-process handler, and three registered AI tools. Read it when in doubt.
