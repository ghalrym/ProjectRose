import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type {
  ExtensionListResult,
  InstallResult,
  InstallPreviewResult,
  LoadRendererResult
} from './extensionService'

export const extensionIpc = defineIpc('extension', {
  list: method<[rootPath: string], ExtensionListResult>(),
  installFromGit: method<[rootPath: string, url: string], InstallResult>(),
  installFromDisk: method<[rootPath: string, sourcePath: string], InstallResult>(),
  installPreviewFromGit: method<[rootPath: string, url: string], InstallPreviewResult>(),
  installPreviewFromDisk: method<[rootPath: string, sourcePath: string], InstallPreviewResult>(),
  installConfirm: method<[token: string], InstallResult>(),
  installCancel: method<[token: string], { ok: boolean }>(),
  uninstall: method<[rootPath: string, id: string], { ok: boolean }>(),
  enable: method<[rootPath: string, id: string], { ok: boolean }>(),
  disable: method<[rootPath: string, id: string], { ok: boolean }>(),
  loadRendererCode: method<[rootPath: string, id: string], LoadRendererResult>(),
  loadMainModule: method<[rootPath: string, id: string], { ok: boolean }>(),
  // Per-workspace registration of the main modules shipped with built-in
  // extensions (ADR 0010). Called by the renderer's loadDynamicExtensions
  // bootstrap before any per-extension dynamic loads. See
  // `src/main/extensions/builtins/index.ts`.
  loadBuiltinMains: method<[rootPath: string], { ok: boolean }>(),
  unloadBuiltinMains: method<[rootPath: string], { ok: boolean }>()
})
