import { useEffect, useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/useSettingsStore'
import styles from './SettingsView.module.css'

interface ServiceHealth {
  name: string
  url: string
  status: 'up' | 'down' | 'checking'
  latency?: number
}

const INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30, 60]

export function SettingsView(): JSX.Element {
  const { heartbeatEnabled, heartbeatIntervalMinutes, update } = useSettingsStore()
  const [services, setServices] = useState<ServiceHealth[]>([
    { name: 'RoseLibrary', url: 'http://127.0.0.1:8000', status: 'checking' },
    { name: 'RoseModel',   url: 'http://127.0.0.1:8010', status: 'checking' },
    { name: 'RoseTrainer', url: 'http://127.0.0.1:8030', status: 'checking' }
  ])

  const checkHealth = useCallback(async () => {
    setServices((prev) => prev.map((s) => ({ ...s, status: 'checking' as const })))
    const results = await window.api.checkServicesHealth()
    setServices(results.map((r) => ({ ...r, status: r.status as 'up' | 'down' | 'checking' })))
  }, [])

  useEffect(() => {
    checkHealth()
  }, [checkHealth])

  return (
    <div className={styles.container}>
      <div className={styles.page}>

        {/* Service Health */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Service Health</div>
            <button className={styles.refreshBtn} onClick={checkHealth}>Refresh</button>
          </div>
          <div className={styles.serviceList}>
            {services.map((svc) => (
              <div key={svc.name} className={styles.serviceRow}>
                <span
                  className={`${styles.dot} ${
                    svc.status === 'up' ? styles.dotUp :
                    svc.status === 'down' ? styles.dotDown :
                    styles.dotChecking
                  }`}
                />
                <span className={styles.serviceName}>{svc.name}</span>
                <span className={styles.serviceUrl}>{svc.url}</span>
                <span className={styles.serviceStatus}>
                  {svc.status === 'checking' && 'Checking…'}
                  {svc.status === 'up' && `Online${svc.latency != null ? ` · ${svc.latency}ms` : ''}`}
                  {svc.status === 'down' && 'Offline'}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Heartbeat Settings */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Heartbeat</div>

          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Enable Heartbeat</div>
              <div className={styles.settingDesc}>
                Automatically process notes and execute due tasks in the background.
              </div>
            </div>
            <button
              className={`${styles.toggle} ${heartbeatEnabled ? styles.toggleOn : styles.toggleOff}`}
              onClick={() => update({ heartbeatEnabled: !heartbeatEnabled })}
              role="switch"
              aria-checked={heartbeatEnabled}
            >
              <span className={styles.toggleThumb} />
            </button>
          </div>

          <div className={`${styles.settingRow} ${!heartbeatEnabled ? styles.disabled : ''}`}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Run Every</div>
              <div className={styles.settingDesc}>
                How often the heartbeat checks for notes and due tasks.
              </div>
            </div>
            <div className={styles.intervalGroup}>
              {INTERVAL_OPTIONS.map((min) => (
                <button
                  key={min}
                  className={`${styles.intervalBtn} ${heartbeatIntervalMinutes === min ? styles.intervalActive : ''}`}
                  onClick={() => update({ heartbeatIntervalMinutes: min })}
                  disabled={!heartbeatEnabled}
                >
                  {min < 60 ? `${min}m` : '1h'}
                </button>
              ))}
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
