import { useEffect, useState } from 'react'
import {
  getAllExtensions,
  getExtensionByViewId,
  subscribeToExtensionsChange,
  type RendererExtension
} from '../../extensions/registry'
import { useAppsDrawerStore } from '../../stores/useAppsDrawerStore'
import { useViewStore } from '../../stores/useViewStore'
import clsx from 'clsx'
import styles from './AppsDrawer.module.css'

function Monogram({ name }: { name: string }): JSX.Element {
  const initials = name
    .split(/[\s\-_/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return <span className={styles.iconMonogram}>{initials || '·'}</span>
}

function ExtensionIcon({ ext }: { ext: RendererExtension }): JSX.Element {
  const icon = ext.manifest.icon
  if (icon && (icon.startsWith('http') || icon.startsWith('data:') || icon.startsWith('/'))) {
    return <img className={styles.iconImg} src={icon} alt="" />
  }
  return <Monogram name={ext.manifest.name} />
}

function CogIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function AppsDrawer(): JSX.Element {
  const storeOpen = useAppsDrawerStore((s) => s.open)
  const close = useAppsDrawerStore((s) => s.close)
  const activeExtensionId = useAppsDrawerStore((s) => s.activeExtensionId)
  const mode = useAppsDrawerStore((s) => s.mode)
  const setActiveExtension = useAppsDrawerStore((s) => s.setActiveExtension)
  const setMode = useAppsDrawerStore((s) => s.setMode)
  const setActiveView = useViewStore((s) => s.setActiveView)

  const [extVersion, setExtVersion] = useState(0)
  // The zustand store survives across mounts (HMR, project switches). The first
  // paint of this component must always be CLOSED, otherwise a stale open=true
  // value would render the drawer in the open state and then animate it down.
  const [mounted, setMounted] = useState(false)
  const open = mounted && storeOpen

  useEffect(() => subscribeToExtensionsChange(() => setExtVersion((v) => v + 1)), [])

  useEffect(() => {
    close()
    setMounted(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC closes
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, close])

  const extensions = getAllExtensions()
  void extVersion // re-read getAllExtensions when registry changes

  // Auto-select first extension when opening, when nothing selected, or when
  // the previously-selected extension has been uninstalled/disabled.
  useEffect(() => {
    if (!open) return
    if (extensions.length === 0) return
    const current = activeExtensionId ? getExtensionByViewId(activeExtensionId) : undefined
    if (!current) {
      setActiveExtension(extensions[0].manifest.id)
    }
  }, [open, extensions, activeExtensionId, setActiveExtension])

  if (!mounted) return <></>

  const activeExt = activeExtensionId ? getExtensionByViewId(activeExtensionId) : undefined

  function handleSelect(id: string): void {
    setActiveExtension(id)
  }

  function handleCog(ext: RendererExtension, e: React.MouseEvent): void {
    e.stopPropagation()
    if (!ext.SettingsView) return
    if (activeExtensionId === ext.manifest.id) {
      setMode(mode === 'settings' ? 'page' : 'settings')
    } else {
      setActiveExtension(ext.manifest.id)
      setMode('settings')
    }
  }

  function renderMain(): JSX.Element {
    if (extensions.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>No extensions installed</div>
          <button
            type="button"
            className={styles.emptyAction}
            onClick={() => {
              close()
              setActiveView('settings')
            }}
          >
            Open Settings → Extensions → Manage
          </button>
        </div>
      )
    }
    if (!activeExt) return <div className={styles.emptyState} />
    if (mode === 'settings' && activeExt.SettingsView) {
      const Comp = activeExt.SettingsView
      return <Comp />
    }
    if (activeExt.PageView) {
      const Comp = activeExt.PageView
      return <Comp />
    }
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyTitle}>{activeExt.manifest.name}</div>
        <div className={styles.emptySub}>This extension does not provide a page view.</div>
      </div>
    )
  }

  return (
    <>
      <div
        className={clsx(styles.backdrop, open && styles.backdropOpen)}
        onClick={close}
        aria-hidden="true"
      />

      <div
        className={clsx(styles.drawer, open && styles.drawerOpen)}
        role="dialog"
        aria-label="Apps"
        aria-hidden={!open}
      >
        <div className={styles.handle} aria-hidden="true" />

        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <span className={styles.headerMeta}>PROJECTROSE · APPS</span>
            <span className={styles.headerName}>App Board</span>
          </div>
        </div>

        <div className={styles.divider} aria-hidden="true" />

        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            {extensions.map((ext, idx) => {
              const isActive = ext.manifest.id === activeExtensionId
              const showingSettings = isActive && mode === 'settings'
              return (
                <div
                  key={ext.manifest.id}
                  className={clsx(styles.sidebarItem, isActive && styles.sidebarItemActive)}
                >
                  <button
                    type="button"
                    className={styles.sidebarRow}
                    onClick={() => handleSelect(ext.manifest.id)}
                    tabIndex={open ? 0 : -1}
                    title={ext.manifest.description}
                  >
                    <span className={styles.sidebarSpecimen}>№{String(idx + 1).padStart(2, '0')}</span>
                    <span className={styles.sidebarIcon}>
                      <ExtensionIcon ext={ext} />
                    </span>
                    <span className={styles.sidebarLabel}>
                      <span className={styles.sidebarName}>{ext.manifest.name}</span>
                      {ext.manifest.latin && (
                        <span className={styles.sidebarLatin}>{ext.manifest.latin}</span>
                      )}
                    </span>
                  </button>
                  {ext.SettingsView && (
                    <button
                      type="button"
                      className={clsx(styles.sidebarCog, showingSettings && styles.sidebarCogActive)}
                      onClick={(e) => handleCog(ext, e)}
                      title={showingSettings ? 'Hide settings' : 'Settings'}
                      aria-label={`${ext.manifest.name} settings`}
                      aria-pressed={showingSettings}
                      tabIndex={open ? 0 : -1}
                    >
                      <CogIcon />
                    </button>
                  )}
                </div>
              )
            })}
            {extensions.length === 0 && (
              <div className={styles.sidebarEmpty}>No extensions</div>
            )}
          </aside>

          <div className={clsx(styles.mainPane, mode === 'settings' && styles.mainPaneSettings)}>{renderMain()}</div>
        </div>
      </div>
    </>
  )
}
