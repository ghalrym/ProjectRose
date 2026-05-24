import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CompressionSnapshot } from '../../types/chatMessages'
import styles from './CompressedTurns.module.css'

interface Props {
  snapshot: CompressionSnapshot
  // The fully-rendered cells for the turns that were folded into the summary.
  children: ReactNode
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

// Collapses the compressed prefix of the conversation behind a single divider.
// Default-collapsed so it's immediately obvious those turns were summarised;
// the user can expand to read the originals (still kept verbatim in state).
export function CompressedTurns({ snapshot, children }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const n = snapshot.compressedTurnCount
  const label =
    n != null ? `${n} older ${n === 1 ? 'turn' : 'turns'} compressed` : 'Older turns compressed'
  const time = formatTime(snapshot.compressedAt)

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        title={expanded ? 'Hide compressed turns' : 'Show compressed turns'}
      >
        <span className={styles.rule} aria-hidden="true" />
        <span className={styles.chevron} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className={styles.label}>
          {label}
          {time && <span className={styles.time}> · {time}</span>}
        </span>
        <span className={styles.rule} aria-hidden="true" />
      </button>
      {expanded && <div className={styles.body}>{children}</div>}
    </div>
  )
}
