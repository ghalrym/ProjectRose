import { useState, useEffect, useCallback } from 'react'
import type { InstalledExtension } from '../../../../shared/extension-types'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { loadDynamicExtensions } from '../../extensions/registry'
import styles from './SettingsView.module.css'

export function ExtensionsTab(): JSX.Element {
  const [installed, setInstalled] = useState<InstalledExtension[]>([])
  const [installing, setInstalling] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [installError, setInstallError] = useState<string | null>(null)

  const rootPath = useProjectStore((s) => s.rootPath)
  const navItems = useSettingsStore((s) => s.navItems)
  const updateSettings = useSettingsStore((s) => s.update)

  const loadInstalled = useCallback(async () => {
    if (!rootPath) { setInstalled([]); return }
    const result = await window.api.extension.list(rootPath)
    setInstalled(result.installed)
  }, [rootPath])

  useEffect(() => { loadInstalled() }, [loadInstalled])

  const handleInstallFromGit = useCallback(async () => {
    if (!rootPath) return
    const url = gitUrl.trim()
    if (!url) {
      setInstallError('Repository URL is required')
      return
    }
    setInstalling(true)
    setInstallError(null)
    try {
      const result = await window.api.extension.installFromGit(rootPath, url)
      if (!result.ok) {
        setInstallError(result.error ?? 'Install failed')
        return
      }

      const { installed: newInstalled } = await window.api.extension.list(rootPath)
      setInstalled(newInstalled)

      const prevIds = new Set(installed.map((e) => e.manifest.id))
      const added = newInstalled.filter((e) => !prevIds.has(e.manifest.id) && e.manifest.navItem)
      const newNavItems = added
        .filter((e) => !navItems.some((n) => n.viewId === e.manifest.id))
        .map((e) => ({ viewId: e.manifest.id, label: e.manifest.navItem!.label, visible: true }))
      if (newNavItems.length > 0) {
        await updateSettings({ navItems: [...navItems, ...newNavItems] })
      }
      await loadDynamicExtensions(rootPath)
      setGitUrl('')
    } catch (err) {
      setInstallError((err as Error).message ?? 'Install failed')
    } finally {
      setInstalling(false)
    }
  }, [installed, navItems, updateSettings, rootPath, gitUrl])

  const handleUninstall = useCallback(async (ext: InstalledExtension) => {
    if (!rootPath) return
    await window.api.extension.uninstall(rootPath, ext.manifest.id)
    await updateSettings({ navItems: navItems.filter((n) => n.viewId !== ext.manifest.id) })
    await loadInstalled()
    await loadDynamicExtensions(rootPath)
  }, [loadInstalled, navItems, updateSettings, rootPath])

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
                onKeyDown={(e) => { if (e.key === 'Enter' && !installing) handleInstallFromGit() }}
                disabled={installing}
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
                disabled={installing || !gitUrl.trim()}
                onClick={handleInstallFromGit}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-sm, 4px)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: installing ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                  cursor: installing || !gitUrl.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  letterSpacing: '1px',
                  fontFamily: 'var(--font-family-mono)',
                  whiteSpace: 'nowrap',
                  opacity: installing || !gitUrl.trim() ? 0.5 : 1,
                }}
              >
                {installing ? 'INSTALLING…' : 'INSTALL'}
              </button>
            </div>
            {installError && (
              <span style={{ fontSize: 11, color: 'var(--color-danger, #dc2626)' }}>
                {installError}
              </span>
            )}
          </div>
        )}
        {rootPath && installed.map((ext) => (
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
        ))}
        {rootPath && installed.length === 0 && (
          <div className={styles.emptyState}>No extensions installed. Paste a Git repository URL above to add one.</div>
        )}
      </div>
    </section>
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
