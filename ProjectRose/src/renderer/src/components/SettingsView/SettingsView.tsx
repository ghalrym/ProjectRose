import { useEffect, useState, useCallback } from 'react'
import { ExtensionsTab } from './ExtensionsTab'
import { PromptsTab } from './PromptsTab'
import { UpdatesTab } from './UpdatesTab'
import { MemoryTab } from './MemoryTab'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useViewStore } from '../../stores/useViewStore'
import { useWhisperPreloadStore } from '../../stores/useWhisperPreloadStore'
import { subscribeToExtensionsChange } from '../../extensions/registry'
import type { ToolMeta } from '@shared/types'
import type { GoogleSyncStatus } from '@shared/memory'
import styles from './SettingsView.module.css'
import { WhisperModelInstallModal, type WhisperModelOption } from './WhisperModelInstallModal'
import whisperModalStyles from './WhisperModelInstallModal.module.css'

const WHISPER_MODEL_OPTIONS: WhisperModelOption[] = [
  { id: 'Xenova/whisper-tiny.en',   label: 'Tiny (English) — fastest',            size: '40 MB'  },
  { id: 'Xenova/whisper-base.en',   label: 'Base (English)',                      size: '150 MB' },
  { id: 'Xenova/whisper-small.en',  label: 'Small (English) — recommended',       size: '500 MB' },
  { id: 'Xenova/whisper-medium.en', label: 'Medium (English) — best quality',     size: '1.5 GB' }
]

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type ProviderStatus = 'connected' | 'unverified' | 'missing' | 'error'

interface AudioDevice {
  deviceId: string
  label: string
}

// ─────────────────────────────────────────────────────────────
// Provider configuration
// ─────────────────────────────────────────────────────────────

interface FieldDef {
  key: string
  label: string
  placeholder: string
  secret: boolean
  hint?: string
}

const PROVIDER_FIELD_DEFS: Record<string, FieldDef[]> = {
  ollama: [
    { key: 'baseUrl', label: 'BASE URL', placeholder: 'http://localhost:11434', secret: false, hint: 'no key required · local' },
  ],
}

interface ProviderMeta {
  kind: string
  spec: string
  name: string
  latin: string
}

const PROVIDERS: ProviderMeta[] = [
  { kind: 'projectrose', spec: '00', name: 'ProjectRose',       latin: 'Rosa managed'    },
  { kind: 'ollama',      spec: '01', name: 'Ollama',            latin: 'Rosa localis'    },
]

// ─────────────────────────────────────────────────────────────
// Pure components
// ─────────────────────────────────────────────────────────────

function ProviderGlyph({ kind, size = 28 }: { kind: string; size?: number }): JSX.Element | null {
  const c = 'var(--color-accent)'
  switch (kind) {
    case 'projectrose':
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke={c} strokeWidth="1.6">
          <circle cx="16" cy="16" r="6" fill={c} stroke="none" />
          <path d="M16 4 C20 8 20 12 16 16 C12 12 12 8 16 4 Z" opacity="0.7" />
          <path d="M28 16 C24 20 20 20 16 16 C20 12 24 12 28 16 Z" opacity="0.7" />
          <path d="M16 28 C12 24 12 20 16 16 C20 20 20 24 16 28 Z" opacity="0.7" />
          <path d="M4 16 C8 12 12 12 16 16 C12 20 8 20 4 16 Z" opacity="0.7" />
        </svg>
      )
    case 'ollama':
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke={c} strokeWidth="1.6">
          <ellipse cx="16" cy="18" rx="9" ry="8"/>
          <ellipse cx="11" cy="10" rx="3" ry="4" fill={c} stroke="none"/>
          <ellipse cx="21" cy="10" rx="3" ry="4" fill={c} stroke="none"/>
          <circle cx="13" cy="17" r="1" fill={c} stroke="none"/>
          <circle cx="19" cy="17" r="1" fill={c} stroke="none"/>
        </svg>
      )
    case 'google':
      // Stylised "G" mark — single-colour to match the accent palette;
      // intentionally not the full multicolour Google logo (which carries
      // trademark/brand-guideline constraints).
      return (
        <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke={c} strokeWidth="1.8">
          <path d="M22 12 A8 8 0 1 0 24 18 L16 18" strokeLinecap="round"/>
        </svg>
      )
    default:
      return null
  }
}

function StatusBadge({ state }: { state: ProviderStatus }): JSX.Element {
  const map: Record<ProviderStatus, { color: string; cssVar: string; label: string; dot: boolean; pulse: boolean }> = {
    connected:  { color: 'var(--color-saved)',   cssVar: 'var(--color-saved)',  label: 'CONNECTED',  dot: true,  pulse: true  },
    unverified: { color: 'var(--color-unsaved)', cssVar: 'var(--color-unsaved)', label: 'UNVERIFIED', dot: true,  pulse: false },
    missing:    { color: 'var(--color-text-muted)', cssVar: 'var(--color-text-muted)', label: 'NOT SET', dot: false, pulse: false },
    error:      { color: 'var(--color-error)',   cssVar: 'var(--color-error)',  label: 'ERROR',      dot: true,  pulse: false },
  }
  const m = map[state]
  return (
    <span className={styles.statusBadge} style={{ color: m.color }}>
      {m.dot ? (
        <span
          className={`${styles.statusDot} ${m.pulse ? styles.okPulse : ''}`}
          style={{ background: m.color }}
        />
      ) : (
        <span className={styles.statusDotHollow} style={{ borderColor: m.color }} />
      )}
      {m.label}
    </span>
  )
}

function HToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={`${styles.hToggle} ${on ? styles.hToggleOn : styles.hToggleOff}`}
    >
      <span className={styles.hToggleThumb} />
    </button>
  )
}

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

function HSettingRow({ label, desc, children }: {
  label: string; desc?: string; children: React.ReactNode
}): JSX.Element {
  return (
    <div className={styles.hSettingRow}>
      <div style={{ flex: 1 }}>
        <div className={styles.hSettingLabel}>{label}</div>
        {desc && <div className={styles.hSettingDesc}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function FieldRow({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}): JSX.Element {
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldRowHeader}>
        <span className={styles.fieldLabel}>{label}</span>
        {hint && <span className={styles.fieldHint}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function KeyInput({ value, placeholder, onChange, type = 'password' }: {
  value: string
  placeholder: string
  onChange: (v: string) => void
  type?: 'password' | 'text'
}): JSX.Element {
  const [show, setShow] = useState(false)
  const [focused, setFocused] = useState(false)

  function maskKey(s: string): string {
    if (s.length <= 8) return '•'.repeat(s.length)
    return s.slice(0, 4) + '•'.repeat(Math.min(s.length - 8, 14)) + s.slice(-4)
  }

  const masked = !show && type === 'password' && !!value && !focused

  return (
    <div className={`${styles.keyInputWrap} ${focused ? styles.keyInputWrapFocused : ''}`}>
      <input
        type={show || type === 'text' ? 'text' : 'password'}
        value={masked ? maskKey(value) : value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={styles.keyInputField}
        style={{ letterSpacing: masked ? 1 : 0.2 }}
      />
      {value && type === 'password' && (
        <button type="button" onClick={() => setShow((s) => !s)} className={styles.keyInputToggle}>
          {show ? 'HIDE' : 'SHOW'}
        </button>
      )}
    </div>
  )
}

interface UsageInfo {
  plan: string
  plan_budget_usd: number
  month_cost_usd: number
  month_remaining_usd: number
  pct: number
  over_budget: boolean
}

function UsageBar({ usage, loading, error, onRefresh }: {
  usage: UsageInfo | null
  loading: boolean
  error: string
  onRefresh: () => void
}): JSX.Element {
  const fillPct = usage ? Math.max(0, Math.min(100, usage.pct)) : 0
  const fillColor = usage?.over_budget
    ? 'var(--color-error)'
    : fillPct >= 80
      ? 'var(--color-unsaved)'
      : 'var(--color-saved)'

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 9, letterSpacing: 1.4, color: 'var(--color-text-muted)', fontWeight: 500 }}>
          MONTHLY USAGE{usage ? ` · ${usage.plan.toUpperCase()}` : ''}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--color-text-muted)',
            cursor: loading ? 'default' : 'pointer',
            fontSize: 9,
            letterSpacing: 1.4,
            fontFamily: 'inherit',
            fontWeight: 500,
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? 'LOADING…' : '↻ REFRESH'}
        </button>
      </div>
      <div
        style={{
          height: 6,
          background: 'var(--color-bg-secondary)',
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${fillPct}%`,
            background: fillColor,
            transition: 'width 240ms ease',
          }}
        />
      </div>
      {usage ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)' }}>
          <span style={{ color: usage.over_budget ? 'var(--color-error)' : 'var(--color-text-primary)' }}>
            ${usage.month_cost_usd.toFixed(2)} of ${usage.plan_budget_usd.toFixed(2)}
          </span>
          <span>
            {usage.over_budget
              ? 'over budget'
              : `${usage.pct.toFixed(1)}% · $${usage.month_remaining_usd.toFixed(2)} left`}
          </span>
        </div>
      ) : error ? (
        <div style={{ fontSize: 11, color: 'var(--color-error)' }}>{error}</div>
      ) : loading ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Loading usage…</div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function SettingsView(): JSX.Element {
  const {
    micDeviceId, userName, agentName, activeListeningDraftSeconds, whisperModel,
    agentStartsExpanded,
    ollamaBaseUrl, ollamaModelName,
    update,
  } = useSettingsStore()

  const rootPath = useProjectStore((s) => s.rootPath)

  // ── tool state ──
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [disabledTools, setDisabledTools] = useState<string[]>([])

  // ── nav ──
  const [activePage, setActivePage] = useState('general')

  // ── audio ──
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])

  // ── model fetch state ──
  const [ollamaModels, setOllamaModels] = useState<Record<string, string[]>>({})
  const [ollamaFetching, setOllamaFetching] = useState<Record<string, boolean>>({})

  // ── provider card state ──
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [testedProviders, setTestedProviders] = useState<Record<string, 'connected' | 'error'>>({})
  const [providerTesting, setProviderTesting] = useState<Record<string, boolean>>({})

  // ── projectrose account state ──
  const [prAccount, setPrAccount] = useState<{ loggedIn: boolean; email: string; name: string }>({ loggedIn: false, email: '', name: '' })
  const [prMode, setPrMode] = useState<'idle' | 'pending'>('idle')
  const [prPairingUrl, setPrPairingUrl] = useState('')
  const [prError, setPrError] = useState('')
  const [prUsage, setPrUsage] = useState<{
    plan: string
    plan_budget_usd: number
    month_cost_usd: number
    month_remaining_usd: number
    pct: number
    over_budget: boolean
  } | null>(null)
  const [prUsageLoading, setPrUsageLoading] = useState(false)
  const [prUsageError, setPrUsageError] = useState('')

  const loadProjectRoseUsage = useCallback(async () => {
    setPrUsageLoading(true)
    setPrUsageError('')
    try {
      const result = await window.api.auth.getUsage()
      if (result.ok) {
        setPrUsage(result.usage)
      } else {
        setPrUsage(null)
        setPrUsageError(result.error)
      }
    } finally {
      setPrUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.auth.getStatus().then((s) => { if (!cancelled) setPrAccount({ loggedIn: s.loggedIn, email: s.email, name: s.name }) })
    const offChanged = window.api.auth.onChanged((d) => {
      setPrAccount({ loggedIn: d.loggedIn, email: d.email, name: d.name })
      setPrMode('idle')
      setPrPairingUrl('')
      setPrError('')
    })
    const offPending = window.api.auth.onPairingPending((d) => {
      setPrPairingUrl(d.url)
      setPrMode('pending')
      setPrError('')
    })
    return () => { cancelled = true; offChanged(); offPending() }
  }, [])

  useEffect(() => {
    if (expandedProvider !== 'projectrose' || !prAccount.loggedIn) return
    loadProjectRoseUsage()
  }, [expandedProvider, prAccount.loggedIn, loadProjectRoseUsage])

  useEffect(() => {
    if (!prAccount.loggedIn) {
      setPrUsage(null)
      setPrUsageError('')
    }
  }, [prAccount.loggedIn])

  async function projectroseSignIn(): Promise<void> {
    setPrError('')
    setPrMode('pending')
    try {
      await window.api.auth.login()
    } catch (e) {
      setPrError(e instanceof Error ? e.message : 'Sign-in failed')
      setPrMode('idle')
      setPrPairingUrl('')
    }
  }

  async function projectroseCancel(): Promise<void> {
    try { await window.api.auth.cancel() } catch { /* ignore */ }
    setPrMode('idle')
    setPrPairingUrl('')
  }

  async function projectroseSignOut(): Promise<void> {
    try { await window.api.auth.logout() } catch { /* ignore */ }
  }

  // ── google account state ──
  // Lives on the Providers tab so the auth is a shared, app-wide concern.
  // The rose-contacts built-in extension consumes the status but doesn't
  // own sign-in.
  const [googleStatus, setGoogleStatus] = useState<GoogleSyncStatus | null>(null)
  const [googleBusy, setGoogleBusy] = useState<string | null>(null)
  const [googleError, setGoogleError] = useState<string | null>(null)
  // Local-only draft for the BYO OAuth pair. The clientSecret is never read
  // back from the main process (safeStorage is one-way for our purposes), so
  // the field starts blank on every load — the user re-enters it only when
  // changing or re-pasting credentials.
  const [googleClientIdDraft, setGoogleClientIdDraft] = useState('')
  const [googleClientSecretDraft, setGoogleClientSecretDraft] = useState('')
  const [googleHelpOpen, setGoogleHelpOpen] = useState(false)

  const refreshGoogleStatus = useCallback(async () => {
    const s = await window.api.memory.googleGetStatus()
    setGoogleStatus(s)
  }, [])

  useEffect(() => { void refreshGoogleStatus() }, [refreshGoogleStatus])

  async function googleSignIn(): Promise<void> {
    setGoogleBusy('Opening Google sign-in…')
    setGoogleError(null)
    try {
      const s = await window.api.memory.googleSignIn()
      setGoogleStatus(s)
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally { setGoogleBusy(null) }
  }

  async function googleSignOut(): Promise<void> {
    setGoogleBusy('Signing out…')
    try {
      const s = await window.api.memory.googleSignOut()
      setGoogleStatus(s)
    } finally { setGoogleBusy(null) }
  }

  async function googleSaveCredentials(): Promise<void> {
    const clientId = googleClientIdDraft.trim()
    const clientSecret = googleClientSecretDraft.trim()
    if (!clientId || !clientSecret) {
      setGoogleError('Both client ID and client secret are required.')
      return
    }
    setGoogleBusy('Saving credentials…')
    setGoogleError(null)
    try {
      const s = await window.api.memory.googleSaveCredentials({ clientId, clientSecret })
      setGoogleStatus(s)
      setGoogleClientIdDraft('')
      setGoogleClientSecretDraft('')
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : 'Could not save credentials')
    } finally { setGoogleBusy(null) }
  }

  async function googleClearCredentials(): Promise<void> {
    setGoogleBusy('Clearing credentials…')
    setGoogleError(null)
    try {
      const s = await window.api.memory.googleClearCredentials()
      setGoogleStatus(s)
      setGoogleClientIdDraft('')
      setGoogleClientSecretDraft('')
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : 'Could not clear credentials')
    } finally { setGoogleBusy(null) }
  }

  // ── whisper model install modal ──
  const preloadModelId = useWhisperPreloadStore((s) => s.modelId)
  const preloadStatus = useWhisperPreloadStore((s) => s.status)
  const preloadPercent = useWhisperPreloadStore((s) => s.percent)
  const initPreload = useWhisperPreloadStore((s) => s.init)
  const startPreload = useWhisperPreloadStore((s) => s.start)
  const clearPreload = useWhisperPreloadStore((s) => s.clear)
  const [pendingWhisperModel, setPendingWhisperModel] = useState<WhisperModelOption | null>(null)
  const [installModalOpen, setInstallModalOpen] = useState(false)

  useEffect(() => { void initPreload() }, [initPreload])

  const activeWhisperOption = WHISPER_MODEL_OPTIONS.find((o) => o.id === preloadModelId) ?? null
  const installInFlight =
    activeWhisperOption !== null &&
    (preloadStatus === 'preparing' || preloadStatus === 'downloading')

  // Commits a finished install to the saved setting. Handles the case where
  // the user backgrounded the modal (or navigated away) before completion.
  useEffect(() => {
    if (preloadStatus === 'ready' && preloadModelId && preloadModelId !== whisperModel) {
      update({ whisperModel: preloadModelId })
      void clearPreload()
      setInstallModalOpen(false)
      setPendingWhisperModel(null)
    }
  }, [preloadStatus, preloadModelId, whisperModel, update, clearPreload])

  function handleWhisperModelChange(newId: string): void {
    if (newId === whisperModel) return
    const target = WHISPER_MODEL_OPTIONS.find((o) => o.id === newId)
    if (!target) return
    setPendingWhisperModel(target)
    setInstallModalOpen(true)
  }

  async function handleWhisperInstallConfirm(): Promise<void> {
    if (!pendingWhisperModel) return
    await startPreload(pendingWhisperModel.id)
    // start() resolves once the pipeline is loaded; the auto-commit effect
    // above promotes status==='ready' into a saved setting + cleared store.
  }

  function handleWhisperInstallCancel(): void {
    setInstallModalOpen(false)
    setPendingWhisperModel(null)
    if (preloadStatus === 'idle' || preloadStatus === 'error') {
      void clearPreload()
    }
  }

  function handleWhisperInstallHide(): void {
    setInstallModalOpen(false)
    // pendingWhisperModel stays so the dropdown still shows the in-flight pick.
  }

  function handleWhisperInstallComplete(): void {
    const target = pendingWhisperModel ?? activeWhisperOption
    if (target) update({ whisperModel: target.id })
    setInstallModalOpen(false)
    setPendingWhisperModel(null)
    void clearPreload()
  }

  function reopenInstallModal(): void {
    const target = pendingWhisperModel ?? activeWhisperOption
    if (target) {
      setPendingWhisperModel(target)
      setInstallModalOpen(true)
    }
  }

  // ── skills ──
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])

  const reloadSkills = useCallback(() => {
    if (!rootPath) return
    window.api.skills.list(rootPath).then(setSkills).catch(() => {})
  }, [rootPath])

  useEffect(() => { reloadSkills() }, [reloadSkills])

  const uploadSkill = useCallback(async () => {
    if (!rootPath) return
    const result = await window.api.skills.upload(rootPath)
    if (result.ok && result.skills) setSkills(result.skills)
  }, [rootPath])

  const deleteSkill = useCallback(async (name: string) => {
    if (!rootPath) return
    await window.api.skills.delete(rootPath, name)
    setSkills((prev) => prev.filter((s) => s.name !== name))
  }, [rootPath])

  // ── tools ──
  const reloadTools = useCallback(() => {
    if (!rootPath) return
    Promise.all([
      window.api.tools.list(rootPath),
      window.api.project.getSettings(rootPath),
    ]).then(([tools, settings]) => {
      setAvailableTools(tools)
      setDisabledTools(settings.disabledTools)
    }).catch(() => {})
  }, [rootPath])

  useEffect(() => { reloadTools() }, [reloadTools])
  useEffect(() => subscribeToExtensionsChange(reloadTools), [reloadTools])

  const toggleTool = useCallback(async (name: string) => {
    if (!rootPath) return
    const updated = disabledTools.includes(name)
      ? disabledTools.filter((n) => n !== name)
      : [...disabledTools, name]
    setDisabledTools(updated)
    await window.api.project.setSettings(rootPath, { disabledTools: updated })
  }, [rootPath, disabledTools])

  // ── audio ──
  const loadAudioDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()))
    } catch { /* permission denied */ }
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioDevices(
      devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
    )
  }, [])

  useEffect(() => { loadAudioDevices() }, [loadAudioDevices])

  // ── model fetch helpers ──
  const fetchOllamaModels = useCallback(async (key: string, baseUrl: string) => {
    const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '')
    setOllamaFetching((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await fetch(`${url}/api/tags`)
      if (!res.ok) throw new Error('failed')
      const data = await res.json() as { models: { name: string }[] }
      setOllamaModels((prev) => ({ ...prev, [key]: data.models.map((m) => m.name) }))
    } catch {
      setOllamaModels((prev) => ({ ...prev, [key]: [] }))
    } finally {
      setOllamaFetching((prev) => { const n = { ...prev }; delete n[key]; return n })
    }
  }, [])

  useEffect(() => {
    if (activePage !== 'providers') return
    if (ollamaBaseUrl && !('__ollama_provider__' in ollamaModels)) {
      fetchOllamaModels('__ollama_provider__', ollamaBaseUrl)
    }
  }, [activePage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────
  // Provider helpers
  // ─────────────────────────────────────────────────────────

  function getProviderFields(kind: string): Record<string, string> {
    switch (kind) {
      case 'ollama':      return { baseUrl: ollamaBaseUrl }
      case 'projectrose': return {}
      default:            return {}
    }
  }

  function getProviderStatus(kind: string): ProviderStatus {
    if (kind === 'projectrose') return prAccount.loggedIn ? 'connected' : 'missing'
    if (testedProviders[kind] === 'connected') return 'connected'
    if (testedProviders[kind] === 'error') return 'error'
    const fields = getProviderFields(kind)
    const hasContent = Object.values(fields).some((v) => v && v !== '')
    return hasContent ? 'unverified' : 'missing'
  }

  function handleProviderFieldChange(kind: string, _key: string, value: string): void {
    setTestedProviders((prev) => { const n = { ...prev }; delete n[kind]; return n })
    if (kind === 'ollama') update({ ollamaBaseUrl: value })
  }

  function clearProvider(kind: string): void {
    setTestedProviders((prev) => { const n = { ...prev }; delete n[kind]; return n })
    if (kind === 'ollama') update({ ollamaBaseUrl: '' })
  }

  async function verifyProvider(kind: string): Promise<void> {
    setProviderTesting((prev) => ({ ...prev, [kind]: true }))
    try {
      let ok = false
      if (kind === 'ollama') {
        const url = (ollamaBaseUrl || 'http://localhost:11434').replace(/\/$/, '')
        const res = await fetch(`${url}/api/tags`)
        ok = res.ok
        if (ok) fetchOllamaModels('__ollama_provider__', ollamaBaseUrl)
      }
      setTestedProviders((prev) => ({ ...prev, [kind]: ok ? 'connected' : 'error' }))
    } catch {
      setTestedProviders((prev) => ({ ...prev, [kind]: 'error' }))
    } finally {
      setProviderTesting((prev) => { const n = { ...prev }; delete n[kind]; return n })
    }
  }

  // ─────────────────────────────────────────────────────────
  // Sidebar items
  // ─────────────────────────────────────────────────────────

  const topLevelItems = [
    { id: 'general',    label: 'General',    n: '01' },
    { id: 'providers',  label: 'Providers',  n: '02' },
    { id: 'tools',      label: 'Tools',      n: '03' },
    { id: 'skills',     label: 'Skills',     n: '04' },
    { id: 'prompts',    label: 'Prompts',    n: '05' },
    { id: 'memory',     label: 'Memory',     n: '06' },
    { id: 'extensions', label: 'Extensions', n: '07' },
    { id: 'updates',    label: 'Updates',    n: '08' },
  ]

  const allPageIds = topLevelItems.map((i) => i.id)

  useEffect(() => {
    if (!allPageIds.includes(activePage)) {
      setActivePage('general')
    }
  }, [allPageIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const settingsTarget = useViewStore((s) => s.settingsTarget)
  const setSettingsTarget = useViewStore((s) => s.setSettingsTarget)
  useEffect(() => {
    if (settingsTarget && allPageIds.includes(settingsTarget)) {
      setActivePage(settingsTarget)
      setSettingsTarget(null)
    }
  }, [settingsTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────
  // Render: General
  // ─────────────────────────────────────────────────────────

  function renderGeneral(): JSX.Element {
    return (
      <>
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Names</div>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Your Name</div>
              <div className={styles.settingDesc}>Used to identify your voice in the live transcript.</div>
            </div>
            <input
              className={styles.input}
              type="text"
              value={userName}
              placeholder="e.g. Andrew"
              onChange={(e) => update({ userName: e.target.value })}
            />
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Agent Name</div>
              <div className={styles.settingDesc}>Wake word — say this name to start drafting a message.</div>
            </div>
            <input
              className={styles.input}
              type="text"
              value={agentName}
              placeholder="e.g. Rose"
              onChange={(e) => update({ agentName: e.target.value })}
            />
          </div>
        </section>

        <section className={styles.section} style={{ paddingTop: 16 }}>
          <div className={styles.sectionTitle}>Microphone and Speaker</div>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Microphone</div>
              <div className={styles.settingDesc}>Which microphone to use for voice-to-text.</div>
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
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Auto-send delay</div>
              <div className={styles.settingDesc}>
                Seconds of silence after the wake word before the draft is sent. Raise this if you tend to pause mid-sentence; lower it for snappier replies.
              </div>
            </div>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={60}
              step={1}
              value={activeListeningDraftSeconds}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1 && n <= 60) {
                  update({ activeListeningDraftSeconds: Math.round(n) })
                }
              }}
            />
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Speech-to-text model</div>
              <div className={styles.settingDesc}>
                Larger models transcribe more accurately but use more CPU. The model is downloaded once when you pick it (~40 MB to ~1.5 GB depending on size) and cached on disk after.
              </div>
              {installInFlight && !installModalOpen && activeWhisperOption && (
                <button
                  type="button"
                  className={whisperModalStyles.pill}
                  onClick={reopenInstallModal}
                  title="Show install progress"
                >
                  <span className={whisperModalStyles.pillDot} />
                  Installing {activeWhisperOption.label} · {preloadPercent.toFixed(0)}%
                </button>
              )}
            </div>
            <select
              className={styles.select}
              value={pendingWhisperModel?.id ?? whisperModel}
              disabled={installInFlight}
              onChange={(e) => handleWhisperModelChange(e.target.value)}
            >
              {WHISPER_MODEL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} · ~{opt.size}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.section} style={{ paddingTop: 16 }}>
          <div className={styles.sectionTitle}>Agent View</div>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingLabel}>Start expanded</div>
              <div className={styles.settingDesc}>
                Open the agent view in full-width mode when the app launches. When off, the agent opens in the default split layout.
              </div>
            </div>
            <HToggle
              on={agentStartsExpanded}
              onChange={(v) => update({ agentStartsExpanded: v })}
            />
          </div>
        </section>
      </>
    )
  }

  // ─────────────────────────────────────────────────────────
  // Render: Providers (PLATES I – II)
  // ─────────────────────────────────────────────────────────

  function renderProviders(): JSX.Element {
    return (
      <>
        {/* Page header */}
        <div className={styles.pageHeader}>
          <div>
            <div className={styles.pageHeaderMeta}>PROJECTROSE · SETTINGS · PROVIDERS</div>
            <div className={styles.pageTitle}>
              <span className={styles.pageTitleAccent}>Providers</span>
              {' · '}
              <span className={styles.pageTitleSub}>endpoints</span>
            </div>
          </div>
          <div className={styles.pageHeaderRight}>
            <div>PLATES · I — III</div>
            <div className={styles.colophonAccent}>Rosa configurata</div>
          </div>
        </div>
        <hr className={styles.pageHeaderDivider} />

        {/* ══ PLATE I · PROVIDERS ══ */}
        <div className={styles.plateSection}>
          <SectionHeader
            n="I"
            title="Providers"
            sub="One drawer per provider — keys are masked and status is verified."
          />
          <div className={styles.sectionGap} />

          {PROVIDERS.map((p) => {
            const fields = getProviderFields(p.kind)
            const fieldDefs = PROVIDER_FIELD_DEFS[p.kind] ?? []
            const status = getProviderStatus(p.kind)
            const isExpanded = expandedProvider === p.kind
            const isTesting = !!providerTesting[p.kind]
            const filledCount = Object.values(fields).filter((v) => v && v !== '').length
            const totalFields = fieldDefs.length

            return (
              <div key={p.kind} className={styles.providerCard}>
                <button
                  type="button"
                  onClick={() => setExpandedProvider(isExpanded ? null : p.kind)}
                  className={styles.providerCardHeader}
                  style={{
                    borderBottom: isExpanded ? '1px solid var(--color-bg-secondary)' : 'none',
                    background: isExpanded ? 'var(--color-bg-primary)' : 'transparent',
                  }}
                >
                  <div className={styles.providerCardHeaderInner}>
                    <div className={styles.providerGlyphBox}>
                      <span className={styles.providerSpecNum}>№{p.spec}</span>
                      <ProviderGlyph kind={p.kind} size={28} />
                    </div>
                    <div className={styles.providerNameBlock}>
                      <div className={styles.providerNameRow}>
                        <span className={styles.providerName}>{p.name}</span>
                        <span className={styles.providerLatin}>{p.latin}</span>
                      </div>
                      <div className={styles.providerStatusRow}>
                        <StatusBadge state={status} />
                        <span className={styles.providerFieldInfo}>
                          {p.kind === 'projectrose'
                            ? prAccount.loggedIn
                              ? 'signed in'
                              : 'sign in to use the managed endpoint'
                            : status === 'connected' || status === 'unverified'
                              ? `${filledCount}/${totalFields} field${totalFields === 1 ? '' : 's'}`
                              : `${totalFields} field${totalFields === 1 ? '' : 's'} required`}
                        </span>
                      </div>
                    </div>
                    <span
                      className={styles.providerCaret}
                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      ▸
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className={`${styles.providerCardBody} ${styles.drawerIn}`}>
                    {p.kind === 'projectrose' ? (
                      <div style={{ padding: '12px 16px 4px' }}>
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
                          {prAccount.loggedIn
                            ? 'Active — chats route through the managed endpoint while you’re signed in. Sign out to fall back to your other providers.'
                            : 'Sign in to route chats through the managed ProjectRose endpoint backed by your subscription — no API keys needed.'}
                        </p>
                        {prAccount.loggedIn ? (
                          <>
                            <div style={{ fontSize: 12, color: 'var(--color-text-primary)', marginBottom: 4 }}>
                              {prAccount.name || prAccount.email}
                            </div>
                            {prAccount.name && (
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                                {prAccount.email}
                              </div>
                            )}
                            <UsageBar
                              usage={prUsage}
                              loading={prUsageLoading}
                              error={prUsageError}
                              onRefresh={loadProjectRoseUsage}
                            />
                          </>
                        ) : prMode === 'pending' ? (
                          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
                            Browser opened — finish authorization there.
                            {prPairingUrl && (
                              <>
                                {' '}
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard.writeText(prPairingUrl).catch(() => {})}
                                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', cursor: 'pointer', textDecoration: 'underline', fontSize: 11, fontFamily: 'inherit' }}
                                >
                                  COPY LINK
                                </button>
                              </>
                            )}
                          </p>
                        ) : null}
                        {prError && (
                          <p style={{ fontSize: 11, color: 'var(--color-error)', margin: '0 0 12px' }}>{prError}</p>
                        )}
                      </div>
                    ) : (
                      <>
                        {fieldDefs.map((f) => (
                          <FieldRow key={f.key} label={f.label} hint={f.hint}>
                            <KeyInput
                              value={fields[f.key] ?? ''}
                              placeholder={f.placeholder}
                              type={f.secret ? 'password' : 'text'}
                              onChange={(v) => handleProviderFieldChange(p.kind, f.key, v)}
                            />
                          </FieldRow>
                        ))}
                        {p.kind === 'ollama' && (
                          <FieldRow label="MODEL NAME" hint="exact tag pulled via `ollama pull`">
                            {(() => {
                              const options = ollamaModels['__ollama_provider__'] ?? []
                              return (
                                <select
                                  className={styles.hSelect}
                                  value={ollamaModelName}
                                  onChange={(e) => update({ ollamaModelName: e.target.value })}
                                  onFocus={() => fetchOllamaModels('__ollama_provider__', ollamaBaseUrl)}
                                >
                                  {!ollamaModelName && <option value="" disabled>Select a model</option>}
                                  {ollamaModelName && !options.includes(ollamaModelName) && (
                                    <option value={ollamaModelName}>{ollamaModelName}</option>
                                  )}
                                  {options.map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                              )
                            })()}
                          </FieldRow>
                        )}
                      </>
                    )}
                    {p.kind === 'projectrose' ? (
                      <div className={styles.providerCardFooter} style={{ justifyContent: 'stretch' }}>
                        {prAccount.loggedIn ? (
                          <button type="button" className={styles.ghostBtn} style={{ width: '100%' }} onClick={projectroseSignOut}>
                            SIGN OUT
                          </button>
                        ) : prMode === 'pending' ? (
                          <button type="button" className={styles.ghostBtn} style={{ width: '100%' }} onClick={projectroseCancel}>
                            CANCEL
                          </button>
                        ) : (
                          <button type="button" className={styles.primaryBtn} style={{ width: '100%' }} onClick={projectroseSignIn}>
                            SIGN IN
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className={styles.providerCardFooter}>
                        <div className={styles.providerFooterBtns}>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            onClick={() => clearProvider(p.kind)}
                          >
                            CLEAR
                          </button>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            disabled={filledCount < totalFields || isTesting}
                            onClick={() => verifyProvider(p.kind)}
                          >
                            {isTesting ? 'TESTING…' : status === 'connected' ? '↻ TEST AGAIN' : 'VERIFY & SAVE'}
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ══ PLATE II · CONNECTED ACCOUNTS ══ */}
        {/* External identities the app can read/write on the user's behalf.
            Lives here (not inside Memory or Contacts) because the auth is a
            shared, app-wide concern — features in other tabs consume the
            signed-in state rather than each owning their own sign-in. */}
        <div className={styles.plateSection}>
          <SectionHeader
            n="II"
            title="Connected Accounts"
            sub="Third-party services the agent can read or write on your behalf."
          />
          <div className={styles.sectionGap} />

          {(() => {
            const kind = 'google'
            const name = 'Google'
            const latin = 'Rosa connexa'
            const spec = 'G1'
            const isExpanded = expandedProvider === kind
            const signedIn = googleStatus?.signedIn ?? false
            const accountEmail = googleStatus?.accountEmail ?? null
            const credsConfigured = googleStatus?.credentialsConfigured ?? false
            const status: ProviderStatus =
              signedIn ? 'connected' : credsConfigured ? 'unverified' : 'missing'
            const draftReady =
              googleClientIdDraft.trim().length > 0 && googleClientSecretDraft.trim().length > 0

            return (
              <div className={styles.providerCard}>
                <button
                  type="button"
                  onClick={() => setExpandedProvider(isExpanded ? null : kind)}
                  className={styles.providerCardHeader}
                  style={{
                    borderBottom: isExpanded ? '1px solid var(--color-bg-secondary)' : 'none',
                    background: isExpanded ? 'var(--color-bg-primary)' : 'transparent',
                  }}
                >
                  <div className={styles.providerCardHeaderInner}>
                    <div className={styles.providerGlyphBox}>
                      <span className={styles.providerSpecNum}>№{spec}</span>
                      <ProviderGlyph kind={kind} size={28} />
                    </div>
                    <div className={styles.providerNameBlock}>
                      <div className={styles.providerNameRow}>
                        <span className={styles.providerName}>{name}</span>
                        <span className={styles.providerLatin}>{latin}</span>
                      </div>
                      <div className={styles.providerStatusRow}>
                        <StatusBadge state={status} />
                        <span className={styles.providerFieldInfo}>
                          {signedIn
                            ? `signed in${accountEmail ? ` · ${accountEmail}` : ''}`
                            : credsConfigured
                              ? 'sign in to enable Contacts sync'
                              : 'paste OAuth credentials to enable'}
                        </span>
                      </div>
                    </div>
                    <span
                      className={styles.providerCaret}
                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      ▸
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className={`${styles.providerCardBody} ${styles.drawerIn}`}>
                    <div style={{ padding: '12px 16px 4px' }}>
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6, margin: '0 0 12px' }}>
                        {credsConfigured
                          ? (signedIn
                            ? 'Active — features that consume Google (currently Settings → Contacts > sync) will use this account.'
                            : 'Credentials saved. Sign in once below; other Google features (Contacts sync today, Gmail/Calendar/Drive later) will pick it up automatically.')
                          : 'Paste a Google OAuth client ID + secret to enable Google features. The credentials are yours; they stay on this machine.'}
                      </p>
                      {signedIn && accountEmail && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-primary)', marginBottom: 12 }}>
                          {accountEmail}
                        </div>
                      )}
                      {googleError && (
                        <p style={{ fontSize: 11, color: 'var(--color-error)', margin: '0 0 12px' }}>{googleError}</p>
                      )}

                      <button
                        type="button"
                        onClick={() => setGoogleHelpOpen((o) => !o)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: 'var(--color-text-muted)',
                          cursor: 'pointer',
                          fontSize: 11,
                          letterSpacing: 0.6,
                          fontFamily: 'inherit',
                          marginBottom: 10,
                        }}
                      >
                        {googleHelpOpen ? '▾ HOW DO I GET THESE?' : '▸ HOW DO I GET THESE?'}
                      </button>
                      {googleHelpOpen && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--color-text-muted)',
                            lineHeight: 1.7,
                            background: 'var(--color-bg-primary)',
                            border: '1px solid var(--color-bg-secondary)',
                            padding: 12,
                            marginBottom: 12,
                          }}
                        >
                          <p style={{ margin: '0 0 8px', color: 'var(--color-text-primary)' }}>
                            <strong>Why do I need to set this up myself?</strong>
                          </p>
                          <p style={{ margin: '0 0 8px' }}>
                            ProjectRose is open source — anyone can read its code. To talk to Google
                            services on your behalf, the app needs a pair of "keys" issued by Google.
                            Google requires the second key (the "client secret") to be kept private.
                            If we shipped it inside ProjectRose, anyone could pull it out of the public
                            code, which would let bad actors impersonate the app and likely get the
                            keys revoked — breaking the app for everyone.
                          </p>
                          <p style={{ margin: '0 0 12px' }}>
                            Until ProjectRose ships a hosted service that can hand out keys safely,
                            you'll need to make your own free pair in Google's developer console.
                            It's a one-time setup. Your keys stay on this computer and are only used
                            so ProjectRose can talk to your own Google account.
                          </p>
                          <p style={{ margin: '0 0 6px', color: 'var(--color-text-primary)' }}>
                            <strong>Steps:</strong>
                          </p>
                          <ol style={{ margin: '0 0 8px 20px', padding: 0 }}>
                            <li>Sign in to <span style={{ fontFamily: 'var(--font-mono)' }}>console.cloud.google.com</span> and create (or select) a project.</li>
                            <li>Enable the <em>People API</em> (Contacts sync needs it; enable Gmail/Calendar/Drive APIs later if you want those).</li>
                            <li>Open <em>APIs &amp; Services → OAuth consent screen</em>, choose "External", add yourself as a test user.</li>
                            <li>Open <em>APIs &amp; Services → Credentials</em>, click <em>Create Credentials → OAuth client ID</em>, pick <strong>Desktop app</strong>.</li>
                            <li>Copy the client ID and client secret it shows you, and paste them below.</li>
                          </ol>
                          <p style={{ margin: 0, fontStyle: 'italic' }}>
                            Your client secret is encrypted with your operating system's keychain and
                            never leaves this computer.
                          </p>
                        </div>
                      )}

                      <FieldRow
                        label="OAUTH CLIENT ID"
                        hint="console.cloud.google.com/apis/credentials"
                      >
                        <KeyInput
                          value={googleClientIdDraft}
                          placeholder="xxx.apps.googleusercontent.com"
                          onChange={setGoogleClientIdDraft}
                          type="text"
                        />
                      </FieldRow>
                      <FieldRow label="OAUTH CLIENT SECRET" hint="stored in system keychain">
                        <KeyInput
                          value={googleClientSecretDraft}
                          placeholder="GOCSPX-..."
                          onChange={setGoogleClientSecretDraft}
                        />
                      </FieldRow>
                    </div>
                    <div className={styles.providerCardFooter} style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        style={{ flex: 1 }}
                        onClick={googleClearCredentials}
                        disabled={(!credsConfigured && !signedIn) || googleBusy !== null}
                        title="Wipes the saved client ID, client secret, and refresh token."
                      >
                        CLEAR
                      </button>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        style={{ flex: 1 }}
                        onClick={googleSaveCredentials}
                        disabled={!draftReady || googleBusy !== null}
                      >
                        SAVE
                      </button>
                      {signedIn ? (
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          style={{ flex: 2 }}
                          onClick={googleSignOut}
                          disabled={googleBusy !== null}
                        >
                          {googleBusy ?? 'SIGN OUT'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          style={{ flex: 2 }}
                          onClick={googleSignIn}
                          disabled={!credsConfigured || googleBusy !== null}
                        >
                          {googleBusy ?? 'SIGN IN WITH GOOGLE'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* Colophon */}
        <div className={styles.colophon}>
          <span>COLOPHON · settings persist on change · keys held in system keychain</span>
          <span className={styles.colophonAccent}>Rosa configurata</span>
        </div>
      </>
    )
  }

  // ─────────────────────────────────────────────────────────
  // Render: Tools (PLATE I)
  // ─────────────────────────────────────────────────────────

  function renderTools(): JSX.Element {
    return (
      <>
        {/* Page header */}
        <div className={styles.pageHeader}>
          <div>
            <div className={styles.pageHeaderMeta}>PROJECTROSE · SETTINGS · TOOLS</div>
            <div className={styles.pageTitle}>
              <span className={styles.pageTitleAccent}>Tools</span>
              {' · '}
              <span className={styles.pageTitleSub}>core, project & extension</span>
            </div>
          </div>
          <div className={styles.pageHeaderRight}>
            <div>PLATE · I</div>
            <div className={styles.colophonAccent}>Rosa configurata</div>
          </div>
        </div>
        <hr className={styles.pageHeaderDivider} />

        {/* ══ PLATE I · TOOLS ══ */}
        <div className={styles.plateSection}>
          <SectionHeader
            n="I"
            title="Tools"
            sub="What the agent is allowed to do."
          />
          <div className={styles.sectionGapSm} />

          <div className={styles.panelBlock}>
            <div className={styles.panelHeader}>
              <span>TOOLS · CORE</span>
              <span className={styles.panelHeaderCount}>
                {availableTools.filter((t) => t.type === 'core' && !disabledTools.includes(t.name)).length}
                /
                {availableTools.filter((t) => t.type === 'core').length} enabled
              </span>
            </div>
            {availableTools.filter((t) => t.type === 'core').map((tool) => {
              const enabled = !disabledTools.includes(tool.name)
              return (
                <HSettingRow key={tool.name} label={tool.displayName} desc={tool.description}>
                  <HToggle on={enabled} onChange={() => toggleTool(tool.name)} />
                </HSettingRow>
              )
            })}
            {availableTools.filter((t) => t.type === 'core').length === 0 && (
              <div style={{ padding: '14px 18px', fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                No core tools loaded.
              </div>
            )}
          </div>

          {/* Extension tools (below the grid, kept accessible) */}
          {availableTools.filter((t) => t.type === 'extension').length > 0 && (
            <div style={{ marginTop: 18 }}>
              {Object.entries(
                availableTools
                  .filter((t) => t.type === 'extension')
                  .reduce<Record<string, ToolMeta[]>>((acc, t) => {
                    const key = t.extensionName ?? t.extensionId ?? 'Extension'
                    ;(acc[key] ??= []).push(t)
                    return acc
                  }, {})
              ).map(([groupName, groupTools]) => (
                <div key={groupName} className={styles.panelBlock} style={{ marginBottom: 12 }}>
                  <div className={styles.panelHeader}>{groupName.toUpperCase()}</div>
                  {groupTools.map((tool) => {
                    const enabled = !disabledTools.includes(tool.name)
                    return (
                      <HSettingRow key={tool.name} label={tool.displayName} desc={tool.description}>
                        <HToggle on={enabled} onChange={() => toggleTool(tool.name)} />
                      </HSettingRow>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Colophon */}
        <div className={styles.colophon}>
          <span>COLOPHON · settings persist on change · keys held in system keychain</span>
          <span className={styles.colophonAccent}>Rosa configurata</span>
        </div>
      </>
    )
  }

  // ─────────────────────────────────────────────────────────
  // Render: Skills (PLATE I)
  // ─────────────────────────────────────────────────────────

  function renderSkills(): JSX.Element {
    return (
      <>
        {/* Page header */}
        <div className={styles.pageHeader}>
          <div>
            <div className={styles.pageHeaderMeta}>PROJECTROSE · SETTINGS · SKILLS</div>
            <div className={styles.pageTitle}>
              <span className={styles.pageTitleAccent}>Skills</span>
              {' · '}
              <span className={styles.pageTitleSub}>system-prompt grafts</span>
            </div>
          </div>
          <div className={styles.pageHeaderRight}>
            <div>PLATE · I</div>
            <div className={styles.colophonAccent}>Rosa configurata</div>
          </div>
        </div>
        <hr className={styles.pageHeaderDivider} />

        {/* ══ PLATE I · SKILLS ══ */}
        <div className={styles.plateSection}>
          <SectionHeader
            n="I"
            title="Skills"
            sub="Markdown files injected into the system prompt when the agent loads them."
          />
          <div className={styles.sectionGapSm} />

          <div className={styles.panelBlock}>
            <div className={styles.panelHeader}>
              <span>SKILLS · PROJECT</span>
              <span className={styles.panelHeaderCount}>{skills.length} available</span>
            </div>
            {skills.length === 0 && (
              <div style={{ padding: '14px 18px', fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                No skills yet. Add a .md file to get started.
              </div>
            )}
            {skills.map((skill) => (
              <div key={skill.name} className={styles.skillRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.skillName}>{skill.name}</div>
                  {skill.description && (
                    <div className={styles.skillDesc}>{skill.description}</div>
                  )}
                </div>
                <button className={styles.skillRemoveBtn} onClick={() => deleteSkill(skill.name)} title="Remove skill">
                  ×
                </button>
              </div>
            ))}
            <button className={styles.addModelRow} onClick={uploadSkill}>
              + ADD SKILL
            </button>
          </div>
        </div>

        {/* Colophon */}
        <div className={styles.colophon}>
          <span>COLOPHON · settings persist on change · keys held in system keychain</span>
          <span className={styles.colophonAccent}>Rosa configurata</span>
        </div>
      </>
    )
  }

  // ─────────────────────────────────────────────────────────
  // Render: Extensions
  // ─────────────────────────────────────────────────────────

  function renderExtensions(): JSX.Element {
    return <ExtensionsTab />
  }

  // ─────────────────────────────────────────────────────────
  // Page router
  // ─────────────────────────────────────────────────────────

  function renderPage(): JSX.Element {
    switch (activePage) {
      case 'general':    return renderGeneral()
      case 'providers':  return renderProviders()
      case 'tools':      return renderTools()
      case 'skills':     return renderSkills()
      case 'prompts':    return <PromptsTab />
      case 'memory':     return <MemoryTab />
      case 'updates':    return <UpdatesTab />
      case 'extensions': return renderExtensions()
      default: {
        const label = topLevelItems.find((i) => i.id === activePage)?.label ?? activePage
        return (
          <section className={styles.section}>
            <div className={styles.sectionTitle}>{label}</div>
            <div className={styles.emptyState}>No settings available for this section yet.</div>
          </section>
        )
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Root render
  // ─────────────────────────────────────────────────────────

  return (
    <div className={styles.layout}>
      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarLabel}>Settings · Drawer</div>
          {topLevelItems.map((item) => {
            const isActive = activePage === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.sidebarItem} ${isActive ? styles.sidebarItemActive : ''}`}
                onClick={() => setActivePage(item.id)}
              >
                <span className={`${styles.sidebarItemNum} ${isActive ? styles.sidebarItemActiveNum : ''}`}>
                  №{item.n}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}

          <div className={styles.sidebarFooter}>
            <div>SPECIMEN · CONFIG</div>
            <div style={{ fontStyle: 'italic', opacity: 0.6 }}>secrets · keychain</div>
          </div>
        </aside>

        {/* Main content */}
        <div className={styles.content}>
          <div className={styles.page}>
            {renderPage()}
          </div>
        </div>
      </div>

      <WhisperModelInstallModal
        open={installModalOpen}
        targetModel={pendingWhisperModel}
        onConfirm={handleWhisperInstallConfirm}
        onCancel={handleWhisperInstallCancel}
        onHide={handleWhisperInstallHide}
        onComplete={handleWhisperInstallComplete}
      />
    </div>
  )
}
