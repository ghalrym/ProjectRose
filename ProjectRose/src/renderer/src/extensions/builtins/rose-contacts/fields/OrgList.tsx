import styles from '../ContactsPage.module.css'

export interface OrgEntry {
  name: string
  title?: string
}

interface Props {
  values: OrgEntry[]
  onChange: (next: OrgEntry[]) => void
}

/**
 * Organisations are stored as positionally-paired bullets in the contact file:
 *
 *   - org: Acme
 *   - title: CEO
 *
 * The Nth title attaches to the Nth org on parse. The editor models them
 * together so a "+ add" call adds both an org slot and a (blank) title slot,
 * and a removal removes the pair as a unit — keeping the on-disk pairing
 * stable across edits.
 */
export function OrgList({ values, onChange }: Props): JSX.Element {
  const setRow = (idx: number, patch: Partial<OrgEntry>): void => {
    onChange(values.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }
  const addRow = (): void => onChange([...values, { name: '', title: '' }])
  const removeRow = (idx: number): void => onChange(values.filter((_, i) => i !== idx))

  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldGroupHead}>
        <span className={styles.fieldGroupLabel}>Organizations</span>
        <button type="button" className={styles.addBtn} onClick={addRow}>+ add</button>
      </div>
      {values.length === 0 && <div className={styles.fieldGroupEmpty}>none</div>}
      {values.map((v, i) => (
        <div key={i} className={styles.fieldRow}>
          <input
            type="text"
            className={styles.fieldInput}
            value={v.name}
            placeholder="Organization"
            onChange={(e) => setRow(i, { name: e.target.value })}
          />
          <input
            type="text"
            className={styles.fieldType}
            value={v.title ?? ''}
            placeholder="Title"
            onChange={(e) => setRow(i, { title: e.target.value })}
          />
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => removeRow(i)}
            aria-label="Remove organization"
            title="Remove"
          >×</button>
        </div>
      ))}
    </div>
  )
}
