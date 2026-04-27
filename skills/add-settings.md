# Add Settings Field

Add a new persisted setting to ProjectRose.

The user may describe the field in `$ARGUMENTS`.

---

## Overview

Settings live in two places that must stay in sync:

```
src/main/ipc/settingsHandlers.ts          ← AppSettings interface + DEFAULT_SETTINGS
src/renderer/src/stores/useSettingsStore.ts ← SettingsState interface + initial value
```

Missing the default value causes `undefined` to leak into the renderer on first launch. Missing either interface causes TypeScript errors.

---

## When to use flat AppSettings vs. namespaced extension settings

**Use flat `AppSettings` fields** for core app settings that are not extension-specific (e.g. `heartbeatEnabled`, `userName`).

**Use the `extensions` namespace** for settings that belong to a specific extension. This avoids polluting `AppSettings` and keeps all extension state co-located:

```ts
// Reading in the renderer:
const { extensions } = useSettingsStore()
const myValue = (extensions['rose-myext'] as { apiKey?: string })?.apiKey ?? ''

// Writing:
update({ extensions: { ...extensions, 'rose-myext': { ...extensions['rose-myext'], apiKey: newValue } } })

// Reading in the main process (inside a handler):
const settings = await ctx.getSettings()
const apiKey = String((settings.extensions?.['rose-myext'] as Record<string, unknown>)?.apiKey ?? '')
```

Use flat fields only when the setting is truly global (not scoped to one extension).

---

## Adding a flat settings field

### 1. settingsHandlers.ts — AppSettings interface

```ts
export interface AppSettings {
  // ... existing fields ...
  myNewField: string          // add here
  myNewBoolField: boolean
  myNewListField: string[]
}
```

### 2. settingsHandlers.ts — DEFAULT_SETTINGS

```ts
const DEFAULT_SETTINGS: AppSettings = {
  // ... existing defaults ...
  myNewField: '',             // add here — must match the interface type
  myNewBoolField: false,
  myNewListField: [],
}
```

**Rules:**
- Every field in `AppSettings` must have a default in `DEFAULT_SETTINGS`.
- Defaults should be "empty but valid" — empty string, `false`, `[]`, `null`, etc.
- Never use `undefined` as a default.

### 3. useSettingsStore.ts — SettingsState interface

```ts
interface SettingsState {
  // ... existing fields ...
  myNewField: string          // add here — must match AppSettings
  myNewBoolField: boolean
  myNewListField: string[]
  // ... load, update ...
}
```

### 4. useSettingsStore.ts — create() initial value

```ts
export const useSettingsStore = create<SettingsState>()((set) => ({
  // ... existing initial values ...
  myNewField: '',             // add here — must match DEFAULT_SETTINGS
  myNewBoolField: false,
  myNewListField: [],
  // ... load, update ...
}))
```

---

## Using the setting in the renderer

```tsx
import { useSettingsStore } from '@renderer/stores/useSettingsStore'

export function MyComponent(): JSX.Element {
  const { myNewField, myNewBoolField, update } = useSettingsStore()

  return (
    <input
      value={myNewField}
      onChange={(e) => update({ myNewField: e.target.value })}
    />
  )
}
```

`update()` persists the change immediately — it calls `window.api.setSettings()` internally.

---

## Using the setting in the main process

```ts
import { readSettings } from '../settingsHandlers'

ipcMain.handle('myFeature:doThing', async (_event, rootPath: string) => {
  const settings = await readSettings(rootPath)
  const value = settings.myNewField
  // ...
})
```

---

## Checklist

- [ ] Field added to `AppSettings` interface in `settingsHandlers.ts`
- [ ] Default value added to `DEFAULT_SETTINGS` in `settingsHandlers.ts`
- [ ] Field added to `SettingsState` interface in `useSettingsStore.ts`
- [ ] Initial value added to `create()` in `useSettingsStore.ts`
