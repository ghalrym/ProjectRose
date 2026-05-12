import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/useProjectStore'
import { useFileStore } from '../../stores/useFileStore'
import { clearChatForProjectSwitch } from '../../services/chatTurn'
import { RoseMark } from './RoseMark'
import styles from './BrandMenu.module.css'

interface BrandMenuProps {
  projectName: string
}

const CLOSE_DELAY_MS = 180

async function switchToProject(path: string): Promise<void> {
  const current = useProjectStore.getState().rootPath
  if (path === current) return

  useFileStore.setState({
    openFiles: [],
    activeFilePath: null,
    previousActiveFilePath: null
  })
  clearChatForProjectSwitch()

  await useProjectStore.getState().openFolder(path)
}

export function BrandMenu({ projectName }: BrandMenuProps): JSX.Element {
  const recentProjects = useProjectStore((s) => s.recentProjects)
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects)
  const rootPath = useProjectStore((s) => s.rootPath)

  const [open, setOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = (): void => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      setRecentOpen(false)
    }, CLOSE_DELAY_MS)
  }

  const closeNow = (): void => {
    cancelClose()
    setOpen(false)
    setRecentOpen(false)
  }

  // Refresh recents when the menu opens
  useEffect(() => {
    if (open) loadRecentProjects()
  }, [open, loadRecentProjects])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeNow()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeNow()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Cleanup pending timer on unmount
  useEffect(() => () => cancelClose(), [])

  const handleOpenProject = async (): Promise<void> => {
    closeNow()
    const path = await window.api.openFolderDialog()
    if (path) await switchToProject(path)
  }

  const handleOpenRecent = async (path: string): Promise<void> => {
    closeNow()
    await switchToProject(path)
  }

  const handleExit = (): void => {
    closeNow()
    window.api.quitApp().catch(() => {})
  }

  const filteredRecents = recentProjects.filter((p) => p.path !== rootPath)

  return (
    <div
      ref={containerRef}
      className={styles.wrap}
      onMouseEnter={() => { cancelClose(); setOpen(true) }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={`${styles.brandBtn} ${open ? styles.brandBtnOpen : ''}`}
        onClick={() => { cancelClose(); setOpen(true) }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <RoseMark size={24} />
        <div className={styles.wordmark}>
          <div className={styles.wordmarkName}>
            Project<span className={styles.wordmarkRose}>Rose</span>
            <span className={styles.caret}>{open ? '▾' : '▸'}</span>
          </div>
          <div className={styles.wordmarkSub}>№ 01 · {projectName}</div>
        </div>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            className={styles.menuItem}
            role="menuitem"
            onMouseEnter={() => setRecentOpen(false)}
            onClick={handleOpenProject}
          >
            Open Project
          </button>

          <div
            className={styles.submenuWrap}
            onMouseEnter={() => setRecentOpen(true)}
          >
            <button
              type="button"
              className={`${styles.menuItem} ${styles.menuItemSub}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={recentOpen}
              onClick={() => setRecentOpen(true)}
              disabled={filteredRecents.length === 0}
            >
              <span>Open Recent Project</span>
              <span className={styles.subCaret}>{'▸'}</span>
            </button>

            {recentOpen && filteredRecents.length > 0 && (
              <div className={styles.submenu} role="menu">
                {filteredRecents.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    className={styles.recentItem}
                    role="menuitem"
                    onClick={() => handleOpenRecent(p.path)}
                    title={p.path}
                  >
                    <div className={styles.recentName}>{p.name}</div>
                    <div className={styles.recentPath}>{p.path}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.divider} />

          <button
            type="button"
            className={styles.menuItem}
            role="menuitem"
            onMouseEnter={() => setRecentOpen(false)}
            onClick={handleExit}
          >
            Exit
          </button>
        </div>
      )}
    </div>
  )
}
