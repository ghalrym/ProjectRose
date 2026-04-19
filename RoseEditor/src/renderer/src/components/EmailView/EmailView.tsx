import { useEffect } from 'react'
import clsx from 'clsx'
import { useEmailStore } from '../../stores/useEmailStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useViewStore } from '../../stores/useViewStore'
import styles from './EmailView.module.css'

function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

export function EmailView(): JSX.Element {
  const imapHost = useSettingsStore((s) => s.imapHost)
  const imapUser = useSettingsStore((s) => s.imapUser)
  const setActiveView = useViewStore((s) => s.setActiveView)

  const { messages, selectedUid, body, loading, bodyLoading, error,
          fetchMessages, fetchMessage, deleteMessage } = useEmailStore()

  const isConfigured = Boolean(imapHost && imapUser)

  useEffect(() => {
    if (isConfigured) fetchMessages()
  }, [isConfigured])

  const selectedMessage = messages.find((m) => m.uid === selectedUid) ?? null

  function handleSelectMessage(uid: number): void {
    fetchMessage(uid)
  }

  async function handleDelete(): Promise<void> {
    if (selectedUid == null) return
    await deleteMessage(selectedUid)
  }

  if (!isConfigured) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span>Configure IMAP credentials in Settings to view email.</span>
          <button className={styles.emptyBtn} onClick={() => setActiveView('settings')}>
            Open Settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarAccount}>{imapUser}</span>
        <button className={styles.toolbarBtn} onClick={() => fetchMessages()} disabled={loading}>
          Refresh
        </button>
        <button
          className={clsx(styles.toolbarBtn, styles.toolbarBtnDanger)}
          onClick={handleDelete}
          disabled={selectedUid == null || loading}
        >
          Delete
        </button>
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.split}>
        <div className={styles.listPane}>
          <div className={styles.listHeader}>Inbox</div>
          {loading ? (
            <div className={styles.spinner}>Loading…</div>
          ) : (
            <div className={styles.list}>
              {messages.length === 0 && (
                <div className={styles.spinner}>No messages</div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.uid}
                  className={clsx(styles.messageRow, selectedUid === msg.uid && styles.messageRowActive)}
                  onClick={() => handleSelectMessage(msg.uid)}
                >
                  <div className={clsx(styles.messageSubject, !msg.read && styles.messageSubjectUnread)}>
                    {msg.subject}
                  </div>
                  <div className={styles.messageMeta}>
                    {msg.from} · {formatDate(msg.date)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.bodyPane}>
          {selectedMessage ? (
            <>
              <div className={styles.bodyHeader}>
                <div className={styles.bodyHeaderSubject}>{selectedMessage.subject}</div>
                <div className={styles.bodyHeaderRow}>
                  <span className={styles.bodyHeaderLabel}>From</span>
                  <span className={styles.bodyHeaderValue}>{selectedMessage.from}</span>
                </div>
                <div className={styles.bodyHeaderRow}>
                  <span className={styles.bodyHeaderLabel}>Date</span>
                  <span className={styles.bodyHeaderValue}>{formatDate(selectedMessage.date)}</span>
                </div>
              </div>
              <div className={styles.bodyScroll}>
                {bodyLoading ? (
                  <div className={styles.spinner}>Loading…</div>
                ) : (
                  <pre className={styles.bodyText}>{body ?? ''}</pre>
                )}
              </div>
            </>
          ) : (
            <div className={styles.bodyEmpty}>Select a message to read it</div>
          )}
        </div>
      </div>
    </div>
  )
}
