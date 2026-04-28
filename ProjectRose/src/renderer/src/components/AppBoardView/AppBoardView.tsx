import { useMemo, useState, useEffect, useRef } from 'react'
import { getAllExtensions, subscribeToExtensionsChange, type RendererExtension } from '../../extensions/registry'
import { useViewStore } from '../../stores/useViewStore'
import styles from './AppBoardView.module.css'

interface SubItem {
  id: string
  name: string
  description?: string
  iconNode: React.ReactNode
  onClick?: () => void
}

interface AppItem {
  id: string                    // viewId to navigate to
  name: string
  description?: string
  latin?: string
  searchTerms: string
  iconNode: React.ReactNode
  subItems: SubItem[]
}

// ──────────────────────────────────────────────────────────────
// Icon helpers
// ──────────────────────────────────────────────────────────────

function Monogram({ name, sub = false }: { name: string; sub?: boolean }): JSX.Element {
  const initials = name
    .split(/[\s\-_/]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span className={sub ? styles.subIconMonogram : styles.iconMonogram}>
      {initials || '·'}
    </span>
  )
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

function ToolIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2 L12 6 M12 18 L12 22 M2 12 L6 12 M18 12 L22 12 M5 5 L7.8 7.8 M16.2 16.2 L19 19 M5 19 L7.8 16.2 M16.2 7.8 L19 5" opacity="0.7" />
    </svg>
  )
}

// ──────────────────────────────────────────────────────────────
// Build app list
// ──────────────────────────────────────────────────────────────

function buildAppItems(): AppItem[] {
  const items: AppItem[] = []

  items.push({
    id: 'editor',
    name: 'Editor',
    latin: 'Rosa scriptoris',
    description: 'Built-in code editor — file tree, tabs, terminal.',
    searchTerms: 'editor code files monaco terminal built-in',
    iconNode: <EditorIcon />,
    subItems: [
      { id: 'editor:files',    name: 'Files',    description: 'File tree & quick open', iconNode: <Monogram name="File" sub /> },
      { id: 'editor:terminal', name: 'Terminal', description: 'Toggle terminal panel',  iconNode: <Monogram name="Term" sub /> },
      { id: 'editor:search',   name: 'Search',   description: 'Find in files',          iconNode: <Monogram name="Find" sub /> },
    ],
  })

  for (const ext of getAllExtensions()) {
    const tools = ext.manifest.provides.tools ?? []
    items.push({
      id: ext.manifest.id,
      name: ext.manifest.name,
      description: ext.manifest.description,
      searchTerms: [ext.manifest.id, ext.manifest.name, ext.manifest.description, ext.manifest.author].join(' '),
      iconNode: <ExtensionIcon ext={ext} />,
      subItems: tools.map((t) => ({
        id: `${ext.manifest.id}:${t.name}`,
        name: t.displayName,
        description: t.description,
        iconNode: <ToolIcon />,
      })),
    })
  }

  return items.sort((a, b) => a.name.localeCompare(b.name))
}

// ──────────────────────────────────────────────────────────────
// View
// ──────────────────────────────────────────────────────────────

export function AppBoardView(): JSX.Element {
  const setActiveView = useViewStore((s) => s.setActiveView)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [, setExtVersion] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => subscribeToExtensionsChange(() => setExtVersion((v) => v + 1)), [])

  useEffect(() => { searchRef.current?.focus() }, [])

  const allItems = useMemo(() => buildAppItems(), [])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allItems
    return allItems.filter((a) => a.searchTerms.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
  }, [allItems, query])

  function toggleExpand(id: string): void {
    setExpanded((cur) => (cur === id ? null : id))
  }

  function handleLaunch(id: string): void {
    setActiveView(id)
  }

  return (
    <div className={styles.layout}>
      <div className={styles.body}>
        <div className={styles.page}>
          {/* Header */}
          <div className={styles.pageHeader}>
            <div>
              <div className={styles.pageHeaderMeta}>PROJECTROSE · APPS · BOARD</div>
              <div className={styles.pageTitle}>
                <span className={styles.pageTitleAccent}>App Board</span>
                {' · '}
                <span className={styles.pageTitleSub}>installed apparatus</span>
              </div>
            </div>
            <div className={styles.pageHeaderRight}>
              <div>{allItems.length} ENTR{allItems.length === 1 ? 'Y' : 'IES'}</div>
              <div className={styles.colophonAccent}>Rosa apparatus</div>
            </div>
          </div>
          <hr className={styles.headerDivider} />

          {/* Search */}
          <div className={styles.searchRow}>
            <svg className={styles.searchIcon} viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11 L14 14" />
            </svg>
            <input
              ref={searchRef}
              className={styles.searchInput}
              type="text"
              value={query}
              placeholder="Search apps & extensions…"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className={styles.searchClear} onClick={() => setQuery('')}>
                CLEAR
              </button>
            )}
            <span className={styles.countLabel}>
              {items.length} of {allItems.length}
            </span>
          </div>

          {/* Grid */}
          {items.length === 0 ? (
            <div className={styles.emptyState}>
              No apps match "{query}"
            </div>
          ) : (
            <div className={styles.grid}>
              {items.map((app, idx) => {
                const isExpanded = expanded === app.id
                if (isExpanded) {
                  return (
                    <div
                      key={app.id}
                      className={`${styles.card} ${styles.cardExpanded}`}
                      data-testid="app-card-expanded"
                      data-app-id={app.id}
                    >
                      <div className={styles.expandedHead}>
                        <div className={styles.iconBox}>{app.iconNode}</div>
                        <div className={styles.expandedHeadInfo}>
                          <div className={styles.expandedTitleRow}>
                            <span className={styles.expandedName}>{app.name}</span>
                            {app.latin && <span className={styles.expandedLatin}>{app.latin}</span>}
                          </div>
                          {app.description && (
                            <div className={styles.expandedDesc}>{app.description}</div>
                          )}
                        </div>
                        <div className={styles.expandedActions}>
                          <button type="button" className={styles.openBtn} onClick={() => handleLaunch(app.id)}>
                            OPEN
                          </button>
                          <button type="button" className={styles.collapseBtn} onClick={() => setExpanded(null)}>
                            ▴ COLLAPSE
                          </button>
                        </div>
                      </div>

                      <div className={styles.subSectionLabel}>
                        Inside · {app.subItems.length} item{app.subItems.length === 1 ? '' : 's'}
                      </div>

                      {app.subItems.length === 0 ? (
                        <div className={styles.subEmpty}>No sub-items registered.</div>
                      ) : (
                        <div className={styles.subGrid}>
                          {app.subItems.map((sub) => (
                            <button
                              key={sub.id}
                              type="button"
                              className={styles.subCard}
                              title={sub.description}
                              onClick={() => sub.onClick ? sub.onClick() : handleLaunch(app.id)}
                              data-testid="app-subcard"
                              data-sub-id={sub.id}
                            >
                              <div className={styles.subIconBox}>{sub.iconNode}</div>
                              <span className={styles.subLabel}>{sub.name}</span>
                              {sub.description && (
                                <span className={styles.subDesc}>{sub.description}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <button
                    key={app.id}
                    type="button"
                    className={styles.card}
                    onClick={() => handleLaunch(app.id)}
                    onContextMenu={(e) => { e.preventDefault(); toggleExpand(app.id) }}
                    title={app.description}
                    data-testid="app-card"
                    data-app-id={app.id}
                  >
                    <span className={styles.cardSpecimen}>№{String(idx + 1).padStart(2, '0')}</span>
                    {app.subItems.length > 0 && (
                      <span
                        className={styles.cardExpandHint}
                        onClick={(e) => { e.stopPropagation(); toggleExpand(app.id) }}
                        role="button"
                      >
                        {app.subItems.length} ▾
                      </span>
                    )}
                    <div className={styles.iconBox}>{app.iconNode}</div>
                    <span className={styles.cardLabel}>{app.name}</span>
                    {app.latin && <span className={styles.cardLatin}>{app.latin}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className={styles.statusBar}>
        <span>{allItems.length} app{allItems.length === 1 ? '' : 's'} on board</span>
        <span className={styles.statusSep}>│</span>
        <span>click ▾ to expand</span>
        <span className={styles.statusSep}>│</span>
        <span>right-click any tile to peek inside</span>
        <div className={styles.statusBarRight}>
          <span className={styles.statusAccent}>Rosa apparatus</span>
          <span className={styles.statusSep}>│</span>
          <span>ROSE</span>
        </div>
      </div>
    </div>
  )
}
