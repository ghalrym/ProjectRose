import type { ElectronAPI } from '../../../preload'

// Renderer-only ambient declarations. Cross-process data shapes live in
// `@shared/types`; the `window.api` interface is derived from preload via
// `typeof api`, so adding/removing IPC methods only requires editing
// `src/preload/index.ts`.

declare global {
  interface Window {
    api: ElectronAPI
    __rose__: Record<string, unknown>
  }
}
