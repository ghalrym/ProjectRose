import { useEffect, useState, useCallback } from 'react'
import styles from './AccountView.module.css'

interface AuthStatus {
  loggedIn: boolean
  email: string
  name: string
  avatar: string
}

type Mode = 'idle' | 'pending'

export function AccountView(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>({ loggedIn: false, email: '', name: '', avatar: '' })
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('idle')
  const [pairingUrl, setPairingUrl] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.api.auth.getStatus()
      setStatus(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const offChanged = window.api.auth.onChanged((data) => {
      setStatus({ loggedIn: data.loggedIn, email: data.email, name: data.name, avatar: data.avatar })
      setMode('idle')
      setPairingUrl('')
      setError('')
    })
    const offPending = window.api.auth.onPairingPending((data) => {
      setPairingUrl(data.url)
      setMode('pending')
      setError('')
    })
    return () => { offChanged(); offPending() }
  }, [fetchStatus])

  async function handleLogin() {
    setError('')
    setMode('pending')
    try {
      await window.api.auth.login()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
      setMode('idle')
      setPairingUrl('')
    }
  }

  async function handleCancel() {
    try { await window.api.auth.cancel() } catch { /* ignore */ }
    setMode('idle')
    setPairingUrl('')
  }

  async function handleLogout() {
    try {
      await window.api.auth.logout()
    } finally {
      setMode('idle')
    }
  }

  async function handleCopyLink() {
    if (!pairingUrl) return
    try {
      await navigator.clipboard.writeText(pairingUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore — the user can long-press the link instead
    }
  }

  if (loading) {
    return <div className={styles.container}><p className={styles.muted}>Loading...</p></div>
  }

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div className={styles.label}>ACCOUNT</div>
        <h2 className={styles.heading}>ProjectRose Account</h2>
      </div>

      {status.loggedIn ? (
        <>
          <div className={styles.section}>
            {status.avatar && (
              <div className={styles.avatarRow}>
                <img className={styles.avatar} src={status.avatar} alt="" />
                <div className={styles.identity}>
                  {status.name && <div className={styles.identityName}>{status.name}</div>}
                  <div className={styles.identityEmail}>{status.email}</div>
                </div>
              </div>
            )}
            {!status.avatar && (
              <>
                {status.name && (
                  <div className={styles.row}>
                    <span className={styles.field}>Name</span>
                    <span className={styles.value}>{status.name}</span>
                  </div>
                )}
                <div className={styles.row}>
                  <span className={styles.field}>Email</span>
                  <span className={styles.value}>{status.email}</span>
                </div>
              </>
            )}
          </div>

          <div className={styles.section}>
            <button
              className={styles.btnSecondary}
              onClick={handleLogout}
            >
              SIGN OUT →
            </button>
          </div>
        </>
      ) : mode === 'pending' ? (
        <>
          <div className={styles.section}>
            <p className={styles.description}>
              Browser opened — finish authorization there. This window will update automatically.
            </p>
            {pairingUrl && (
              <p className={styles.muted}>
                If your browser didn’t open,{' '}
                <button type="button" className={styles.linkButton} onClick={handleCopyLink}>
                  {copied ? 'COPIED' : 'COPY LINK'}
                </button>
                {' '}and paste it into your browser.
              </p>
            )}
          </div>
          <div className={styles.section}>
            <button className={styles.btnSecondary} onClick={handleCancel}>
              CANCEL →
            </button>
          </div>
        </>
      ) : (
        <div className={styles.section}>
          <p className={styles.description}>
            Sign in to use the managed AI endpoint backed by your ProjectRose subscription.
            Your chat will route through our servers — no API keys needed.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <button
            className={styles.btnPrimary}
            onClick={handleLogin}
          >
            SIGN IN →
          </button>
        </div>
      )}
    </div>
  )
}
