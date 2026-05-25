import { ipcMain, ipcRenderer } from 'electron'

// IPC manifest — pattern-choice decisions locked in by PRD #38 / HITL #39.
// Every later slice in the migration assumes these.
//
// 1. defineIpc takes a schema *object*, not a fluent builder. Fewer moving
//    parts; the runtime keys of the object drive registration and channel-
//    name derivation, while phantom type parameters carry arg/result types.
// 2. Each service's manifest lives in a sibling `<service>.ipc.ts` file
//    next to the service. Keeps the service file free of an `electron`
//    import so it stays unit-testable without stubbing electron at
//    module-load time.
// 3. Channel strings are `${namespace}:${methodName}`. Matches the existing
//    `IPC` enum convention so the wire format is unchanged across the
//    migration — renderer call sites that still reach the old enum see the
//    same strings produced by the manifest.
// 4. register() is plumbed through `registerIpcManifests()` in
//    `src/main/ipc/index.ts`. Each slice appends its manifest there as it
//    lands. The old `registerAllHandlers()` switchboard coexists for the
//    duration of the migration.
// 5. Handler exceptions are not wrapped. `ipcMain.handle` already rejects
//    the renderer-side promise when the handler throws; preserving that
//    behavior matches every existing hand-written handler. The binding
//    layer does strip Electron's `Error invoking remote method '<chan>':
//    <ErrorClass>: ` envelope so renderer error handling can match the
//    original main-side error message verbatim (e.g. `[email:<tag>]`
//    sentinels).

export interface IpcMethodSchema<TArgs extends readonly unknown[], TResult> {
  readonly __args?: TArgs
  readonly __result?: TResult
}

export type AnyMethodMap = Record<string, IpcMethodSchema<readonly unknown[], unknown>>

export function method<TArgs extends readonly unknown[], TResult = void>(): IpcMethodSchema<TArgs, TResult> {
  return {}
}

export type IpcHandlers<TMethods extends AnyMethodMap> = {
  [K in keyof TMethods]: TMethods[K] extends IpcMethodSchema<infer A, infer R>
    ? (...args: A) => R | Promise<R>
    : never
}

export type IpcBindings<TMethods extends AnyMethodMap> = {
  [K in keyof TMethods]: TMethods[K] extends IpcMethodSchema<infer A, infer R>
    ? (...args: A) => Promise<R>
    : never
}

export interface IpcManifest<TMethods extends AnyMethodMap> {
  readonly namespace: string
  readonly methodNames: ReadonlyArray<keyof TMethods & string>
  register(handlers: IpcHandlers<TMethods>): void
  readonly bindings: IpcBindings<TMethods>
}

export function defineIpc<TMethods extends AnyMethodMap>(
  namespace: string,
  methods: TMethods
): IpcManifest<TMethods> {
  const names = Object.keys(methods) as Array<keyof TMethods & string>
  const channel = (name: string): string => `${namespace}:${name}`

  const bindings: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const name of names) {
    bindings[name] = async (...args: unknown[]) => {
      try {
        return await ipcRenderer.invoke(channel(name), ...args)
      } catch (e) {
        throw unwrapIpcError(e)
      }
    }
  }

  return {
    namespace,
    methodNames: names,
    register(handlers) {
      for (const name of names) {
        const fn = handlers[name] as (...args: unknown[]) => unknown
        ipcMain.handle(channel(name), (_event, ...args) => fn(...args))
      }
    },
    bindings: bindings as IpcBindings<TMethods>
  }
}

// Electron rejects `ipcRenderer.invoke` with an Error whose message is
// `Error invoking remote method '<channel>': <ErrorClass>: <originalMessage>`.
// Strip that envelope so renderer code sees the same message the main-side
// handler threw — otherwise sentinel prefixes (e.g. `[email:scope-missing]`)
// never appear at the start of the string and consumers can't match them.
const IPC_ENVELOPE_RE = /^Error invoking remote method '[^']+': (?:[A-Za-z]\w*Error: )?/

function unwrapIpcError(e: unknown): unknown {
  if (e instanceof Error) {
    const stripped = e.message.replace(IPC_ENVELOPE_RE, '')
    if (stripped !== e.message) {
      const fresh = new Error(stripped)
      fresh.stack = e.stack
      return fresh
    }
  }
  return e
}
