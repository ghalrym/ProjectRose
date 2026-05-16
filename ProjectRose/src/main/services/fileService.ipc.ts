import { defineIpc, method } from '../../shared/ipc/defineIpc'
import type { FileNode } from '../../shared/types'

// Payload shapes match the existing wire format so renderer call sites are
// not forced to change. preload re-wraps these into the flat
// api.readFile / api.writeFile / etc. surface — see preload/index.ts.
export const fileIpc = defineIpc('file', {
  read: method<[filePath: string], string>(),
  write: method<[payload: { filePath: string; content: string }], void>(),
  create: method<[filePath: string], void>(),
  delete: method<[filePath: string], void>(),
  deleteDir: method<[dirPath: string], void>(),
  rename: method<[payload: { oldPath: string; newPath: string }], void>(),
  createDir: method<[dirPath: string], void>(),
  readDirTree: method<[dirPath: string], FileNode | null>()
})
