import { useEffect, useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/useSettingsStore'
import styles from './SettingsView.module.css'

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

interface AudioDevice {
  deviceId: string
  label: string
}

interface ServiceHealth {
  name: string
  url: string
  status: 'up' | 'down' | 'checking'
  latency?: number
}

const INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30, 60]

export function SettingsView(): JSX.Element {
  const { heartbeatEnabled, heartbeatIntervalMinutes, micDeviceId,
          imapHost, imapPort, imapUser, imapPassword, imapTLS, update } = useSettingsStore()
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [testState, setTestState] = useState<TestState>('idle')
  const [testError, setTestError] = useState('')
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

  const loadAudioDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()))
    } catch { /* permission denied — labels will be empty */ }
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioDevices(
      devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
    )
  }, [])

  const testImapConnection = useCallback(async () => {
    setTestState('testing')
    setTestError('')
    const result = await window.api.email.testConnection()
    if (result.ok) {
      setTestState('ok')
    } else {
      setTestState('fail')
      setTestError(result.error ?? 'Connection failed')
    }
  }, [])

  useEffect(() => {
    checkHealth()
    loadAudioDevices()
  }, [checkHealth, loadAudioDevices])

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

        {/* IMAP Email */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Email (IMAP)</div>

          <div className={styles.settingRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
            <div className={styles.settingLabel}>Server</div>
            <div className={styles.inputRow}>
              <input
                className={`${styles.input} ${styles.inputRowFlex}`}
                type="text"
                placeholder="imap.gmail.com"
                value={imapHost}
                onChange={(e) => { update({ imapHost: e.target.value }); setTestState('idle') }}
              />
              <input
                className={`${styles.input} ${styles.inputNarrow}`}
                type="number"
                placeholder="993"
                value={imapPort}
                onChange={(e) => { update({ imapPort: Number(e.target.value) }); setTestState('idle') }}
              />
            </div>
            <div className={styles.settingLabel}>Email Address</div>
            <input
              className={styles.input}
              type="text"
              placeholder="you@example.com"
              value={imapUser}
              onChange={(e) => { update({ imapUser: e.target.value }); setTestState('idle') }}
            />
            <div className={styles.settingLabel}>Password / App Password</div>
            <input
              className={styles.input}
              type="password"
              placeholder="••••••••"
              value={imapPassword}
              onChange={(e) => { update({ imapPassword: e.target.value }); setTestState('idle') }}
            />
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={imapTLS}
                onChange={(e) => update({ imapTLS: e.target.checked })}
              />
              Use TLS (recommended)
            </label>
            <div className={styles.inputRow}>
              <button
                className={styles.testBtn}
                onClick={testImapConnection}
                disabled={testState === 'testing' || !imapHost || !imapUser}
              >
                {testState === 'testing' ? 'Testing…' : 'Test Connection'}
              </button>
              {testState === 'ok' && <span className={styles.testOk}>Connected</span>}
              {testState === 'fail' && <span className={styles.testFail}>{testError}</span>}
            </div>
          </div>
        </section>

        {/* Voice Input */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Voice Input</div>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Microphone</div>
              <div className={styles.settingDesc}>
                Which microphone to use for voice-to-text in the chat input.
              </div>
            </div>
            <select
              className={styles.select}
              value={micDeviceId}
              onChange={(e) => update({ micDeviceId: e.target.value })}
            >
              <option value="">System default</option>
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </div>
        </section>

      </div>
    </div>
  )
}
