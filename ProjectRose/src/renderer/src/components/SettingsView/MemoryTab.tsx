import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BehaviorRecord,
  DiaryIndexRow,
  DiaryScheduleStatus,
  MemorySettings
} from '@shared/memory'
import { MarkdownEditor } from './MarkdownEditor'
import styles from './MemoryTab.module.css'

type SubTab = 'diary' | 'behavior' | 'schedule'

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'diary',    label: 'Diary' },
  { id: 'behavior', label: 'Behavior Records' },
  { id: 'schedule', label: 'Schedule' }
]

// Contacts used to live here as a sub-tab. It now lives in the rose-contacts
// built-in extension (src/renderer/src/extensions/builtins/rose-contacts/),
// where the contacts-updater schedule card and Google sync card also live —
// leaving the diary as the only thing on the Schedule sub-tab.

// ── Diary sub-tab ────────────────────────────────────────────────────────

function DiarySubTab(): JSX.Element {
  const [index, setIndex] = useState<DiaryIndexRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [original, setOriginal] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)

  const refreshIndex = useCallback(async () => {
    const rows = await window.api.memory.listDiary()
    setIndex(rows)
    if (rows.length && !selected) setSelected(rows[0].date)
  }, [selected])

  useEffect(() => { void refreshIndex() }, [refreshIndex])

  useEffect(() => {
    if (!selected) { setContent(''); setOriginal(''); return }
    let cancelled = false
    void window.api.memory.readDiary(selected).then((c) => {
      if (cancelled) return
      const text = c ?? ''
      setContent(text)
      setOriginal(text)
    })
    return () => { cancelled = true }
  }, [selected])

  // Group by year/month for the tree view.
  const grouped = useMemo(() => {
    const out = new Map<string, Map<string, string[]>>()
    for (const row of index) {
      const [y, m, d] = row.date.split('-')
      if (!out.has(y)) out.set(y, new Map())
      const months = out.get(y)!
      if (!months.has(m)) months.set(m, [])
      months.get(m)!.push(d)
    }
    return out
  }, [index])

  const dirty = content !== original
  const save = async (): Promise<void> => {
    if (!selected || !dirty) return
    setBusy('Saving…')
    try {
      await window.api.memory.writeDiary({ dateKey: selected, content })
      setOriginal(content)
      void refreshIndex()
    } finally { setBusy(null) }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    setBusy('Deleting…')
    try {
      await window.api.memory.deleteDiary(selected)
      setSelected(null)
      setContent('')
      setOriginal('')
      void refreshIndex()
    } finally { setBusy(null) }
  }

  const runNow = async (): Promise<void> => {
    setBusy('Writing today\'s diary…')
    try {
      const result = await window.api.memory.runDiaryNow()
      await refreshIndex()
      if (result.written) setSelected(result.dateKey)
    } finally { setBusy(null) }
  }

  const regenerate = async (): Promise<void> => {
    setBusy('Re-generating today\'s diary…')
    try {
      const newContent = await window.api.memory.regenerateTodayDiary()
      await refreshIndex()
      const today = new Date()
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      setSelected(todayKey)
      setContent(newContent)
      setOriginal(newContent)
    } finally { setBusy(null) }
  }

  return (
    <div className={styles.split}>
      <aside className={styles.listPane}>
        <div className={styles.listHeader}>
          <span>Diary · {index.length} entries</span>
        </div>
        <div className={styles.listScroll}>
          {index.length === 0 && <div className={styles.empty}>No diary entries yet.</div>}
          <div className={styles.tree}>
            {[...grouped.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([year, months]) => (
              <div key={year}>
                <div className={styles.treeYear}>{year}</div>
                {[...months.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([month, days]) => (
                  <div key={month}>
                    <div className={styles.treeMonth}>{year}-{month}</div>
                    {days.sort((a, b) => (a < b ? 1 : -1)).map((day) => {
                      const key = `${year}-${month}-${day}`
                      const active = selected === key
                      return (
                        <div
                          key={key}
                          className={`${styles.treeDay} ${active ? styles.treeDayActive : ''}`}
                          onClick={() => setSelected(key)}
                        >
                          {key}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.btnRow}>
          <button className={styles.btn} onClick={runNow} disabled={busy !== null}>Run now</button>
          <button className={styles.btn} onClick={regenerate} disabled={busy !== null}>Regenerate today</button>
        </div>
      </aside>

      <section className={styles.editorPane}>
        <div className={styles.editorHeader}>
          <span>{selected ?? 'Select an entry'}</span>
          <span>{busy ?? (dirty ? 'Unsaved changes' : '')}</span>
        </div>
        <div className={styles.editorBody}>
          {selected
            ? <MarkdownEditor value={content} onChange={setContent} />
            : <div className={styles.empty}>Pick a date from the tree, or press "Run now" to write today\'s entry.</div>}
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={!dirty || busy !== null}>Save</button>
          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={remove} disabled={!selected || busy !== null}>Delete</button>
        </div>
      </section>
    </div>
  )
}

// ── Behavior Records sub-tab ─────────────────────────────────────────────

function BehaviorSubTab(): JSX.Element {
  const [records, setRecords] = useState<BehaviorRecord[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const rows = await window.api.memory.listBehaviorRecords()
    setRecords(rows)
    if (rows.length && !selected) setSelected(rows[0].filename)
  }, [selected])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!selected) { setContent(''); setOriginal(''); return }
    let cancelled = false
    void window.api.memory.readBehaviorRecord(selected).then((c) => {
      if (cancelled) return
      const text = c ?? ''
      setContent(text)
      setOriginal(text)
    })
    return () => { cancelled = true }
  }, [selected])

  const dirty = content !== original

  const save = async (): Promise<void> => {
    if (!selected || !dirty) return
    setBusy('Saving…')
    try {
      await window.api.memory.writeBehaviorRecord({ filename: selected, content })
      setOriginal(content)
      void refresh()
    } finally { setBusy(null) }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    setBusy('Deleting…')
    try {
      await window.api.memory.deleteBehaviorRecord(selected)
      setSelected(null)
      setContent('')
      setOriginal('')
      void refresh()
    } finally { setBusy(null) }
  }

  const addNew = async (): Promise<void> => {
    const slug = prompt('Short slug for this directive (kebab-case)?')
    if (!slug) return
    const decision = prompt('One-line decision summary?')
    if (!decision) return
    const details = prompt('Longer explanation (impacts on agent behaviour)?') ?? ''
    setBusy('Adding…')
    try {
      const record = await window.api.memory.addBehaviorRecord({ slug, decision, details })
      await refresh()
      setSelected(record.filename)
    } finally { setBusy(null) }
  }

  return (
    <div className={styles.split}>
      <aside className={styles.listPane}>
        <div className={styles.listHeader}>
          <span>Behaviour records · {records.length}</span>
        </div>
        <div className={styles.listScroll}>
          {records.length === 0 && <div className={styles.empty}>No behaviour records yet. Ask the agent to record a directive, or add one below.</div>}
          {records.map((r) => (
            <button
              key={r.filename}
              className={`${styles.listRow} ${selected === r.filename ? styles.listRowActive : ''}`}
              onClick={() => setSelected(r.filename)}
            >
              <div>{r.slug}</div>
              <div className={styles.listRowSub}>{r.date}</div>
            </button>
          ))}
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={addNew} disabled={busy !== null}>+ New</button>
        </div>
      </aside>

      <section className={styles.editorPane}>
        <div className={styles.editorHeader}>
          <span>{selected ?? 'Select a record'}</span>
          <span>{busy ?? (dirty ? 'Unsaved changes' : '')}</span>
        </div>
        <div className={styles.editorBody}>
          {selected
            ? <MarkdownEditor value={content} onChange={setContent} />
            : <div className={styles.empty}>Pick a record on the left.</div>}
        </div>
        <div className={styles.btnRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={!dirty || busy !== null}>Save</button>
          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={remove} disabled={!selected || busy !== null}>Delete</button>
        </div>
      </section>
    </div>
  )
}

// ── Schedule sub-tab ─────────────────────────────────────────────────────

function ScheduleSubTab(): JSX.Element {
  const [memory, setMemory] = useState<MemorySettings | null>(null)
  const [status, setStatus] = useState<DiaryScheduleStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [s, settings] = await Promise.all([
      window.api.memory.getScheduleStatus(),
      window.api.getSettings()
    ])
    setStatus(s)
    setMemory((settings.memory as MemorySettings | undefined) ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => { void refresh() }, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const enabled = memory?.diaryEnabled ?? true
  const time = memory?.diaryTime ?? '21:00'

  const updateMemory = async (patch: Partial<MemorySettings>): Promise<void> => {
    if (!memory) return
    setBusy('Saving…')
    try {
      const next: MemorySettings = { ...memory, ...patch }
      await window.api.setSettings({ memory: next })
      setMemory(next)
      void refresh()
    } finally { setBusy(null) }
  }

  const runNow = async (): Promise<void> => {
    setBusy('Running diary…')
    try {
      await window.api.memory.runDiaryNow()
      void refresh()
    } finally { setBusy(null) }
  }

  const fmtTime = (ms: number | null): string => {
    if (!ms) return '—'
    return new Date(ms).toLocaleString()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className={styles.scheduleCard}>
        <div className={styles.scheduleRow}>
          <span className={styles.scheduleLabel}>Daily diary</span>
          <span className={enabled ? styles.statusPillOk : styles.statusPillOff}>
            {enabled ? 'enabled' : 'disabled'}
          </span>
        </div>

        <div className={styles.scheduleRow}>
          <span className={styles.scheduleLabel}>Enabled</span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!memory}
            onChange={(e) => updateMemory({ diaryEnabled: e.target.checked })}
          />
        </div>

        <div className={styles.scheduleRow}>
          <span className={styles.scheduleLabel}>Write at (24h)</span>
          <input
            className={styles.input}
            type="time"
            value={time}
            disabled={!memory}
            onChange={(e) => updateMemory({ diaryTime: e.target.value })}
          />
        </div>

        <div className={styles.scheduleRow}>
          <span className={styles.scheduleLabel}>Last run</span>
          <span className={styles.scheduleValue}>{fmtTime(status?.lastRun ?? null)}</span>
        </div>

        <div className={styles.scheduleRow}>
          <span className={styles.scheduleLabel}>Next run</span>
          <span className={styles.scheduleValue}>{fmtTime(status?.nextRun ?? null)}</span>
        </div>

        <div className={styles.scheduleRow}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={runNow} disabled={busy !== null}>
            Run now
          </button>
          {busy && <span className={styles.busy}>{busy}</span>}
        </div>
      </div>
    </div>
  )
}

// ── Top-level component ──────────────────────────────────────────────────

export function MemoryTab(): JSX.Element {
  const [active, setActive] = useState<SubTab>('diary')

  return (
    <div className={styles.layout}>
      <div className={styles.subtabs}>
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.subtab} ${active === t.id ? styles.subtabActive : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'diary'    && <DiarySubTab />}
      {active === 'behavior' && <BehaviorSubTab />}
      {active === 'schedule' && <ScheduleSubTab />}
    </div>
  )
}
