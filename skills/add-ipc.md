# Add IPC Channel

Add a new Electron IPC channel so the renderer can call main-process code.

The user may describe what the channel should do in `$ARGUMENTS`.

---

## Overview

Every IPC channel in ProjectRose touches **4 files** in a fixed order. Missing any one of them causes a silent failure (the handler exists but is unreachable, or the renderer calls a function that doesn't exist on `window.api`).

```
src/shared/ipcChannels.ts          ← 1. Add the constant
src/main/ipc/{feature}Handlers.ts  ← 2. Add ipcMain.handle()
src/main/ipc/index.ts              ← 3. Register the file (if new handler file)
src/preload/index.ts               ← 4. Expose on window.api
```

---

## Step 1 — Add the constant to ipcChannels.ts

`src/shared/ipcChannels.ts` is the single source of truth for channel names.

```ts
// Add inside the IPC object, grouped with related channels:
MY_FEATURE_DO_THING: 'myFeature:doThing',
MY_FEATURE_GET_DATA: 'myFeature:getData',
```

**Naming convention:** `namespace:camelCaseAction` — e.g. `session:save`, `extension:list`.

---

## Step 2 — Add the handler

If a `src/main/ipc/myFeatureHandlers.ts` file already exists, add to it. Otherwise create it:

```ts
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipcChannels'

export function registerMyFeatureHandlers(): void {
  ipcMain.handle(IPC.MY_FEATURE_DO_THING, async (_event, arg1: string, arg2: number) => {
    // do work in the main process
    return { ok: true, result: 'data' }
  })

  ipcMain.handle(IPC.MY_FEATURE_GET_DATA, async (_event, rootPath: string) => {
    return { items: [] }
  })
}
```

**Rules:**
- Always use `IPC.MY_FEATURE_DO_THING` — never inline the string `'myFeature:doThing'`.
- The first argument is always `_event` (Electron event, usually unused).
- Return a plain serializable value — no class instances, no functions.
- Throw (or return `{ ok: false, error: string }`) on failure; never return `undefined`.

---

## Step 3 — Register the file (only for new handler files)

If you created a new `*Handlers.ts` file, add it to `src/main/ipc/index.ts`:

```ts
import { registerMyFeatureHandlers } from './myFeatureHandlers'

export function registerAllHandlers(): void {
  // ... existing registrations ...
  registerMyFeatureHandlers()   // ← add here
}
```

If you added to an existing file, skip this step.

---

## Step 4 — Expose on window.api via the preload

`src/preload/index.ts` bridges main-process IPC to the renderer. **This is the step agents most often forget.** If it's missing, the renderer gets `window.api.myThing is not a function`.

Find the `const api = { ... }` object and add your methods:

```ts
// Simple invoke (renderer calls main, awaits response)
myFeatureDoThing: (arg1: string, arg2: number): Promise<{ ok: boolean; result: string }> =>
  ipcRenderer.invoke(IPC.MY_FEATURE_DO_THING, arg1, arg2),

myFeatureGetData: (rootPath: string): Promise<{ items: unknown[] }> =>
  ipcRenderer.invoke(IPC.MY_FEATURE_GET_DATA, rootPath),

// Push event listener (main → renderer, no reply)
onMyFeatureEvent: (callback: (data: { value: string }) => void): (() => void) => {
  const handler = (_event: unknown, data: { value: string }): void => callback(data)
  ipcRenderer.on(IPC.MY_FEATURE_EVENT, handler)
  return () => { ipcRenderer.removeListener(IPC.MY_FEATURE_EVENT, handler) }
},
```

**Invoke vs. on:**
- `ipcRenderer.invoke` — renderer calls main and awaits a return value. Use for requests.
- `ipcRenderer.on` — main pushes events to renderer (e.g. progress, streaming). Always return a cleanup function from these listeners.

---

## Step 5 — Call from the renderer

```ts
// In any renderer component or store:
const result = await window.api.myFeatureDoThing('hello', 42)

// For push listeners — wire up in useEffect and clean up on unmount:
useEffect(() => {
  return window.api.onMyFeatureEvent((data) => {
    console.log(data.value)
  })
}, [])
```

---

## Checklist

- [ ] Constant added to `ipcChannels.ts`
- [ ] `ipcMain.handle()` added in handler file
- [ ] Handler file registered in `ipc/index.ts` (if new file)
- [ ] Method added to `api` object in `preload/index.ts`
- [ ] Renderer code calls `window.api.myMethod()`
