import { useEffect, useState } from 'react'
import { RELEASES, type ReleaseEntry } from '@shared/releases'
import styles from './SettingsView.module.css'
import upd from './UpdatesTab.module.css'

type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate'; version: string }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

function SectionHeader({ n, title, sub, right }: {
  n: string; title: string; sub?: string; right?: React.ReactNode
}): JSX.Element {
  return (
    <div className={styles.sectionHeaderRow}>
      <div>
        <div className={styles.plateLabel}>PLATE {n}</div>
        <div className={styles.plateTitle}>{title}</div>
        {sub && <div className={styles.plateSub}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

function statusLabel(status: UpdateStatus): string {
  switch (status.kind) {
    case 'idle':         return 'Click "Check for Updates" to look for a new build.'
    case 'checking':     return 'Checking for updates…'
    case 'upToDate':     return `You're on the latest build (v${status.version}).`
    case 'available':    return `Update available — v${status.version}`
    case 'downloading':  return `Downloading v${status.version}… ${Math.round(status.percent)}%`
    case 'downloaded':   return `v${status.version} downloaded — restart to install.`
    case 'error':        return 'Update check failed.'
  }
}

function ReleaseRow({ entry, isCurrent }: { entry: ReleaseEntry; isCurrent: boolean }): JSX.Element {
  return (
    <div className={upd.releaseRow}>
      <div className={upd.releaseHeader}>
        <span className={upd.releaseVersion}>v{entry.version}</span>
        {isCurrent && <span className={`${upd.badge} ${upd.badgeCurrent}`}>Current</span>}
        {entry.date && <span className={upd.releaseDate}>{entry.date}</span>}
      </div>
      <div className={upd.releaseTitle}>{entry.title}</div>
      <ul className={upd.releaseBullets}>
        {entry.highlights.map((h, i) => <li key={i}>{h}</li>)}
      </ul>
    </div>
  )
}

export function UpdatesTab(): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' })

  useEffect(() => {
    const offAvailable = window.api.updater.onAvailable((info) => {
      setStatus({ kind: 'available', version: info.version })
    })
    const offNotAvailable = window.api.updater.onNotAvailable((info) => {
      setStatus({ kind: 'upToDate', version: info.version })
    })
    const offProgress = window.api.updater.onProgress((info) => {
      setStatus((prev) => {
        const version = prev.kind === 'available' || prev.kind === 'downloading' || prev.kind === 'downloaded'
          ? prev.version
          : ''
        return { kind: 'downloading', version, percent: info.percent }
      })
    })
    const offDownloaded = window.api.updater.onDownloaded((info) => {
      setStatus({ kind: 'downloaded', version: info.version })
    })
    const offError = window.api.updater.onError((info) => {
      setStatus({ kind: 'error', message: info.message })
    })
    return () => {
      offAvailable()
      offNotAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  const handleCheck = async (): Promise<void> => {
    setStatus({ kind: 'checking' })
    await window.api.updater.checkForUpdates()
  }

  const handleDownload = async (): Promise<void> => {
    if (status.kind !== 'available') return
    await window.api.updater.downloadUpdate()
  }

  const handleInstall = async (): Promise<void> => {
    await window.api.updater.installUpdate()
  }

  const handleSkip = async (version: string): Promise<void> => {
    await window.api.updater.skipVersion(version)
    setStatus({ kind: 'idle' })
  }

  const checkDisabled = status.kind === 'checking' || status.kind === 'downloading'
  const showSkip = status.kind === 'available' || status.kind === 'downloaded'

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.pageHeaderMeta}>PROJECTROSE · SETTINGS · UPDATES</div>
          <div className={styles.pageTitle}>
            <span className={styles.pageTitleAccent}>Updates</span>
            {' · '}
            <span className={styles.pageTitleSub}>release ledger</span>
          </div>
        </div>
        <div className={styles.pageHeaderRight}>
          <div>PLATES · I — II</div>
          <div className={styles.colophonAccent}>Rosa renovata</div>
        </div>
      </div>
      <hr className={styles.pageHeaderDivider} />

      <div className={styles.plateSection}>
        <SectionHeader n="I" title="Current build" sub="Auto-checks every hour in packaged builds." />
        <div className={styles.panelBlock}>
          <div className={styles.panelHeader}><span>BUILD · STATUS</span></div>
          <div className={upd.statusRow}>
            <div className={upd.versionMono}>v{__APP_VERSION__}</div>
            <div className={`${upd.statusText} ${status.kind === 'idle' ? upd.statusTextIdle : ''}`}>
              {statusLabel(status)}
            </div>
            <div className={upd.statusBtns}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleCheck}
                disabled={checkDisabled}
              >
                CHECK FOR UPDATES
              </button>
              {status.kind === 'available' && (
                <button type="button" className={styles.ghostBtn} onClick={handleDownload}>
                  DOWNLOAD v{status.version}
                </button>
              )}
              {status.kind === 'downloaded' && (
                <button type="button" className={styles.primaryBtn} onClick={handleInstall}>
                  RESTART & INSTALL
                </button>
              )}
              {showSkip && (
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => handleSkip(status.version)}
                >
                  SKIP
                </button>
              )}
            </div>
          </div>
          {status.kind === 'downloading' && (
            <div className={upd.progressBar}>
              <div className={upd.progressBarFill} style={{ width: `${status.percent}%` }} />
            </div>
          )}
          {status.kind === 'error' && <div className={upd.errorRow}>{status.message}</div>}
          {import.meta.env.DEV && (
            <div className={upd.devNote}>auto-updater is disabled in development</div>
          )}
        </div>
      </div>

      <div className={styles.plateSection}>
        <SectionHeader
          n="II"
          title="Release ledger"
          sub="Curated patch notes from each tagged build."
          right={
            <div className={styles.sectionMeta}>
              <span className={styles.sectionMetaCount}>{RELEASES.length} ENTRIES</span>
            </div>
          }
        />
        <div className={styles.panelBlock}>
          <div className={styles.panelHeader}>
            <span>RELEASES</span>
            <span className={styles.panelHeaderCount}>newest first</span>
          </div>
          {RELEASES.map((r) => (
            <ReleaseRow
              key={r.tag ?? r.version}
              entry={r}
              isCurrent={r.version === __APP_VERSION__}
            />
          ))}
        </div>
      </div>

      <div className={styles.colophon}>
        <span>COLOPHON · release notes bundled at build time</span>
        <span className={styles.colophonAccent}>Rosa renovata</span>
      </div>
    </>
  )
}
