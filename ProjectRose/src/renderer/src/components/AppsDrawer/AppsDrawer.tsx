import { useEffect, useMemo, useRef, useState } from 'react'
import { getAllExtensions, subscribeToExtensionsChange, type RendererExtension } from '../../extensions/registry'
import { useViewStore } from '../../stores/useViewStore'
import { useAppsDrawerStore } from '../../stores/useAppsDrawerStore'
import clsx from 'clsx'
import styles from './AppsDrawer.module.css'

interface AppItem {
  id: string
  name: string
  latin?: string
  description?: string
  searchTerms: string
  iconNode: React.ReactNode
}

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

function EditorIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 5 L20 5 L26 11 L26 27 L6 27 Z" />
      <path d="M20 5 L20 11 L26 11" />
      <path d="M10 16 L22 16 M10 20 L22 20 M10 24 L18 24" opacity="0.7" />
    </svg>
  )
}

function ChatIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 8 H26 A2 2 0 0 1 28 10 V20 A2 2 0 0 1 26 22 H14 L8 27 V22 A2 2 0 0 1 6 20 V10 A2 2 0 0 1 6 8 Z" />
      <path d="M11 13 H21 M11 17 H18" opacity="0.7" />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="16" cy="16" r="3" />
      <path d="M16 4 V8 M16 24 V28 M4 16 H8 M24 16 H28 M7.5 7.5 L10.3 10.3 M21.7 21.7 L24.5 24.5 M7.5 24.5 L10.3 21.7 M21.7 10.3 L24.5 7.5" opacity="0.7" />
    </svg>
  )
}

function buildAppItems(): AppItem[] {
  const items: AppItem[] = [
    {
      id: 'chat',
      name: 'Agent',
      latin: 'Rosa loquens',
      description: 'Talk with Rose — chat, voice, agentic tools.',
      searchTerms: 'agent chat voice rose talk built-in',
      iconNode: <ChatIcon />
    },
    {
      id: 'editor',
      name: 'Editor',
      latin: 'Rosa scriptoris',
      description: 'Built-in code editor — file tree, tabs, terminal.',
      searchTerms: 'editor code files monaco terminal built-in',
      iconNode: <EditorIcon />
    }
  ]

  for (const ext of getAllExtensions()) {
    items.push({
      id: ext.manifest.id,
      name: ext.manifest.name,
      latin: ext.manifest.latin,
      description: ext.manifest.description,
      searchTerms: [ext.manifest.id, ext.manifest.name, ext.manifest.description, ext.manifest.author].join(' '),
      iconNode: <ExtensionIcon ext={ext} />
    })
  }

  items.push({
    id: 'settings',
    name: 'Settings',
    latin: 'Rosa regulae',
    description: 'Preferences, providers, tools, and more.',
    searchTerms: 'settings preferences config options',
    iconNode: <SettingsIcon />
  })

  return items
}

export function AppsDrawer(): JSX.Element {
  const open = useAppsDrawerStore((s) => s.open)
  const close = useAppsDrawerStore((s) => s.close)
  const setActiveView = useViewStore((s) => s.setActiveView)

  const [query, setQuery] = useState('')
  const [extVersion, setExtVersion] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => subscribeToExtensionsChange(() => setExtVersion((v) => v + 1)), [])

  // Re-focus the search field whenever the drawer opens; clear the query on close.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 220)
      return () => clearTimeout(t)
    }
    setQuery('')
    return undefined
  }, [open])

  // ESC closes
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, close])

  const allItems = useMemo(() => buildAppItems(), [extVersion])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allItems
    return allItems.filter(
      (a) => a.searchTerms.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    )
  }, [allItems, query])

  function handleLaunch(id: string): void {
    setActiveView(id)
    close()
  }

  return (
    <>
      {/* Backdrop — click outside to close */}
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
          <div className={styles.searchWrap}>
            <svg className={styles.searchIcon} viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11 L14 14" />
            </svg>
            <input
              ref={searchRef}
              className={styles.searchInput}
              type="text"
              value={query}
              placeholder="Search apps…"
              onChange={(e) => setQuery(e.target.value)}
              tabIndex={open ? 0 : -1}
            />
          </div>
        </div>

        <div className={styles.body}>
          {items.length === 0 ? (
            <div className={styles.empty}>No apps match &ldquo;{query}&rdquo;</div>
          ) : (
            <div className={styles.grid}>
              {items.map((app, idx) => (
                <button
                  key={app.id}
                  type="button"
                  className={styles.card}
                  onClick={() => handleLaunch(app.id)}
                  title={app.description}
                  tabIndex={open ? 0 : -1}
                >
                  <span className={styles.cardSpecimen}>№{String(idx + 1).padStart(2, '0')}</span>
                  <div className={styles.iconBox}>{app.iconNode}</div>
                  <span className={styles.cardLabel}>{app.name}</span>
                  {app.latin && <span className={styles.cardLatin}>{app.latin}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
