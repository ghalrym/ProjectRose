import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONTACT_KINDS,
  type ContactKind,
  type ContactSearchResult,
  type ContactsUpdaterStatus,
  type GooglePullPlan,
  type GooglePushPlan,
  type GoogleSyncStatus,
  type MemorySettings
} from '@shared/memory'
import { MarkdownEditor } from './MarkdownEditor'
import { DEFAULT_GOOGLE_CLIENT_ID } from '@shared/googleOAuth'
import { useViewStore } from '../../stores/useViewStore'
import memoryStyles from './MemoryTab.module.css'
import styles from './ContactsTab.module.css'

// Top-level "Contacts" Settings tab. Owns:
//   • The Memory.Contact editor (lifted out of MemoryTab.ContactsSubTab)
//   • The LLM contacts-updater schedule card (lifted out of Memory > Schedule)
//   • The Google Contacts sync card (per ADR 0008)
//
// Each entity has a ContactKind (person/business/website/other) stored as a
// `- kind: <value>` bullet inside the file. The editor's kind dropdown
// rewrites that bullet in-memory; the Google Sync card filters which kinds
// round-trip with Google.

// ── kind helpers (renderer-side, mirror contacts.ts) ────────────────────

const KIND_LINE_RE = /^\s*-\s+kind:\s*(person|business|website|other)\s*$/i

function parseKindFromContent(content: string, fallback: ContactKind = 'other'): ContactKind {
  for (const line of content.split('\n')) {
    const m = line.match(KIND_LINE_RE)
    if (m) return m[1].toLowerCase() as ContactKind
  }
  return fallback
}

/**
 * Replace or insert the `- kind: <value>` bullet in the markdown content.
 * Insertion goes right after the `# Entity:` header so the bullet is the
 * first thing a human (or the agent) sees. Matches the order contacts.ts
 * uses when round-tripping the file.
 */
function rewriteKindInContent(content: string, newKind: ContactKind): string {
  const lines = content.split('\n')
  let replaced = false
  const out: string[] = []
  for (const line of lines) {
    if (!replaced && KIND_LINE_RE.test(line)) {
      out.push(`- kind: ${newKind}`)
      replaced = true
      continue
    }
    out.push(line)
  }
  if (!replaced) {
    const headerIdx = out.findIndex((l) => /^#\s*Entity:/i.test(l))
    if (headerIdx >= 0) out.splice(headerIdx + 1, 0, `- kind: ${newKind}`)
    else out.unshift(`- kind: ${newKind}`)
  }
  return out.join('\n')
}

function kindBadgeClass(kind: ContactKind): string {
  switch (kind) {
    case 'person':   return `${styles.kindBadge} ${styles.kindPerson}`
    case 'business': return `${styles.kindBadge} ${styles.kindBusiness}`
    case 'website':  return `${styles.kindBadge} ${styles.kindWebsite}`
    case 'other':    return `${styles.kindBadge} ${styles.kindOther}`
  }
}

// ── Editor pane ──────────────────────────────────────────────────────────

function ContactsEditor(): JSX.Element {
  const [entries, setEntries] = useState<Array<{ entity: string; kind: ContactKind }>>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchResult, setSearchResult] = useState<ContactSearchResult | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const refresh = useCallback(async () => {
    const list = await window.api.memory.listContactsDetailed()
    setEntries(list)
    if (list.length && !selected) setSelected(list[0].entity)
  }, [selected])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!selected) { setContent(''); setOriginal(''); return }
    let cancelled = false
    void window.api.memory.readContact(selected).then((c) => {
      if (cancelled) return
      const text = c ?? ''
      setContent(text)
      setOriginal(text)
    })
    return () => { cancelled = true }
  }, [selected])

  useEffect(() => {
    const term = search.trim()
    if (!term) { setSearchResult(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const result = await window.api.memory.searchContacts(term)
      if (!cancelled) setSearchResult(result)
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  const dirty = content !== original
  const currentKind = useMemo(() => parseKindFromContent(content), [content])

  const save = async (): Promise<void> => {
    if (!selected || !dirty) return
    setBusy('Saving…')
    try {
      await window.api.memory.writeContact({ entity: selected, content })
      setOriginal(content)
      void refresh()
    } finally { setBusy(null) }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    setBusy('Deleting…')
    try {
      await window.api.memory.deleteContact(selected)
      setSelected(null)
      setContent('')
      setOriginal('')
      void refresh()
    } finally { setBusy(null) }
  }

  const createContact = async (entity: string, kind: ContactKind): Promise<void> => {
    setBusy('Creating…')
    try {
      const created = await window.api.memory.newContact(entity)
      // newContact defaults to 'other'; if the user picked something else,
      // set the kind in a second call so the file lands classified.
      if (kind !== 'other') {
        await window.api.memory.setContactKind({ entity: created.entity, kind })
      }
      await refresh()
      setSelected(created.entity)
      setNewOpen(false)
    } finally { setBusy(null) }
  }

  const handleKindChange = (next: ContactKind): void => {
    if (!selected) return
    setContent((prev) => rewriteKindInContent(prev, next))
  }

  return (
    <div className={memoryStyles.split}>
      <aside className={memoryStyles.listPane}>
        <div className={memoryStyles.listHeader}>
          <span>Contacts · {entries.length}</span>
        </div>
        <div className={memoryStyles.searchPane}>
          <input
            className={memoryStyles.search}
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={memoryStyles.listScroll}>
          {entries.length === 0 && <div className={memoryStyles.empty}>No contacts yet.</div>}
          {entries.map((e) => (
            <button
              key={e.entity}
              className={`${memoryStyles.listRow} ${selected === e.entity ? memoryStyles.listRowActive : ''}`}
              onClick={() => setSelected(e.entity)}
            >
              <div className={styles.listRowInner}>
                <span className={styles.listRowName}>{e.entity}</span>
                <span className={kindBadgeClass(e.kind)}>{e.kind}</span>
              </div>
            </button>
          ))}
        </div>
        <div className={memoryStyles.btnRow}>
          <button
            className={`${memoryStyles.btn} ${memoryStyles.btnPrimary}`}
            onClick={() => setNewOpen(true)}
            disabled={busy !== null}
          >
            + New
          </button>
        </div>
      </aside>

      {newOpen && (
        <NewContactModal
          busy={busy !== null}
          existing={new Set(entries.map((e) => e.entity.toLowerCase()))}
          onCancel={() => setNewOpen(false)}
          onCreate={createContact}
        />
      )}

      <section className={memoryStyles.editorPane}>
        <div className={memoryStyles.editorHeader}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{selected ?? 'Select a contact'}</span>
            {selected && (
              <select
                className={styles.kindSelect}
                value={currentKind}
                onChange={(e) => handleKindChange(e.target.value as ContactKind)}
                title="Kind — written as `- kind: <value>` in the file"
              >
                {CONTACT_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            )}
          </span>
          <span>{busy ?? (dirty ? 'Unsaved changes' : '')}</span>
        </div>
        {searchResult && (
          <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)', fontSize: 11 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>Direct match:</strong> {searchResult.contact ? 'yes' : 'none'}
            </div>
            <div><strong>Relations ({searchResult.relations.length}):</strong></div>
            {searchResult.relations.map((r, i) => (
              <div key={i} style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>
                <code>{r.entity}</code>: {r.note}
              </div>
            ))}
          </div>
        )}
        <div className={memoryStyles.editorBody}>
          {selected ? (
            <MarkdownEditor value={content} onChange={setContent} />
          ) : (
            <div className={memoryStyles.empty}>Pick a contact on the left.</div>
          )}
        </div>
        <div className={memoryStyles.btnRow}>
          <button
            className={`${memoryStyles.btn} ${memoryStyles.btnPrimary}`}
            onClick={save}
            disabled={!dirty || busy !== null}
          >
            Save
          </button>
          <button
            className={`${memoryStyles.btn} ${memoryStyles.btnDanger}`}
            onClick={remove}
            disabled={!selected || busy !== null}
          >
            Delete
          </button>
        </div>
      </section>
    </div>
  )
}

// ── New contact modal ───────────────────────────────────────────────────
//
// Replaces a `window.prompt()` call that didn't work — modern Electron
// renderers don't honour prompt() unless `enableBlinkFeatures:
// 'JavaScriptUserPrompts'` is set on the BrowserWindow, which this app
// deliberately doesn't do. An inline modal also gives us room to ask for
// the kind upfront, so the contact lands correctly classified.

function NewContactModal({
  busy,
  existing,
  onCancel,
  onCreate
}: {
  busy: boolean
  existing: Set<string>
  onCancel: () => void
  onCreate: (entity: string, kind: ContactKind) => void | Promise<void>
}): JSX.Element {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ContactKind>('person')

  const trimmed = name.trim()
  const conflict = trimmed !== '' && existing.has(trimmed.toLowerCase())
  const canSubmit = trimmed !== '' && !conflict && !busy

  const submit = (): void => {
    if (!canSubmit) return
    void onCreate(trimmed, kind)
  }

  return (
    <div className={styles.modalScrim} onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>New contact</span>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.fieldRow} style={{ marginBottom: 12 }}>
            <span className={styles.label}>Name</span>
            <input
              className={styles.input}
              type="text"
              autoFocus
              placeholder="Person, business, website, or other"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                else if (e.key === 'Escape') onCancel()
              }}
            />
            {conflict && (
              <div className={styles.error}>A contact named "{trimmed}" already exists.</div>
            )}
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.label}>Kind</span>
            <div className={styles.kindFilterGrid}>
              {CONTACT_KINDS.map((k) => (
                <label key={k} className={styles.kindFilterRow}>
                  <input
                    type="radio"
                    name="new-contact-kind"
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  <span className={kindBadgeClass(k)}>{k}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btn} onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={submit}
            disabled={!canSubmit}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Contacts updater card ────────────────────────────────────────────────

function ContactsUpdaterCard(): JSX.Element {
  const [memory, setMemory] = useState<MemorySettings | null>(null)
  const [status, setStatus] = useState<ContactsUpdaterStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [cs, settings] = await Promise.all([
      window.api.memory.getContactsUpdaterStatus(),
      window.api.getSettings()
    ])
    setStatus(cs)
    setMemory((settings.memory as MemorySettings | undefined) ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => { void refresh() }, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const enabled = memory?.contactsUpdaterEnabled ?? true

  const setEnabled = async (next: boolean): Promise<void> => {
    if (!memory) return
    setBusy('Saving…')
    try {
      const updated: MemorySettings = { ...memory, contactsUpdaterEnabled: next }
      await window.api.setSettings({ memory: updated })
      setMemory(updated)
      void refresh()
    } finally { setBusy(null) }
  }

  const sweepNow = async (): Promise<void> => {
    setBusy('Sweeping…')
    try {
      await window.api.memory.runContactsUpdaterNow()
      void refresh()
    } finally { setBusy(null) }
  }

  const fmtTime = (ms: number | null | undefined): string =>
    !ms ? '—' : new Date(ms).toLocaleString()

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.cardTitle}>Contacts updater</span>
        <span className={enabled ? styles.statusOk : styles.statusOff}>
          {enabled ? 'enabled' : 'disabled'}
        </span>
      </div>
      <div className={styles.cardSub}>
        Every {status?.intervalMinutes ?? 30} minutes the agent sweeps recent
        chat messages and updates the contact notes for anyone mentioned.
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!memory}
          onChange={(e) => void setEnabled(e.target.checked)}
        />
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Last run</span>
        <span className={styles.value}>{fmtTime(status?.lastRun)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Next run</span>
        <span className={styles.value}>{fmtTime(status?.nextRun)}</span>
      </div>

      <div className={styles.btnRow}>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={sweepNow}
          disabled={busy !== null}
        >
          Sweep now
        </button>
        {busy && <span className={styles.busy}>{busy}</span>}
      </div>
    </div>
  )
}

// ── Google Sync card ────────────────────────────────────────────────────

type Direction = 'pull' | 'push'

interface ConfirmState {
  direction: Direction
  pullPlan?: GooglePullPlan
  pushPlan?: GooglePushPlan
}

function GoogleSyncCard(): JSX.Element {
  const [status, setStatus] = useState<GoogleSyncStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [memory, setMemory] = useState<MemorySettings | null>(null)
  const setSettingsTarget = useViewStore((s) => s.setSettingsTarget)

  const refresh = useCallback(async () => {
    const [s, settings] = await Promise.all([
      window.api.memory.googleGetStatus(),
      window.api.getSettings()
    ])
    setStatus(s)
    setMemory((settings.memory as MemorySettings | undefined) ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    // Poll while the user might be signing in via the Providers tab — once
    // they come back, the card reflects the new status without needing a
    // tab switch. Cheap (single IPC) and stops when the component unmounts.
    const id = setInterval(() => { void refresh() }, 4_000)
    return () => clearInterval(id)
  }, [refresh])

  const patchGoogle = async (patch: {
    syncKinds?: Record<ContactKind, boolean>
  }): Promise<void> => {
    if (!memory) return
    const next: MemorySettings = {
      ...memory,
      googleSync: { ...memory.googleSync, ...patch }
    }
    await window.api.setSettings({ memory: next })
    setMemory(next)
    void refresh()
  }

  const toggleKind = (kind: ContactKind, on: boolean): void => {
    if (!memory) return
    const current = memory.googleSync.syncKinds
    void patchGoogle({ syncKinds: { ...current, [kind]: on } })
  }

  const openPullConfirm = async (): Promise<void> => {
    setBusy('Previewing pull from Google…')
    setError(null)
    try {
      const pullPlan = await window.api.memory.googlePreviewPull()
      setConfirm({ direction: 'pull', pullPlan })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally { setBusy(null) }
  }

  const openPushConfirm = async (): Promise<void> => {
    setBusy('Previewing push to Google…')
    setError(null)
    try {
      const pushPlan = await window.api.memory.googlePreviewPush()
      setConfirm({ direction: 'push', pushPlan })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally { setBusy(null) }
  }

  const applyConfirm = async (): Promise<void> => {
    if (!confirm) return
    setBusy(confirm.direction === 'pull' ? 'Pulling…' : 'Pushing…')
    try {
      if (confirm.direction === 'pull' && confirm.pullPlan) {
        const result = await window.api.memory.googleApplyPull(confirm.pullPlan)
        if (!result.ok) setError(result.message)
      } else if (confirm.direction === 'push' && confirm.pushPlan) {
        const result = await window.api.memory.googleApplyPush(confirm.pushPlan)
        if (!result.ok) setError(result.message)
      }
      setConfirm(null)
      void refresh()
    } finally { setBusy(null) }
  }

  const fmtTime = (ms: number | null | undefined): string =>
    !ms ? '—' : new Date(ms).toLocaleString()

  const signedIn = status?.signedIn ?? false
  // Render-side check using the build-time constant so the button isn't held
  // disabled while the status IPC roundtrips (or stuck disabled if it fails).
  // The IPC's credentialsConfigured stays as a backstop for OSS builds that
  // strip the constant.
  const credsConfigured =
    !!DEFAULT_GOOGLE_CLIENT_ID || (status?.credentialsConfigured ?? false)
  const syncKinds = memory?.googleSync?.syncKinds ?? { person: true, business: true, website: false, other: false }

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <span className={styles.cardTitle}>Google Contacts sync</span>
        <span
          className={
            signedIn
              ? styles.statusOk
              : credsConfigured
                ? styles.statusMuted
                : styles.statusOff
          }
        >
          {signedIn ? 'signed in' : credsConfigured ? 'signed out' : 'not configured'}
        </span>
      </div>
      <div className={styles.cardSub}>
        Pull contacts from Google into your Memory, or push Memory entities to
        Google. Each direction is a separate, confirmed action — nothing syncs
        in the background.
      </div>

      {signedIn && status?.accountEmail && (
        <div className={styles.row}>
          <span className={styles.label}>Account</span>
          <span className={styles.value}>{status.accountEmail}</span>
        </div>
      )}
      <div className={styles.row}>
        <span className={styles.label}>Last pulled</span>
        <span className={styles.value}>{fmtTime(status?.lastPullAt)}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Last pushed</span>
        <span className={styles.value}>{fmtTime(status?.lastPushAt)}</span>
      </div>

      <div className={styles.fieldRow}>
        <span className={styles.label}>Sync these kinds</span>
        <div className={styles.kindFilterGrid}>
          {CONTACT_KINDS.map((k) => (
            <label key={k} className={styles.kindFilterRow}>
              <input
                type="checkbox"
                checked={!!syncKinds[k]}
                disabled={!memory}
                onChange={(e) => toggleKind(k, e.target.checked)}
              />
              <span className={kindBadgeClass(k)}>{k}</span>
            </label>
          ))}
        </div>
        <div className={styles.hint}>
          Only contacts whose kind is checked here round-trip with Google.
          New contacts pulled from Google default to <em>person</em>; you can
          reclassify them with the dropdown in the editor.
        </div>
      </div>

      {!signedIn && (
        <div className={styles.hint}>
          {credsConfigured
            ? 'Connect a Google account in Settings → Providers to enable sync.'
            : 'Google sync is unavailable in this build.'}
        </div>
      )}

      <div className={styles.btnRow}>
        {!signedIn ? (
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setSettingsTarget('providers')}
            disabled={!credsConfigured}
          >
            Open Providers →
          </button>
        ) : (
          <>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={openPullConfirm}
              disabled={busy !== null}
            >
              Pull from Google…
            </button>
            <button
              className={styles.btn}
              onClick={openPushConfirm}
              disabled={busy !== null}
            >
              Push to Google…
            </button>
          </>
        )}
      </div>

      {busy && <div className={styles.busy}>{busy}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {confirm && (
        <ConfirmModal
          state={confirm}
          busy={busy !== null}
          onCancel={() => setConfirm(null)}
          onApply={applyConfirm}
        />
      )}
    </div>
  )
}

// ── Confirm modal ───────────────────────────────────────────────────────

function ConfirmModal({
  state,
  busy,
  onCancel,
  onApply
}: {
  state: ConfirmState
  busy: boolean
  onCancel: () => void
  onApply: () => void
}): JSX.Element {
  if (state.direction === 'pull' && state.pullPlan) {
    const { fetched, create, update, unchanged, skippedByKind } = state.pullPlan
    const hasChanges = create.length + update.length > 0

    return (
      <div className={styles.modalScrim}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <span className={styles.modalTitle}>Pull from Google · Confirm</span>
          </div>
          <div className={styles.modalBody}>
            <div className={styles.modalSection}>
              Google returned <strong>{fetched}</strong> contact{fetched === 1 ? '' : 's'}.
              {' '}{hasChanges ? 'The following changes will be applied to your local Memory:' : 'Nothing to apply — every contact is already in sync.'}
            </div>
            {create.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionHead}>Will create ({create.length})</div>
                <ul className={styles.modalList}>
                  {create.slice(0, 10).map((c) => (
                    <li key={c.entity}>
                      {c.entity} <span className={kindBadgeClass(c.kind)}>{c.kind}</span>
                    </li>
                  ))}
                  {create.length > 10 && <li>…and {create.length - 10} more</li>}
                </ul>
              </div>
            )}
            {update.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionHead}>Will update ({update.length})</div>
                <ul className={styles.modalList}>
                  {update.slice(0, 10).map((u) => (
                    <li key={u.entity}>
                      {u.entity} <span className={kindBadgeClass(u.kind)}>{u.kind}</span>
                    </li>
                  ))}
                  {update.length > 10 && <li>…and {update.length - 10} more</li>}
                </ul>
              </div>
            )}
            {skippedByKind.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionHead}>Skipped by kind filter ({skippedByKind.length})</div>
                <ul className={styles.modalList}>
                  {skippedByKind.slice(0, 10).map((s) => (
                    <li key={s.entity}>
                      {s.entity} <span className={kindBadgeClass(s.kind)}>{s.kind}</span>
                    </li>
                  ))}
                  {skippedByKind.length > 10 && <li>…and {skippedByKind.length - 10} more</li>}
                </ul>
              </div>
            )}
            {unchanged > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionHead}>Unchanged</div>
                {unchanged} contact{unchanged === 1 ? '' : 's'} already up to date.
              </div>
            )}
          </div>
          <div className={styles.modalFooter}>
            <button className={styles.btn} onClick={onCancel} disabled={busy}>Cancel</button>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onApply}
              disabled={busy || !hasChanges}
            >
              Pull
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (state.direction === 'push' && state.pushPlan) {
    const { localCount, create, skip } = state.pushPlan
    const hasChanges = create.length > 0

    return (
      <div className={styles.modalScrim}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <span className={styles.modalTitle}>Push to Google · Confirm</span>
          </div>
          <div className={styles.modalBody}>
            <div className={styles.modalSection}>
              You have <strong>{localCount}</strong> Memory contact{localCount === 1 ? '' : 's'}.
              {' '}{hasChanges
                ? 'The following will be created in your Google Contacts (name only — bullet notes stay in Memory):'
                : 'Nothing to push — every eligible Memory contact is already in Google.'}
            </div>
            {create.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionHead}>Will create in Google ({create.length})</div>
                <ul className={styles.modalList}>
                  {create.slice(0, 10).map((c) => (
                    <li key={c.entity}>
                      {c.entity} <span className={kindBadgeClass(c.kind)}>{c.kind}</span>
                    </li>
                  ))}
                  {create.length > 10 && <li>…and {create.length - 10} more</li>}
                </ul>
              </div>
            )}
            {skip.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modalSectionHead}>Skipped ({skip.length})</div>
                <ul className={styles.modalList}>
                  {skip.slice(0, 10).map((s) => (
                    <li key={s.entity}>
                      {s.entity} <span className={kindBadgeClass(s.kind)}>{s.kind}</span> — {s.reason}
                    </li>
                  ))}
                  {skip.length > 10 && <li>…and {skip.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>
          <div className={styles.modalFooter}>
            <button className={styles.btn} onClick={onCancel} disabled={busy}>Cancel</button>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onApply}
              disabled={busy || !hasChanges}
            >
              Push
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <></>
}

// ── Top-level component ─────────────────────────────────────────────────

export function ContactsTab(): JSX.Element {
  return (
    <div className={styles.layout}>
      <div className={styles.cardRow}>
        <GoogleSyncCard />
        <ContactsUpdaterCard />
      </div>
      <ContactsEditor />
    </div>
  )
}
