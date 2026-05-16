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
  loadMainModule: method<[rootPath: string, id: string], { ok: boolean }>()
})
