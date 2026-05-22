import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ExtensionManifest, InstalledExtension } from '../../../../shared/extension-types'
import {
  capabilityLabels,
  CAPABILITY_KEYS,
  type Capability
} from '../../../../shared/extension-contract'
import { useProjectStore } from '../../stores/useProjectStore'
import { loadDynamicExtensions } from '../../extensions/registry'
import { FEATURED_CATALOG, type CatalogEntry } from '../../extensions/featuredCatalog'
import styles from './SettingsView.module.css'

type ExtensionPane = 'discover' | 'installed'

interface PendingPreview {
  token: string
  manifest: ExtensionManifest
  /** Friendly source description for the dialog ("disk: /path" or "git: url"). */
  source: string
}

export function ExtensionsTab(): JSX.Element {
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [installingUrl, setInstallingUrl] = useState(false)
  const [installingDisk, setInstallingDisk] = useState(false)
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set())
  const [gitUrl, setGitUrl] = useState('')
  const [installError, setInstallError] = useState<string | null>(null)
  const [activePane, setActivePane] = useState<ExtensionPane>('discover')
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null)
  const [confirming, setConfirming] = useState(false)

  const rootPath = useProjectStore((s) => s.rootPath)

  const loadInstalled = useCallback(async () => {
    if (!rootPath) { setInstalled([]); return }
    const result = await window.api.extension.list(rootPath)
    setInstalled(result.installed)
  }, [rootPath])

  useEffect(() => { loadInstalled() }, [loadInstalled])

  const installedIds = useMemo(() => new Set(installed.map((e) => e.manifest.id)), [installed])

  // After any install, refresh the installed list and load the dynamic bundle.
  // Extensions show up in the Apps board, not the nav, so there's no nav-item to register.
  const finalizeInstall = useCallback(async (): Promise<void> => {
    if (!rootPath) return
    const { installed: newInstalled } = await window.api.extension.list(rootPath)
    setInstalled(newInstalled)
    await loadDynamicExtensions(rootPath)
  }, [rootPath])

  // Preview an install from a URL: clones into a temp dir on the host,
  // returns the manifest + a token. The user then confirms (build + move
  // into place) or cancels (delete temp dir).
  const previewFromUrl = useCallback(async (
    url: string,
    sourceLabel: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!rootPath) return { ok: false, error: 'No project open' }
    const result = await window.api.extension.installPreviewFromGit(rootPath, url)
    if (!result.ok || !result.token || !result.manifest) {
      return { ok: false, error: result.error ?? 'Install failed' }
    }
    setPendingPreview({ token: result.token, manifest: result.manifest, source: sourceLabel })
    return { ok: true }
  }, [rootPath])

  const handleInstallFromGit = useCallback(async () => {
    const url = gitUrl.trim()
    if (!url) {
      setInstallError('Repository URL is required')
      return
    }
    setInstallingUrl(true)
    setInstallError(null)
    try {
      const result = await previewFromUrl(url, `git: ${url}`)
      if (!result.ok) setInstallError(result.error ?? 'Install failed')
    } catch (err) {
      setInstallError((err as Error).message ?? 'Install failed')
    } finally {
      setInstallingUrl(false)
    }
  }, [gitUrl, previewFromUrl])

  const handleInstallFromDisk = useCallback(async () => {
    if (!rootPath || installingDisk) return
    setInstallError(null)

    const folder = await window.api.openFolderDialog()
    if (!folder) return

    setInstallingDisk(true)
    try {
      const result = await window.api.extension.installPreviewFromDisk(rootPath, folder)
      if (!result.ok || !result.token || !result.manifest) {
        setInstallError(result.error ?? 'Install failed')
        return
      }
      setPendingPreview({ token: result.token, manifest: result.manifest, source: `disk: ${folder}` })
    } catch (err) {
      setInstallError((err as Error).message ?? 'Install failed')
    } finally {
      setInstallingDisk(false)
    }
  }, [rootPath, installingDisk])

  const handleInstallFromCatalog = useCallback(async (entry: CatalogEntry) => {
    setInstallError(null)
    setInstallingIds((prev) => { const next = new Set(prev); next.add(entry.id); return next })
    try {
      const result = await previewFromUrl(entry.repoUrl, `${entry.name} (${entry.repoUrl})`)
      if (!result.ok) setInstallError(`${entry.name}: ${result.error ?? 'Install failed'}`)
    } catch (err) {
      setInstallError(`${entry.name}: ${(err as Error).message ?? 'Install failed'}`)
    } finally {
      setInstallingIds((prev) => { const next = new Set(prev); next.delete(entry.id); return next })
    }
  }, [previewFromUrl])

  const handleConfirmPreview = useCallback(async () => {
    if (!pendingPreview || confirming) return
    setConfirming(true)
    setInstallError(null)
    try {
      const result = await window.api.extension.installConfirm(pendingPreview.token)
      if (!result.ok) {
        setInstallError(result.error ?? 'Install failed')
        return
      }
      await finalizeInstall()
      setActivePane('installed')
      setGitUrl('')
      setPendingPreview(null)
      if (result.warning) setInstallError(result.warning)
    } catch (err) {
      setInstallError((err as Error).message ?? 'Install failed')
    } finally {
      setConfirming(false)
    }
  }, [pendingPreview, confirming, finalizeInstall])

  const handleCancelPreview = useCallback(async () => {
    if (!pendingPreview) return
    const token = pendingPreview.token
    setPendingPreview(null)
    try {
      await window.api.extension.installCancel(token)
    } catch {
      // Cleanup is best-effort; the host also handles orphan temp dirs on
      // next install of the same id.
    }
  }, [pendingPreview])

  const handleUninstall = useCallback(async (ext: InstalledExtension) => {
    if (!rootPath) return
    await window.api.extension.uninstall(rootPath, ext.manifest.id)
    await loadInstalled()
    await loadDynamicExtensions(rootPath)
  }, [loadInstalled, rootPath])

  const handleToggle = useCallback(async (id: string, currentlyEnabled: boolean) => {
    if (!rootPath) return
    if (currentlyEnabled) {
      await window.api.extension.disable(rootPath, id)
    } else {
      await window.api.extension.enable(rootPath, id)
    }
    await loadInstalled()
    await loadDynamicExtensions(rootPath)
  }, [loadInstalled, rootPath])

  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>Extensions</div>

      {pendingPreview && (
        <InstallPreviewDialog
          preview={pendingPreview}
          confirming={confirming}
          onConfirm={handleConfirmPreview}
          onCancel={handleCancelPreview}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!rootPath && (
          <div className={styles.emptyState}>Open a project to manage extensions.</div>
        )}

        {rootPath && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '14px 16px',
              border: '1px dashed var(--color-border-strong, var(--color-border))',
              borderRadius: 'var(--radius-md, 6px)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, letterSpacing: '1px', fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-secondary)' }}>
                INSTALL FROM GIT
              </span>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                Clone a repository containing a rose-extension.json manifest
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !installingUrl) handleInstallFromGit() }}
                disabled={installingUrl}
                placeholder="https://github.com/owner/repo.git"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm, 4px)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  fontSize: 13,
                  fontFamily: 'var(--font-family-mono)',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                disabled={installingUrl || !gitUrl.trim()}
                onClick={handleInstallFromGit}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-sm, 4px)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: installingUrl ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                  cursor: installingUrl || !gitUrl.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  letterSpacing: '1px',
                  fontFamily: 'var(--font-family-mono)',
                  whiteSpace: 'nowrap',
                  opacity: installingUrl || !gitUrl.trim() ? 0.5 : 1,
                }}
              >
                {installingUrl ? 'INSTALLING…' : 'INSTALL'}
              </button>
            </div>
            {installError && (
              <span style={{ fontSize: 11, color: 'var(--color-danger, #dc2626)' }}>
                {installError}
              </span>
            )}
          </div>
        )}

        {rootPath && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '14px 16px',
              border: '1px dashed var(--color-border-strong, var(--color-border))',
              borderRadius: 'var(--radius-md, 6px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 11, letterSpacing: '1px', fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-secondary)' }}>
                  INSTALL FROM DISK
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                  Pick a local folder containing a rose-extension.json manifest. Use this to develop and test extensions locally.
                </span>
              </div>
              <button
                type="button"
                disabled={installingDisk}
                onClick={handleInstallFromDisk}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-sm, 4px)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: installingDisk ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                  cursor: installingDisk ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  letterSpacing: '1px',
                  fontFamily: 'var(--font-family-mono)',
                  whiteSpace: 'nowrap',
                  opacity: installingDisk ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                {installingDisk ? 'INSTALLING…' : 'CHOOSE FOLDER'}
              </button>
            </div>
          </div>
        )}

        {rootPath && (
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <button
              type="button"
              className={`${styles.tabBtn} ${activePane === 'discover' ? styles.tabBtnActive : ''}`}
              onClick={() => setActivePane('discover')}
            >
              Discover
            </button>
            <button
              type="button"
              className={`${styles.tabBtn} ${activePane === 'installed' ? styles.tabBtnActive : ''}`}
              onClick={() => setActivePane('installed')}
            >
              Installed{installed.length > 0 ? ` (${installed.length})` : ''}
            </button>
          </div>
        )}

        {rootPath && activePane === 'discover' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FEATURED_CATALOG.map((entry) => (
              <CatalogRow
                key={entry.id}
                entry={entry}
                installed={installedIds.has(entry.id)}
                installing={installingIds.has(entry.id)}
                onInstall={() => handleInstallFromCatalog(entry)}
              />
            ))}
          </div>
        )}

        {rootPath && activePane === 'installed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {installed.length === 0 ? (
              <div className={styles.emptyState}>
                No extensions installed. Switch to Discover or paste a Git URL above to add one.
              </div>
            ) : (
              installed.map((ext) => (
                <ExtensionRow
                  key={ext.manifest.id}
                  name={ext.manifest.name}
                  description={ext.manifest.description}
                  version={ext.manifest.version}
                  author={ext.manifest.author}
                  enabled={ext.enabled}
                  onToggle={() => handleToggle(ext.manifest.id, ext.enabled)}
                  onUninstall={() => handleUninstall(ext)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </section>
  )
}

interface CatalogRowProps {
  entry: CatalogEntry
  installed: boolean
  installing: boolean
  onInstall: () => void
}

function CatalogRow({ entry, installed, installing, onInstall }: CatalogRowProps): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      padding: '14px 16px',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md, 6px)',
      background: 'var(--color-bg-secondary)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {entry.name}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {entry.description}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, fontFamily: 'var(--font-family-mono)' }}>
          {entry.author} · {entry.repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {installed ? (
          <span style={{
            fontSize: 11,
            letterSpacing: '1px',
            fontFamily: 'var(--font-family-mono)',
            color: 'var(--color-text-muted)',
            padding: '6px 10px',
          }}>
            INSTALLED
          </span>
        ) : (
          <button
            type="button"
            disabled={installing}
            onClick={onInstall}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm, 4px)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: installing ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
              cursor: installing ? 'not-allowed' : 'pointer',
              fontSize: 11,
              letterSpacing: '1px',
              fontFamily: 'var(--font-family-mono)',
              whiteSpace: 'nowrap',
              opacity: installing ? 0.5 : 1,
            }}
          >
            {installing ? 'INSTALLING…' : 'INSTALL'}
          </button>
        )}
      </div>
    </div>
  )
}

interface ExtensionRowProps {
  name: string
  description: string
  version: string
  author: string
  enabled: boolean
  onToggle: () => void
  onUninstall: () => void
}

function ExtensionRow({ name, description, version, author, enabled, onToggle, onUninstall }: ExtensionRowProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      padding: '14px 16px',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md, 6px)',
      background: 'var(--color-bg-secondary)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {name}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {description}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          v{version} · {author}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button type="button" className={styles.refreshBtn} onClick={onToggle}>
          {enabled ? 'Disable' : 'Enable'}
        </button>
        <button type="button" className={styles.refreshBtn} onClick={onUninstall}>
          Uninstall
        </button>
      </div>
    </div>
  )
}

interface InstallPreviewDialogProps {
  preview: PendingPreview
  confirming: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Lists the capabilities declared in the manifest's `provides` block.
// Order is the contract module's CAPABILITY_KEYS order — UI shouldn't have
// its own opinion about what comes first; the contract owns that.
function summarizeCapabilities(manifest: ExtensionManifest): string[] {
  const provides = manifest.provides ?? {}
  const lines: string[] = []
  for (const cap of CAPABILITY_KEYS) {
    if (!provides[cap as Capability]) continue
    let label = capabilityLabels[cap as Capability]
    if (cap === 'agentTools') {
      const count = provides.tools?.length ?? 0
      if (count > 0) label = `${label} (${count})`
    } else if (cap === 'chatHooks') {
      const count = provides.hooks?.length ?? 0
      if (count > 0) label = `${label} (${count})`
    }
    lines.push(label)
  }
  if (provides.systemPrompt) {
    lines.push('Append an extension system prompt')
  }
  return lines
}

function InstallPreviewDialog({ preview, confirming, onConfirm, onCancel }: InstallPreviewDialogProps): JSX.Element {
  const { manifest, source } = preview
  const capabilities = summarizeCapabilities(manifest)
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Install ${manifest.name}`}
    >
      <div
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: 20,
          maxWidth: 520,
          width: 'calc(100% - 32px)',
          maxHeight: '80vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, letterSpacing: '1px', fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-secondary)' }}>
            INSTALL EXTENSION
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {manifest.name}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            {manifest.description}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-family-mono)', marginTop: 4 }}>
            v{manifest.version} · {manifest.author} · {source}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: '1px', fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-secondary)' }}>
            THIS EXTENSION WILL BE ABLE TO
          </span>
          {capabilities.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              (No capabilities declared — extension is inert.)
            </span>
          ) : (
            <ul style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              {capabilities.map((line) => (
                <li key={line} style={{ fontSize: 12, color: 'var(--color-text-primary)', display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            disabled={confirming}
            onClick={onCancel}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm, 4px)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              cursor: confirming ? 'not-allowed' : 'pointer',
              fontSize: 11,
              letterSpacing: '1px',
              fontFamily: 'var(--font-family-mono)',
              opacity: confirming ? 0.5 : 1,
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            disabled={confirming}
            onClick={onConfirm}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm, 4px)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: confirming ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
              cursor: confirming ? 'not-allowed' : 'pointer',
              fontSize: 11,
              letterSpacing: '1px',
              fontFamily: 'var(--font-family-mono)',
              opacity: confirming ? 0.5 : 1,
            }}
          >
            {confirming ? 'INSTALLING…' : 'INSTALL'}
          </button>
        </div>
      </div>
    </div>
  )
}
