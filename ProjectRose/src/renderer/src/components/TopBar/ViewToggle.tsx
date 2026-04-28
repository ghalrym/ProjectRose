import { useViewStore } from '../../stores/useViewStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import clsx from 'clsx'
import styles from './TopBar.module.css'

export function ViewToggle(): JSX.Element {
  const activeView = useViewStore((s) => s.activeView)
  const setActiveView = useViewStore((s) => s.setActiveView)
  const navItems = useSettingsStore((s) => s.navItems)

  const visibleItems = navItems.filter((item) => item.visible && item.viewId !== 'settings')
  const settingsItem = navItems.find((item) => item.viewId === 'settings')

  return (
    <div className={styles.toggleGroup}>
      {visibleItems.map((item, index) => {
        const isApps = item.viewId === 'apps'
        return (
          <button
            key={item.viewId}
            className={clsx(styles.toggleBtn, activeView === item.viewId && styles.toggleActive)}
            onClick={() => setActiveView(item.viewId)}
            title={isApps ? 'App board' : undefined}
            aria-label={isApps ? 'App board' : undefined}
          >
            <span className={styles.specimenNum}>№{String(index + 1).padStart(2, '0')}</span>
            {isApps && (
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <rect x="1.5"  y="1.5"  width="5" height="5" />
                <rect x="9.5"  y="1.5"  width="5" height="5" />
                <rect x="1.5"  y="9.5"  width="5" height="5" />
                <rect x="9.5"  y="9.5"  width="5" height="5" />
              </svg>
            )}
            {item.label.toUpperCase()}
          </button>
        )
      })}
      {settingsItem && (
        <button
          key="settings"
          className={clsx(styles.toggleBtn, activeView === 'settings' && styles.toggleActive)}
          onClick={() => setActiveView('settings')}
        >
          <span className={styles.specimenNum}>№{String(visibleItems.length + 1).padStart(2, '0')}</span>
          SETTINGS
        </button>
      )}
    </div>
  )
}
