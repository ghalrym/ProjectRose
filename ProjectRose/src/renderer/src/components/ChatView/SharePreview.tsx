import { useEffect, useRef } from 'react'
import { useScreenWebcamShare } from '../../hooks/useScreenWebcamShare'
import styles from './SharePreview.module.css'

export function SharePreview(): JSX.Element | null {
  const mode = useScreenWebcamShare((s) => s.mode)
  const stream = useScreenWebcamShare((s) => s.stream)
  const sourceLabel = useScreenWebcamShare((s) => s.sourceLabel)
  const stop = useScreenWebcamShare((s) => s.stop)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.srcObject = stream
    if (stream) {
      v.play().catch(() => { /* autoplay blocked */ })
    }
    return () => { v.srcObject = null }
  }, [stream])

  if (mode === 'off' || !stream) return null

  return (
    <div className={styles.bar}>
      <video
        ref={videoRef}
        className={styles.video}
        muted
        playsInline
        autoPlay
      />
      <div className={styles.meta}>
        <span className={styles.kind}>{mode === 'screen' ? '🖥 Sharing' : '📷 Camera'}</span>
        <span className={styles.label} title={sourceLabel ?? ''}>{sourceLabel}</span>
        <span className={styles.hint}>A frame is attached to each message you send.</span>
      </div>
      <button className={styles.stopBtn} onClick={stop} title="Stop sharing">✕</button>
    </div>
  )
}
