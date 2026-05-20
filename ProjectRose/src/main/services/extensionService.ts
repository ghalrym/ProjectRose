import { BrowserWindow } from 'electron'
import { join, dirname, resolve as resolvePath } from 'path'
import { readFile, writeFile, mkdir, readdir, rm, copyFile, rename, cp, stat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { spawn } from 'child_process'
import { IPC } from '../../shared/ipcChannels'
import { prPath } from '../lib/projectPaths'
import { agentExtensionsDir, ensureAgentHome } from '../lib/agentHome'
import { readSettings, writeSettings, registerSensitiveExtensionFields } from './settingsService'
import { runAgentOnce } from './aiService'
import {
  registerHooks as registerExtensionHooks,
  unregisterHooks as unregisterExtensionHooks,
  hookPipeline
} from './extensionHooks'
import { create as createAgentSession, closeAllForOwner as closeAgentSessionsForOwner } from './agentSession'
import type { ChatHook, HookType } from '../../shared/extensionHooks'
import type { InstalledExtension, ExtensionManifest, ExtensionToolEntry } from '../../shared/extension-types'
import type { ExtensionMainContext } from '../../shared/extension-contract'
import {
  validateManifest,
  formatManifestIssues,
  type ManifestValidationIssue
} from '../../shared/extension-manifest-validator'
import { buildContext, type HostExtensionSurface } from '../extensions/buildContext'
import { toolRegistry } from './toolRegistry'
import { withAugmentedPath } from '../lib/childProcessEnv'

// Where the extension code lives — one copy per machine, shared across all
// workspaces.
function getInstallDir(): string {
  return agentExtensionsDir()
}

async function ensureInstallDir(): Promise<void> {
  await ensureAgentHome()
}

// Where per-workspace overlays live: enable/disable flag (state.json) and
// per-workspace extension config (settings.json, added in a later commit).
function getWorkspaceExtensionsDir(rootPath: string): string {
  return prPath(rootPath, 'extensions')
}

async function ensureWorkspaceExtensionsDir(rootPath: string): Promise<void> {
  await mkdir(getWorkspaceExtensionsDir(rootPath), { recursive: true })
}

interface ManifestReadOk {
  ok: true
  manifest: ExtensionManifest
  warnings: ManifestValidationIssue[]
}

interface ManifestReadFail {
  ok: false
  /** `parse` = no manifest / unreadable JSON; `validate` = parsed but invalid. */
  reason: 'parse' | 'validate'
  errors: ManifestValidationIssue[]
}

async function readManifestStrict(extensionPath: string): Promise<ManifestReadOk | ManifestReadFail> {
  let parsed: unknown
  try {
    const raw = await readFile(join(extensionPath, 'rose-extension.json'), 'utf-8')
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'parse', errors: [{ path: '', message: 'rose-extension.json is missing or not valid JSON' }] }
  }
  const result = validateManifest(parsed)
  if (!result.ok) {
    return { ok: false, reason: 'validate', errors: result.errors }
  }
  return { ok: true, manifest: result.manifest, warnings: result.warnings }
}

// Best-effort manifest read for listing flows that pre-date strict validation.
// Returns null on any failure (parse OR validate); callers that need error
// detail should use `readManifestStrict` directly.
async function readManifest(extensionPath: string): Promise<ExtensionManifest | null> {
  const r = await readManifestStrict(extensionPath)
  return r.ok ? r.manifest : null
}

function broadcastStatus(text: string, tone: 'info' | 'success' | 'error' | 'warning'): void {
  const payload = { text, tone, durationMs: 6000 }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.STATUS_NOTIFY, payload)
  }
}

// Surface manifest warnings (e.g. unknown capability keys) to the renderer
// status bar so the user sees them, without blocking install or load.
function reportManifestWarnings(extensionId: string, warnings: ManifestValidationIssue[]): void {
  if (warnings.length === 0) return
  const summary = formatManifestIssues(warnings)
  console.warn(`[rose-ext] manifest warnings for ${extensionId}: ${summary}`)
  broadcastStatus(`Extension "${extensionId}" manifest: ${summary}`, 'warning')
}

// Default state in a workspace with no overlay file is *disabled*. The
// install flow opts the install-time workspace in by writing state.json
// with enabled=true; every other workspace must toggle the extension on
// explicitly. This matches ADR 0005 ("install once, opt in per project").
async function readEnabledState(rootPath: string, id: string): Promise<boolean> {
  try {
    const statePath = join(getWorkspaceExtensionsDir(rootPath), id, 'state.json')
    const raw = await readFile(statePath, 'utf-8')
    return JSON.parse(raw).enabled === true
  } catch {
    return false
  }
}

async function writeEnabledState(rootPath: string, id: string, enabled: boolean): Promise<void> {
  const overlayDir = join(getWorkspaceExtensionsDir(rootPath), id)
  await mkdir(overlayDir, { recursive: true })
  const statePath = join(overlayDir, 'state.json')
  await writeFile(statePath, JSON.stringify({ enabled }), 'utf-8')
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Augment PATH so Homebrew / NVM / volta / etc. are findable when the
    // app was launched from Finder on macOS (which strips PATH down to
    // /usr/bin:/bin:/usr/sbin:/sbin).
    const proc = spawn(cmd, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: 'pipe',
      env: withAugmentedPath()
    })
    let stderr = ''
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      const hint = err.code === 'ENOENT'
        ? ` — '${cmd}' is not on PATH. On macOS, install ${cmd} via Homebrew or ensure it's in /usr/local/bin or /opt/homebrew/bin.`
        : ''
      reject(new Error(`Failed to run ${cmd}: ${err.message}${hint}`))
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`))
    })
  })
}

async function cloneRepo(url: string, destDir: string): Promise<void> {
  await runCommand('git', ['clone', '--depth=1', url, destDir], dirname(destDir))
}

// Copy a local extension source tree into destDir. node_modules is stripped
// (gets reinstalled fresh in the destination) and .git is stripped (not
// useful at runtime). dist/ IS preserved so prebuilt extensions can be
// installed without re-running their build.
const COPY_SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '.next'])
async function copyLocalSource(sourceDir: string, destDir: string): Promise<void> {
  await cp(sourceDir, destDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (src) => {
      const segments = src.split(/[\\/]/)
      const last = segments[segments.length - 1]
      return !COPY_SKIP_DIRS.has(last)
    }
  })
}

// Promote build artifacts from dist/ to the install root, where the renderer
// loader (extension:loadRenderer) and main-module loader expect them.
async function surfaceDistArtifacts(dir: string): Promise<void> {
  const distDir = join(dir, 'dist')
  if (!existsSync(distDir)) return
  for (const fname of ['main.js', 'renderer.js', 'renderer.css']) {
    const distFile = join(distDir, fname)
    if (existsSync(distFile)) await copyFile(distFile, join(dir, fname))
  }
}

async function buildExtension(dir: string): Promise<void> {
  const pkgPath = join(dir, 'package.json')
  let hasBuildScript = false
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
      hasBuildScript = !!pkg.scripts?.build
    } catch { /* invalid package.json — skip build */ }
  }

  if (hasBuildScript) {
    await runCommand('npm', ['install', '--no-audit', '--no-fund', '--silent'], dir)
    await runCommand('npm', ['run', 'build', '--silent'], dir)
  }

  // Always surface — prebuilt extensions ship dist/ in the source folder and
  // need it promoted even when no build runs.
  await surfaceDistArtifacts(dir)
}

// True when the install dir has at least one loadable code artifact at its root.
function hasInstalledBundle(dir: string): boolean {
  return existsSync(join(dir, 'main.js')) || existsSync(join(dir, 'renderer.js'))
}

// Add any tools the manifest marks `defaultDisabled: true` to the project's
// disabledTools list. Idempotent — running again on reinstall just re-adds
// the same names. The user can re-enable individual tools in Settings → Tools.
async function applyDefaultDisabledTools(rootPath: string, manifest: ExtensionManifest): Promise<void> {
  const defaults = (manifest.provides.tools ?? [])
    .filter((t) => t.defaultDisabled)
    .map((t) => t.name)
  if (defaults.length === 0) return

  const settingsPath = prPath(rootPath, 'project-settings.json')
  let projectSettings: { disabledTools?: string[] } & Record<string, unknown> = {}
  try {
    projectSettings = JSON.parse(await readFile(settingsPath, 'utf-8'))
  } catch { /* file may not exist yet */ }

  const merged = new Set(projectSettings.disabledTools ?? [])
  for (const name of defaults) merged.add(name)
  projectSettings.disabledTools = [...merged]

  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(projectSettings, null, 2), 'utf-8')
}

// Tracks cleanup functions for loaded extension main modules, keyed by "<rootPath>/<id>"
const loadedMains = new Map<string, () => void>()

// Extension tool storage now lives on `toolRegistry`. This thin wrapper stays
// for callers that still read entries directly (Settings UI catalog).
export function getRegisteredExtensionTools(rootPath: string, enabledIds: string[]): ExtensionToolEntry[] {
  return toolRegistry.getEnabledExtensionToolEntries(rootPath, enabledIds)
}

class HookCatalogDriftError extends Error {
  constructor(public readonly extensionId: string, message: string) {
    super(`${extensionId}: ${message}`)
    this.name = 'HookCatalogDriftError'
  }
}

// Compare the hook types the manifest declared in `provides.hooks[]` against
// what actually got registered at runtime. Strict: any drift fails the load
// (#37 flipped this from warning-only to enforcement).
function reconcileHookCatalog(id: string, key: string, manifest: ExtensionManifest): void {
  const declared = (manifest.provides.hooks ?? []).map((h) => h.type as HookType)
  if (declared.length === 0) return
  const missing = hookPipeline.declaredButNotRegistered(key, declared)
  const undeclared = hookPipeline.registeredButNotDeclared(key, declared)
  const lines: string[] = []
  if (missing.length > 0) {
    lines.push(`manifest declared hooks not registered: ${missing.join(', ')}`)
  }
  if (undeclared.length > 0) {
    lines.push(`registered hooks not declared in manifest provides.hooks[]: ${undeclared.join(', ')}`)
  }
  if (lines.length > 0) throw new HookCatalogDriftError(id, lines.join('; '))
}

function loadExtensionMainModule(rootPath: string, id: string): void {
  const key = `${rootPath}/${id}`
  if (loadedMains.has(key)) return

  const installDir = join(getInstallDir(), id)
  const mainPath = join(installDir, 'main.js')
  if (!existsSync(mainPath)) return

  // Validate the manifest BEFORE evaluating any extension code. A malformed
  // manifest means we can't trust the capability set the extension is asking
  // for, so we refuse to load instead of half-running it.
  const manifestRead = readManifestSyncStrict(installDir)
  if (!manifestRead.ok) {
    const summary = formatManifestIssues(manifestRead.errors)
    console.error(`[rose-ext] refusing to load ${id}: manifest invalid — ${summary}`)
    broadcastStatus(`Extension "${id}" failed to load: ${summary}`, 'error')
    return
  }
  reportManifestWarnings(id, manifestRead.warnings)
  const manifestForHooks = manifestRead.manifest

  try {
    const code = readFileSync(mainPath, 'utf-8')
    const extRequire = createRequire(mainPath)
    // Sandbox tightening (#31): the host no longer hands extensions an
    // escape hatch into its own internal modules. Anything an extension
    // needs goes through `ctx`. Any leftover `require('@main/...')` style
    // import inside an extension will now resolve through the normal
    // node module resolver and fail loudly, which is what we want — it
    // tells the author to migrate to the contract.
    const hostedRequire: NodeJS.Require = ((spec: string) => extRequire(spec)) as NodeJS.Require
    Object.assign(hostedRequire, extRequire)
    const mod: { exports: Record<string, unknown> } = { exports: {} }
    // eslint-disable-next-line no-new-func
    const wrapper = new Function('module', 'exports', 'require', '__dirname', '__filename', code)
    wrapper(mod, mod.exports, hostedRequire, dirname(mainPath), mainPath)

    const host: HostExtensionSurface = {
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
      notifyStatus: (text: string, opts?: { tone?: 'info' | 'success' | 'error' | 'warning'; durationMs?: number }) => {
        const payload = { text, tone: opts?.tone, durationMs: opts?.durationMs }
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(IPC.STATUS_NOTIFY, payload)
        }
      },
      registerTools: (tools: ExtensionToolEntry[]) => {
        toolRegistry.registerExtensionTools(id, rootPath, tools)
      },
      registerSensitiveFields: (keys: string[]) => {
        registerSensitiveExtensionFields(keys)
      },
      runBackgroundAgent: async (prompt: string, systemPrompt: string) => {
        const { content } = await runAgentOnce(
          [{ role: 'user', content: prompt }],
          rootPath,
          systemPrompt,
        )
        return content
      },
      registerHooks: (hooks: ChatHook[]) => {
        registerExtensionHooks(
          key,
          {
            extensionId: id,
            extensionName: manifestForHooks?.name ?? id,
            extensionIcon: manifestForHooks?.icon,
            rootPath
          },
          hooks,
          manifestForHooks?.provides.hooks
        )
      },
      openAgentSession: ({ systemPrompt }: { systemPrompt: string }) =>
        createAgentSession({ rootPath, systemPrompt, ownerKey: key })
    }

    const ctx: ExtensionMainContext = buildContext({
      extensionId: id,
      manifest: manifestForHooks,
      host
    })

    const register = mod.exports['register'] as ((ctx: ExtensionMainContext) => (() => void) | void) | undefined
    const cleanup = register?.(ctx)
    loadedMains.set(key, typeof cleanup === 'function' ? cleanup : () => {})

    // Strict-mode reconciliation (#37): the manifest's declared tool and
    // hook catalogs must match what `register(ctx)` actually wired into
    // the runtime registries. Either side of any drift fails the load
    // and unwinds the partial registration — the user sees the failure
    // in the status bar, the extension's main module is not retained,
    // and `getRegisteredExtensionTools` will not surface its tools to
    // the agent.
    try {
      toolRegistry.assertManifestMatches(id, rootPath, manifestForHooks)
      reconcileHookCatalog(id, key, manifestForHooks)
    } catch (reconcileErr) {
      const detail = (reconcileErr as Error).message
      console.error(`[rose-ext] refusing to load ${id}: ${detail}`)
      broadcastStatus(`Extension "${id}" failed to load: ${detail}`, 'error')
      unloadExtensionMainModule(rootPath, id)
    }
  } catch (err) {
    const detail = (err as Error).message ?? String(err)
    console.error(`[rose-ext] Failed to load main module for ${id}:`, err)
    broadcastStatus(`Extension "${id}" failed to load: ${detail}`, 'error')
  }
}


function unloadExtensionMainModule(rootPath: string, id: string): void {
  const key = `${rootPath}/${id}`
  const cleanup = loadedMains.get(key)
  if (cleanup) {
    try { cleanup() } catch {}
    loadedMains.delete(key)
  }
  toolRegistry.unregisterExtension(id, rootPath)
  unregisterExtensionHooks(key)
  closeAgentSessionsForOwner(key)
}

interface ManifestReadSyncOk {
  ok: true
  manifest: ExtensionManifest
  warnings: ManifestValidationIssue[]
}
interface ManifestReadSyncFail {
  ok: false
  reason: 'parse' | 'validate'
  errors: ManifestValidationIssue[]
}

function readManifestSyncStrict(extensionPath: string): ManifestReadSyncOk | ManifestReadSyncFail {
  let parsed: unknown
  try {
    const raw = readFileSync(join(extensionPath, 'rose-extension.json'), 'utf-8')
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'parse', errors: [{ path: '', message: 'rose-extension.json is missing or not valid JSON' }] }
  }
  const result = validateManifest(parsed)
  if (!result.ok) return { ok: false, reason: 'validate', errors: result.errors }
  return { ok: true, manifest: result.manifest, warnings: result.warnings }
}

function readManifestSync(extensionPath: string): ExtensionManifest | null {
  const r = readManifestSyncStrict(extensionPath)
  return r.ok ? r.manifest : null
}

export async function listInstalledExtensions(rootPath: string): Promise<InstalledExtension[]> {
  // rootPath is required to look up the per-workspace enable state; without
  // an open workspace there is no overlay to read against, so the answer is
  // "no extensions are enabled here", which means an empty list.
  if (!rootPath) return []
  await ensureInstallDir()
  const installDir = getInstallDir()
  let entries: string[]
  try {
    entries = await readdir(installDir)
  } catch {
    return []
  }

  const results: InstalledExtension[] = []
  for (const entry of entries) {
    const extensionPath = join(installDir, entry)
    const manifest = await readManifest(extensionPath)
    if (!manifest) continue
    const enabled = await readEnabledState(rootPath, manifest.id)
    results.push({ manifest, installPath: extensionPath, enabled })
  }
  return results
}

// Pending installs awaiting user confirmation. Keyed by a per-install token
// returned to the renderer; the renderer echoes the token back on
// installConfirm / installCancel. Limits scope of the temp dir to the
// install dialog's lifetime.
interface PendingInstall {
  rootPath: string
  tmpDir: string
  manifest: ExtensionManifest
  createdAt: number
}

const pendingInstalls = new Map<string, PendingInstall>()

function newInstallToken(): string {
  // Plenty of entropy for an install-dialog lifetime; no need for crypto.
  return `inst_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

async function finalizePendingInstall(pending: PendingInstall): Promise<{
  destDir: string
  manifest: ExtensionManifest
  warning?: string
}> {
  const { rootPath, tmpDir, manifest } = pending
  const installDir = getInstallDir()
  await buildExtension(tmpDir)
  const destDir = join(installDir, manifest.id)
  if (existsSync(destDir)) {
    unloadExtensionMainModule(rootPath, manifest.id)
    await rm(destDir, { recursive: true, force: true })
  }
  await rename(tmpDir, destDir)
  await applyDefaultDisabledTools(rootPath, manifest)
  // Opt the install-time workspace in by default; every other workspace
  // stays disabled until the user explicitly toggles it.
  await writeEnabledState(rootPath, manifest.id, true)
  const warning = hasInstalledBundle(destDir)
    ? undefined
    : 'Installed, but no main.js or renderer.js was found. Run the extension\'s build (e.g. npm run build) and reinstall.'
  return { destDir, manifest, warning }
}

export interface ExtensionListResult {
  installed: InstalledExtension[]
}

export async function listExtensions(rootPath: string): Promise<ExtensionListResult> {
  if (!rootPath) return { installed: [] }
  const installed = await listInstalledExtensions(rootPath)
  return { installed }
}

export interface InstallResult {
  ok: boolean
  error?: string
  warning?: string
  manifest?: ExtensionManifest
}

export async function installFromGit(rootPath: string, url: string): Promise<InstallResult> {
  if (!rootPath) return { ok: false, error: 'No project open' }
  const trimmedUrl = String(url ?? '').trim()
  if (!trimmedUrl) return { ok: false, error: 'Repository URL is required' }

  await ensureInstallDir()
  const installDir = getInstallDir()
  const tmpDir = join(installDir, `_clone_${Date.now()}`)

  try {
    await cloneRepo(trimmedUrl, tmpDir)

    const manifestRead = await readManifestStrict(tmpDir)
    if (!manifestRead.ok) {
      const detail = formatManifestIssues(manifestRead.errors)
      const intro = manifestRead.reason === 'parse'
        ? 'Invalid extension: repository is missing rose-extension.json'
        : 'Invalid extension manifest'
      throw new Error(`${intro} (${detail})`)
    }
    const manifest = manifestRead.manifest
    reportManifestWarnings(manifest.id, manifestRead.warnings)

    await buildExtension(tmpDir)

    const destDir = join(installDir, manifest.id)
    if (existsSync(destDir)) {
      unloadExtensionMainModule(rootPath, manifest.id)
      await rm(destDir, { recursive: true, force: true })
    }
    await rename(tmpDir, destDir)
    await applyDefaultDisabledTools(rootPath, manifest)
    await writeEnabledState(rootPath, manifest.id, true)
    return { ok: true, manifest }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: (err as Error).message }
  }
}

export async function installFromDisk(rootPath: string, sourcePath: string): Promise<InstallResult> {
  if (!rootPath) return { ok: false, error: 'No project open' }
  const trimmed = String(sourcePath ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Source folder is required' }

  const absSource = resolvePath(trimmed)
  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(absSource)
  } catch {
    return { ok: false, error: `Folder does not exist: ${absSource}` }
  }
  if (!st.isDirectory()) return { ok: false, error: 'Source path is not a directory' }

  await ensureInstallDir()
  const installDir = getInstallDir()

  // Prevent self-overwrite: if the user picked a folder inside the destination,
  // the rename step would try to move a directory onto itself.
  const absInstallDir = resolvePath(installDir)
  if (absSource === absInstallDir || absSource.startsWith(absInstallDir + (process.platform === 'win32' ? '\\' : '/'))) {
    return { ok: false, error: 'Cannot install from a folder inside the extensions directory' }
  }

  const manifestSourceRead = await readManifestStrict(absSource)
  if (!manifestSourceRead.ok) {
    const detail = formatManifestIssues(manifestSourceRead.errors)
    const message = manifestSourceRead.reason === 'parse'
      ? 'Folder is missing rose-extension.json'
      : `Manifest is invalid: ${detail}`
    return { ok: false, error: message }
  }

  const tmpDir = join(installDir, `_install_${Date.now()}`)
  try {
    await copyLocalSource(absSource, tmpDir)

    // Re-validate the manifest from the copy to avoid TOCTOU surprises
    const manifestRead = await readManifestStrict(tmpDir)
    if (!manifestRead.ok) {
      const detail = formatManifestIssues(manifestRead.errors)
      throw new Error(manifestRead.reason === 'parse'
        ? 'Copied source is missing rose-extension.json'
        : `Copied manifest is invalid: ${detail}`)
    }
    const manifest = manifestRead.manifest
    reportManifestWarnings(manifest.id, manifestRead.warnings)

    await buildExtension(tmpDir)

    const destDir = join(installDir, manifest.id)
    if (existsSync(destDir)) {
      unloadExtensionMainModule(rootPath, manifest.id)
      await rm(destDir, { recursive: true, force: true })
    }
    await rename(tmpDir, destDir)
    await applyDefaultDisabledTools(rootPath, manifest)
    await writeEnabledState(rootPath, manifest.id, true)

    const warning = hasInstalledBundle(destDir)
      ? undefined
      : 'Installed, but no main.js or renderer.js was found. Run the extension\'s build (e.g. npm run build) and reinstall.'

    return { ok: true, manifest, warning }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: (err as Error).message }
  }
}

export interface InstallPreviewResult {
  ok: boolean
  error?: string
  token?: string
  manifest?: ExtensionManifest
}

// Preview install from a Git URL. Clones into a temp directory and reads the
// manifest WITHOUT building or moving it into place. The renderer shows the
// capability summary to the user, then calls installConfirm or installCancel.
export async function installPreviewFromGit(rootPath: string, url: string): Promise<InstallPreviewResult> {
  if (!rootPath) return { ok: false, error: 'No project open' }
  const trimmedUrl = String(url ?? '').trim()
  if (!trimmedUrl) return { ok: false, error: 'Repository URL is required' }

  await ensureInstallDir()
  const installDir = getInstallDir()
  const tmpDir = join(installDir, `_clone_${Date.now()}`)

  try {
    await cloneRepo(trimmedUrl, tmpDir)
    const manifestRead = await readManifestStrict(tmpDir)
    if (!manifestRead.ok) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      const detail = formatManifestIssues(manifestRead.errors)
      const intro = manifestRead.reason === 'parse'
        ? 'Invalid extension: repository is missing rose-extension.json'
        : 'Invalid extension manifest'
      return { ok: false, error: `${intro} (${detail})` }
    }
    const manifest = manifestRead.manifest
    reportManifestWarnings(manifest.id, manifestRead.warnings)
    const token = newInstallToken()
    pendingInstalls.set(token, { rootPath, tmpDir, manifest, createdAt: Date.now() })
    return { ok: true, token, manifest }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: (err as Error).message }
  }
}

// Preview install from a local folder. Copies into a temp directory under the
// agent-global install dir (so the rename step on confirm is on the same
// volume) and reads the manifest WITHOUT building or moving it into place.
export async function installPreviewFromDisk(rootPath: string, sourcePath: string): Promise<InstallPreviewResult> {
  if (!rootPath) return { ok: false, error: 'No project open' }
  const trimmed = String(sourcePath ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Source folder is required' }

  const absSource = resolvePath(trimmed)
  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(absSource)
  } catch {
    return { ok: false, error: `Folder does not exist: ${absSource}` }
  }
  if (!st.isDirectory()) return { ok: false, error: 'Source path is not a directory' }

  await ensureInstallDir()
  const installDir = getInstallDir()
  const absInstallDir = resolvePath(installDir)
  if (absSource === absInstallDir || absSource.startsWith(absInstallDir + (process.platform === 'win32' ? '\\' : '/'))) {
    return { ok: false, error: 'Cannot install from a folder inside the extensions directory' }
  }

  const manifestSourceRead = await readManifestStrict(absSource)
  if (!manifestSourceRead.ok) {
    const detail = formatManifestIssues(manifestSourceRead.errors)
    const message = manifestSourceRead.reason === 'parse'
      ? 'Folder is missing rose-extension.json'
      : `Manifest is invalid: ${detail}`
    return { ok: false, error: message }
  }

  const tmpDir = join(installDir, `_install_${Date.now()}`)
  try {
    await copyLocalSource(absSource, tmpDir)
    const manifestRead = await readManifestStrict(tmpDir)
    if (!manifestRead.ok) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      const detail = formatManifestIssues(manifestRead.errors)
      return {
        ok: false,
        error: manifestRead.reason === 'parse'
          ? 'Copied source is missing rose-extension.json'
          : `Copied manifest is invalid: ${detail}`
      }
    }
    const manifest = manifestRead.manifest
    reportManifestWarnings(manifest.id, manifestRead.warnings)
    const token = newInstallToken()
    pendingInstalls.set(token, { rootPath, tmpDir, manifest, createdAt: Date.now() })
    return { ok: true, token, manifest }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: (err as Error).message }
  }
}

// Build + move-into-place the pending install identified by token.
export async function installConfirm(token: string): Promise<InstallResult> {
  const pending = pendingInstalls.get(token)
  if (!pending) return { ok: false, error: 'Install session expired or unknown' }
  pendingInstalls.delete(token)
  try {
    const { manifest, warning } = await finalizePendingInstall(pending)
    return { ok: true, manifest, warning }
  } catch (err) {
    await rm(pending.tmpDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: (err as Error).message }
  }
}

// Delete the temp dir for a previewed-but-not-confirmed install.
export async function installCancel(token: string): Promise<{ ok: boolean }> {
  const pending = pendingInstalls.get(token)
  if (!pending) return { ok: true }
  pendingInstalls.delete(token)
  await rm(pending.tmpDir, { recursive: true, force: true }).catch(() => {})
  return { ok: true }
}

export async function uninstallExtension(rootPath: string, id: string): Promise<{ ok: boolean }> {
  unloadExtensionMainModule(rootPath, id)
  // Remove the agent-global install. Per-workspace overlays (state.json /
  // settings.json) become orphaned, which is harmless — readEnabledState
  // already treats a missing install as a no-op.
  const installPath = join(getInstallDir(), id)
  await rm(installPath, { recursive: true, force: true })
  return { ok: true }
}

export async function enableExtension(rootPath: string, id: string): Promise<{ ok: boolean }> {
  await ensureWorkspaceExtensionsDir(rootPath)
  await writeEnabledState(rootPath, id, true)
  return { ok: true }
}

export async function disableExtension(rootPath: string, id: string): Promise<{ ok: boolean }> {
  unloadExtensionMainModule(rootPath, id)
  await ensureWorkspaceExtensionsDir(rootPath)
  await writeEnabledState(rootPath, id, false)
  return { ok: true }
}

export interface LoadRendererResult {
  ok: boolean
  code: string | null
  css?: string | null
}

export async function loadRendererCode(_rootPath: string, id: string): Promise<LoadRendererResult> {
  const installDir = join(getInstallDir(), id)
  let code: string | null = null
  let css: string | null = null
  try { code = await readFile(join(installDir, 'renderer.js'), 'utf-8') } catch { /* missing */ }
  try { css = await readFile(join(installDir, 'renderer.css'), 'utf-8') } catch { /* optional */ }
  if (!code) return { ok: false, code: null, css: null }
  return { ok: true, code, css }
}

export function loadMainModule(rootPath: string, id: string): { ok: boolean } {
  loadExtensionMainModule(rootPath, id)
  return { ok: true }
}
