import { ipcMain, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { readFile, writeFile, mkdir, readdir, rm, copyFile, rename } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { spawn } from 'child_process'
import { IPC } from '../../shared/ipcChannels'
import { prPath } from '../lib/projectPaths'
import { readSettings, writeSettings, registerSensitiveExtensionFields } from './settingsHandlers'
import { heartbeatChat } from '../services/aiService'
import type { InstalledExtension, ExtensionManifest, ExtensionToolEntry } from '../../shared/extension-types'

function getExtensionsDir(rootPath: string): string {
  return prPath(rootPath, 'extensions')
}

async function ensureExtensionsDir(rootPath: string): Promise<void> {
  await mkdir(getExtensionsDir(rootPath), { recursive: true })
}

async function readManifest(extensionPath: string): Promise<ExtensionManifest | null> {
  try {
    const raw = await readFile(join(extensionPath, 'rose-extension.json'), 'utf-8')
    return JSON.parse(raw) as ExtensionManifest
  } catch {
    return null
  }
}

async function readEnabledState(rootPath: string, id: string): Promise<boolean> {
  try {
    const statePath = join(getExtensionsDir(rootPath), id, '.state.json')
    const raw = await readFile(statePath, 'utf-8')
    return JSON.parse(raw).enabled !== false
  } catch {
    return true
  }
}

async function writeEnabledState(rootPath: string, id: string, enabled: boolean): Promise<void> {
  const statePath = join(getExtensionsDir(rootPath), id, '.state.json')
  await writeFile(statePath, JSON.stringify({ enabled }), 'utf-8')
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: process.platform === 'win32', stdio: 'pipe' })
    let stderr = ''
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`))
    })
  })
}

async function cloneRepo(url: string, destDir: string): Promise<void> {
  await runCommand('git', ['clone', '--depth=1', url, destDir], dirname(destDir))
}

async function buildExtension(dir: string): Promise<void> {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return
  let pkg: { scripts?: Record<string, string> } = {}
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) } catch { return }
  if (!pkg.scripts?.build) return

  await runCommand('npm', ['install', '--no-audit', '--no-fund', '--silent'], dir)
  await runCommand('npm', ['run', 'build', '--silent'], dir)

  // Surface dist artifacts at the install root so the harness can load them
  const distDir = join(dir, 'dist')
  for (const fname of ['main.js', 'renderer.js', 'renderer.css']) {
    const distFile = join(distDir, fname)
    if (existsSync(distFile)) await copyFile(distFile, join(dir, fname))
  }
}

// Tracks cleanup functions for loaded extension main modules, keyed by "<rootPath>/<id>"
const loadedMains = new Map<string, () => void>()

// Registered tools per extension, keyed by "<rootPath>/<id>"
const extensionToolsRegistry = new Map<string, ExtensionToolEntry[]>()

export function getRegisteredExtensionTools(rootPath: string, enabledIds: string[]): ExtensionToolEntry[] {
  return enabledIds.flatMap((id) => extensionToolsRegistry.get(`${rootPath}/${id}`) ?? [])
}

interface ExtensionMainContext {
  rootPath: string
  getSettings: () => Promise<Record<string, unknown>>
  updateSettings: (patch: Record<string, unknown>) => Promise<void>
  broadcast: (channel: string, data: unknown) => void
  registerTools: (tools: ExtensionToolEntry[]) => void
  // Mark settings keys as sensitive so they're stored in userData/settings.json
  // instead of the project repo config (where they could be committed).
  registerSensitiveFields: (keys: string[]) => void
  runBackgroundAgent: (prompt: string) => Promise<string>
}

function loadExtensionMainModule(rootPath: string, id: string): void {
  const key = `${rootPath}/${id}`
  if (loadedMains.has(key)) return

  const mainPath = join(getExtensionsDir(rootPath), id, 'main.js')
  if (!existsSync(mainPath)) return

  try {
    const code = readFileSync(mainPath, 'utf-8')
    const extRequire = createRequire(mainPath)
    const hostExports: Record<string, unknown> = {
      '@main/ipc/settingsHandlers': { readSettings, writeSettings }
    }
    const hostedRequire: NodeJS.Require = ((spec: string) => {
      if (spec in hostExports) return hostExports[spec]
      return extRequire(spec)
    }) as NodeJS.Require
    Object.assign(hostedRequire, extRequire)
    const mod: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line no-new-func
    const wrapper = new Function('module', 'exports', 'require', '__dirname', '__filename', code)
    wrapper(mod, mod.exports, hostedRequire, dirname(mainPath), mainPath)

    const ctx: ExtensionMainContext = {
      rootPath,
      getSettings: async () => readSettings(rootPath) as unknown as Record<string, unknown>,
      updateSettings: async (patch: Record<string, unknown>) => {
        const current = await readSettings(rootPath)
        await writeSettings({ ...current, ...(patch as object) } as Parameters<typeof writeSettings>[0], rootPath)
      },
      broadcast: (channel: string, data: unknown) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(channel, data)
        }
      },
      registerTools: (tools: ExtensionToolEntry[]) => {
        extensionToolsRegistry.set(key, tools)
      },
      registerSensitiveFields: (keys: string[]) => {
        registerSensitiveExtensionFields(keys)
      },
      runBackgroundAgent: async (prompt: string) => {
        const { content } = await heartbeatChat([{ role: 'user', content: prompt }], rootPath)
        return content
      }
    }

    const register = mod.exports['register'] as ((ctx: ExtensionMainContext) => (() => void) | void) | undefined
    const cleanup = register?.(ctx)
    loadedMains.set(key, typeof cleanup === 'function' ? cleanup : () => {})
  } catch (err) {
    console.error(`[rose-ext] Failed to load main module for ${id}:`, err)
  }
}

function unloadExtensionMainModule(rootPath: string, id: string): void {
  const key = `${rootPath}/${id}`
  const cleanup = loadedMains.get(key)
  if (cleanup) {
    try { cleanup() } catch {}
    loadedMains.delete(key)
  }
  extensionToolsRegistry.delete(key)
}

export async function listInstalledExtensions(rootPath: string): Promise<InstalledExtension[]> {
  if (!rootPath) return []
  const extensionsDir = getExtensionsDir(rootPath)
  await mkdir(extensionsDir, { recursive: true })
  let entries: string[]
  try {
    entries = await readdir(extensionsDir)
  } catch {
    return []
  }

  const results: InstalledExtension[] = []
  for (const entry of entries) {
    const extensionPath = join(extensionsDir, entry)
    const manifest = await readManifest(extensionPath)
    if (!manifest) continue
    const enabled = await readEnabledState(rootPath, manifest.id)
    results.push({ manifest, installPath: extensionPath, enabled })
  }
  return results
}

export function registerExtensionHandlers(): void {
  ipcMain.handle(IPC.EXTENSION_LIST, async (_event, rootPath: string) => {
    if (!rootPath) return { installed: [] }
    const installed = await listInstalledExtensions(rootPath)
    return { installed }
  })

  ipcMain.handle(IPC.EXTENSION_INSTALL_FROM_GIT, async (_event, rootPath: string, url: string) => {
    if (!rootPath) return { ok: false, error: 'No project open' }
    const trimmedUrl = String(url ?? '').trim()
    if (!trimmedUrl) return { ok: false, error: 'Repository URL is required' }

    await ensureExtensionsDir(rootPath)
    const extensionsDir = getExtensionsDir(rootPath)
    const tmpDir = join(extensionsDir, `_clone_${Date.now()}`)

    try {
      await cloneRepo(trimmedUrl, tmpDir)

      const manifest = await readManifest(tmpDir)
      if (!manifest) throw new Error('Invalid extension: repository is missing rose-extension.json')

      await buildExtension(tmpDir)

      const destDir = join(extensionsDir, manifest.id)
      if (existsSync(destDir)) {
        unloadExtensionMainModule(rootPath, manifest.id)
        await rm(destDir, { recursive: true, force: true })
      }
      await rename(tmpDir, destDir)
      return { ok: true, manifest }
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.EXTENSION_UNINSTALL, async (_event, rootPath: string, id: string) => {
    unloadExtensionMainModule(rootPath, id)
    const extensionPath = join(getExtensionsDir(rootPath), id)
    await rm(extensionPath, { recursive: true, force: true })
    return { ok: true }
  })

  ipcMain.handle(IPC.EXTENSION_ENABLE, async (_event, rootPath: string, id: string) => {
    await ensureExtensionsDir(rootPath)
    await mkdir(join(getExtensionsDir(rootPath), id), { recursive: true })
    await writeEnabledState(rootPath, id, true)
    return { ok: true }
  })

  ipcMain.handle(IPC.EXTENSION_DISABLE, async (_event, rootPath: string, id: string) => {
    unloadExtensionMainModule(rootPath, id)
    await ensureExtensionsDir(rootPath)
    await mkdir(join(getExtensionsDir(rootPath), id), { recursive: true })
    await writeEnabledState(rootPath, id, false)
    return { ok: true }
  })

  ipcMain.handle(IPC.EXTENSION_LOAD_RENDERER, async (_event, rootPath: string, id: string) => {
    const installDir = join(getExtensionsDir(rootPath), id)
    let code: string | null = null
    let css: string | null = null
    try { code = await readFile(join(installDir, 'renderer.js'), 'utf-8') } catch { /* missing */ }
    try { css = await readFile(join(installDir, 'renderer.css'), 'utf-8') } catch { /* optional */ }
    if (!code) return { ok: false, code: null, css: null }
    return { ok: true, code, css }
  })

  ipcMain.handle(IPC.EXTENSION_LOAD_MAIN, (_event, rootPath: string, id: string) => {
    loadExtensionMainModule(rootPath, id)
    return { ok: true }
  })
}
