import type { LabeledValue } from '@shared/contactFields'
import styles from '../ContactsPage.module.css'

interface Props {
  label: string
  values: LabeledValue[]
  onChange: (next: LabeledValue[]) => void
  /** Render the value cell as a textarea (used for addresses). */
  multiline?: boolean
  valuePlaceholder?: string
  typePlaceholder?: string
}

export function FieldList({
  label,
  values,
  onChange,
  multiline = false,
  valuePlaceholder = '',
  typePlaceholder = 'type'
}: Props): JSX.Element {
  const setRow = (idx: number, patch: Partial<LabeledValue>): void => {
    onChange(values.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }
  const addRow = (): void => onChange([...values, { value: '', type: null }])
  const removeRow = (idx: number): void => onChange(values.filter((_, i) => i !== idx))

  return (
    <div className={styles.fieldGroup}>
      <div className={styles.fieldGroupHead}>
        <span className={styles.fieldGroupLabel}>{label}</span>
        <button type="button" className={styles.addBtn} onClick={addRow}>+ add</button>
      </div>
      {values.length === 0 && <div className={styles.fieldGroupEmpty}>none</div>}
      {values.map((v, i) => (
        <div key={i} className={styles.fieldRow}>
          {multiline ? (
            <textarea
              className={styles.fieldArea}
              value={v.value}
              placeholder={valuePlaceholder}
              onChange={(e) => setRow(i, { value: e.target.value })}
              rows={2}
            />
          ) : (
            <input
              type="text"
              className={styles.fieldInput}
              value={v.value}
              placeholder={valuePlaceholder}
              onChange={(e) => setRow(i, { value: e.target.value })}
            />
          )}
          <input
            type="text"
            className={styles.fieldType}
            value={v.type ?? ''}
            placeholder={typePlaceholder}
            onChange={(e) => setRow(i, { type: e.target.value.trim() ? e.target.value : null })}
          />
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => removeRow(i)}
            aria-label={`Remove ${label.toLowerCase()} entry`}
            title="Remove"
          >×</button>
        </div>
      ))}
    </div>
  )
}
