import { useEffect, useState } from 'react'
import { useScreenWebcamShare } from '../../hooks/useScreenWebcamShare'
import styles from './ScreenSourcePickerModal.module.css'

interface ScreenSource {
  id: string
  name: string
  displayId: string
  thumbnailDataURL: string
  appIconDataURL: string | null
}

type Tab = 'screen' | 'window'

export function ScreenSourcePickerModal(): JSX.Element | null {
  const open = useScreenWebcamShare((s) => s.pickerOpen)
  const resolve = useScreenWebcamShare((s) => s.resolvePicker)
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [tab, setTab] = useState<Tab>('screen')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api.screen.getSources()
      .then((list) => {
        if (!cancelled) setSources(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not list sources')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') resolve(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, resolve])

  if (!open) return null

  const filtered = sources.filter((s) =>
    tab === 'screen' ? s.id.startsWith('screen:') : s.id.startsWith('window:')
  )

  return (
    <div className={styles.overlay} onClick={() => resolve(null)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={() => resolve(null)} aria-label="Close">✕</button>
        <div className={styles.title}>Share what you'd like the agent to see</div>
        <div className={styles.tabs}>
          <button
            className={tab === 'screen' ? styles.tabActive : styles.tab}
            onClick={() => setTab('screen')}
          >
            Screens
          </button>
          <button
            className={tab === 'window' ? styles.tabActive : styles.tab}
            onClick={() => setTab('window')}
          >
            Windows
          </button>
        </div>

        {loading && <div className={styles.status}>Loading sources…</div>}
        {error && <div className={styles.error}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className={styles.status}>No {tab === 'screen' ? 'screens' : 'windows'} available.</div>
        )}

        <div className={styles.grid}>
          {filtered.map((s) => (
            <button
              key={s.id}
              className={styles.tile}
              onClick={() => resolve(s.id)}
              title={s.name}
            >
              <img src={s.thumbnailDataURL} alt={s.name} className={styles.thumb} />
              <div className={styles.tileLabel}>
                {s.appIconDataURL && (
                  <img src={s.appIconDataURL} alt="" className={styles.appIcon} />
                )}
                <span className={styles.tileName}>{s.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
