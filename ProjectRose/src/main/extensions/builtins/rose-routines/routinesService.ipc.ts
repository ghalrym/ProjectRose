import { defineIpc, method } from '../../../../shared/ipc/defineIpc'
import type { ParsedRoutine } from '../../../../shared/routineFields'
import type { RunListEntry } from './main'

// IPC manifest for rose-routines. Bound flat on `window.api.routines.*`
// from preload (see src/preload/index.ts). The renderer half of the
// rose-routines extension calls these methods directly — no extension SDK
// glue, since rose-routines is a built-in and may speak to host IPC.

export const routinesIpc = defineIpc('routines', {
  /** List every routine definition in the workspace. */
  list: method<[rootPath: string], Array<{ slug: string; routine: ParsedRoutine }>>(),
  /** Read a single routine by slug. Returns null when not found. */
  read: method<[rootPath: string, slug: string], ParsedRoutine | null>(),
  /**
   * Save or create a routine. If `slug` is empty the host derives one from
   * `routine.name`. Returns the canonical slug the file was written under.
   */
  save: method<[rootPath: string, slug: string, routine: ParsedRoutine], { slug: string }>(),
  /** Delete a routine definition file. Run history is preserved. */
  delete: method<[rootPath: string, slug: string], void>(),
  /**
   * Fire a routine ad-hoc, regardless of its enabled flag or schedule.
   * Returns immediately; the run completes asynchronously and broadcasts a
   * `routines:changed` event when done.
   */
  runNow: method<[rootPath: string, slug: string], { ok: boolean }>(),
  /** List runs for a routine, newest first. */
  listRuns: method<[rootPath: string, slug: string], RunListEntry[]>(),
  /** Read a single run transcript markdown. */
  readRun: method<[rootPath: string, slug: string, filename: string], string | null>()
})
