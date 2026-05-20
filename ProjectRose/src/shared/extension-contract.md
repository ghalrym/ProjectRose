# ProjectRose extension contract

This document is the migration reference for extension authors moving from
the pre-contract host API (where the host handed every extension an
implicit nine-method `ExtensionMainContext` and tolerated reaches into
`@main/ipc/settingsHandlers`) to the explicit contract module.

## What changed

1. **One import surface.** Everything you need lives in
   `src/shared/extension-contract.ts`. Anything not exported from that
   file is not part of the contract and may move or rename without
   notice.

2. **Capability-declared manifest.** `provides` is now a capability set.
   The host inspects it at load time and constructs a `ctx` whose method
   set is exactly what your manifest authorises. If you don't declare a
   capability you get a throwing stub for that method.

3. **Sealed sandbox.** `require('@main/ipc/settingsHandlers')` no longer
   works. Use `ctx.getSettings()` / `ctx.updateSettings(patch)` instead.

4. **Strict tool catalog.** `provides.tools[]` (display metadata) and
   `ctx.registerTools(...)` (runtime entries) must agree on names. Drift
   either way fails the load.

5. **Strict hook catalog.** When you declare hooks in
   `provides.hooks[]`, the runtime-registered hook types must match.

6. **`manifest.id` IS `viewId`.** The renderer routes saved view state
   (nav tab, last-open extension) by manifest id. Five legacy aliases
   exist in `legacyViewIdAliases` for projects upgraded from a
   pre-namespaced install; new extensions get id-equals-viewId for free.

## Capabilities

| Capability | Unlocks | Notes |
|------------|---------|-------|
| `pageView` | A renderer panel in the sidebar | Renderer bundle must export `PageView` (and/or `SettingsView`) |
| `main` | Main-process `register(ctx)` | Required for any non-UI logic |
| `projectSettings` | `provides.projectSettings: true` flag | Marker only — `ctx.getSettings()` is always available |
| `globalSettings` | `provides.globalSettings: true` flag | Marker only |
| `agentTools` | `ctx.registerTools(tools)` | Pair with `tools: [...]` for display metadata |
| `chatHooks` | `ctx.registerHooks(hooks)` | Pair with optional `hooks: [...]` for per-type injection policy |
| `agentSession` | `ctx.openAgentSession(opts)` | Multi-turn agent sessions |
| `backgroundAgent` | `ctx.runBackgroundAgent(prompt, sys)` | One-shot agent runs without hooks |
| `notifyStatus` | `ctx.notifyStatus(text, opts)` | Status-bar messages in the renderer |
| `broadcast` | `ctx.broadcast(channel, data)` | Send IPC events to renderer windows |

The free-tier methods every extension gets are: `rootPath`,
`getSettings`, `updateSettings`. `getSettings` / `updateSettings` read
and write a per-workspace per-extension JSON file at
`<workspace>/.projectrose/extensions/<id>/settings.json` — other
extensions cannot see your settings, and changes do not leak between
workspaces.

## Migration steps

1. **Delete your local `src/main/types.ts`** if it only mirrored the
   host's `ExtensionMainContext` / `ExtensionToolEntry` / `ChatHook`.
   Domain types (your own entities) stay in their own file.

2. **Import host types from the contract module** via relative path:
   ```ts
   import type {
     ExtensionMainContext,
     ExtensionToolEntry,
     ChatHook
   } from '../../ProjectRose/src/shared/extension-contract'
   ```
   The import is type-only and gets erased by esbuild; the path only
   needs to resolve at type-check time.

3. **Drop any `@main/...` imports.** If you reach for `readSettings` /
   `writeSettings` from `settingsHandlers`, stash the active `ctx` in a
   module-level variable inside `register(ctx)` and route through
   `ctx.getSettings()` / `ctx.updateSettings(patch)`:
   ```ts
   let activeCtx: ExtensionMainContext | null = null
   export function setMyExtCtx(ctx: ExtensionMainContext): void {
     activeCtx = ctx
   }
   // ...
   export function register(ctx: ExtensionMainContext): () => void {
     setMyExtCtx(ctx)
     ctx.registerTools(MY_TOOLS)
     return registerHandlers(ctx)
   }
   ```

4. **Declare your capabilities.** Audit every `ctx.X` call in your
   extension. For each method you use, add the corresponding capability
   to `provides`. If you don't, the host hands you a throwing stub.

5. **Declare your tools.** Every name you pass to `ctx.registerTools`
   must appear in `provides.tools[]`, and vice versa. The host refuses
   to load on drift.

6. **Declare your hooks (optional).** If you register hooks via
   `ctx.registerHooks`, you can optionally list them in `provides.hooks[]`
   to set per-type `injectionPolicy` (`'first-wins'` default,
   `'all'` collects every injection up to budget) and `priority` (lower
   fires first; default `100`). If you list any, every registered hook
   type must be declared.

7. **Pick a viewId-friendly id.** Your `manifest.id` IS your viewId.
   Use `rose-<something>` for first-party-like clarity.

## Example: minimal first-party extension

```json
{
  "id": "rose-example",
  "name": "Example",
  "version": "1.0.0",
  "description": "Demonstrates the contract surface.",
  "author": "You",
  "provides": {
    "main": true,
    "agentTools": true,
    "tools": [
      {
        "name": "say_hello",
        "displayName": "Say Hello",
        "description": "Greet the agent."
      }
    ]
  }
}
```

```ts
// main.ts
import type {
  ExtensionMainContext,
  ExtensionToolEntry
} from '../../ProjectRose/src/shared/extension-contract'

const HELLO_TOOL: ExtensionToolEntry = {
  name: 'say_hello',
  description: 'Greet the agent.',
  schema: { type: 'object', properties: {} },
  execute: async () => 'Hello, agent.'
}

export function register(ctx: ExtensionMainContext): () => void {
  ctx.registerTools([HELLO_TOOL])
  return () => {}
}
```

## Things the host enforces (and where the error shows up)

- **Malformed manifest** → host refuses to load, status bar shows the
  validation errors.
- **Undeclared capability used** → `ctx.X(...)` throws synchronously,
  status bar shows "register() failed".
- **Tool catalog drift** → load fails, status bar shows
  `extension "X" failed to load: manifest declares tools that
  register() did not register: ...`.
- **Hook catalog drift** → same shape as tool drift.
- **`require('@main/...')`** → throws "Cannot find module"; the host
  no longer hosts those paths.

## What's stable, what's not

Anything exported from `extension-contract.ts` is stable. Anything you
reach for through another path (`@main/...`, `@shared/extension-types`
directly, host service modules) can move or break without notice.

Versioning the contract itself (a `contractVersion` field in the
manifest) is on the roadmap but not yet enforced; until then, treat the
current shape as `1.0` by convention.
