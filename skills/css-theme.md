# CSS Theme Reference

Use this when writing UI components for ProjectRose. All visual styling must use these CSS custom properties — never hardcode colors, radii, or font sizes.

---

## Themes

ProjectRose has two themes: `dark` (default) and `herbarium` (warm paper aesthetic). Both define the same variable names, so any component that uses these variables automatically adapts to both themes.

---

## Color variables

### Backgrounds

| Variable | Dark | Herbarium | Use for |
|---|---|---|---|
| `--color-bg-primary` | `#1e1e2e` | `#f1ebdf` | Main content area background |
| `--color-bg-secondary` | `#181825` | `#e8e0d0` | Panels, sidebars, cards |
| `--color-bg-tertiary` | `#11111b` | `#e0d6c0` | Deepest surfaces (terminal, modals) |
| `--color-bg-elevated` | `#313244` | `#f7f2e6` | Tooltips, dropdowns, popovers |
| `--color-sidebar-bg` | `#181825` | `#ebe3d1` | Sidebar background |
| `--color-sidebar-item-hover` | `#313244` | `#e4dbc6` | Sidebar item hover state |
| `--color-sidebar-item-active` | `#45475a` | `#e0d6c0` | Sidebar item selected state |
| `--color-topbar-bg` | `#11111b` | `#f1ebdf` | Top bar background |
| `--color-tab-bg` | `#181825` | `#e8e0d0` | Inactive tab background |
| `--color-tab-active-bg` | `#1e1e2e` | `#f7f2e6` | Active tab background |
| `--color-tab-hover-bg` | `#313244` | `#e0d6c0` | Tab hover state |
| `--color-terminal-bg` | `#11111b` | `#e8e0d0` | Terminal background |
| `--color-chat-user-bg` | `#313244` | `#e8e0d0` | User chat bubble background |
| `--color-chat-assistant-bg` | `#1e1e2e` | `#f1ebdf` | Assistant chat bubble background |

### Text

| Variable | Use for |
|---|---|
| `--color-text-primary` | Main body text, labels |
| `--color-text-secondary` | Supporting text, field labels |
| `--color-text-muted` | Placeholders, disabled text, hints |
| `--color-text-inverse` | Text on accent/dark backgrounds |

### Interactive

| Variable | Use for |
|---|---|
| `--color-accent` | Primary accent, active states, links |
| `--color-accent-hover` | Accent hover state |
| `--color-button-bg` | Default button background |
| `--color-button-hover-bg` | Button hover background |
| `--color-toggle-bg` | Toggle/switch track (off) |
| `--color-toggle-active` | Toggle/switch track (on) |

### Borders

| Variable | Use for |
|---|---|
| `--color-border` | Default border, dividers |
| `--color-border-strong` | Emphasized borders, focus rings |
| `--color-topbar-border` | Top bar bottom border |
| `--color-tab-border` | Tab borders |
| `--color-chat-border` | Chat bubble borders |

### Status

| Variable | Use for |
|---|---|
| `--color-unsaved` | Unsaved indicator (yellow/ochre) |
| `--color-saved` | Saved/success indicator (green/olive) |
| `--color-error` | Error state, destructive actions |

---

## Layout variables

| Variable | Value | Use for |
|---|---|---|
| `--topbar-height` | `40px` / `52px` (herbarium) | Height of the top bar |
| `--tab-height` | `36px` | Height of editor tabs |
| `--sidebar-min-width` | `180px` | Minimum sidebar width |
| `--sidebar-max-width` | `400px` | Maximum sidebar width |
| `--terminal-min-height` | `100px` | Minimum terminal panel height |

---

## Border radius

| Variable | Dark | Herbarium | Use for |
|---|---|---|---|
| `--radius-sm` | `4px` | `1px` | Inputs, small chips |
| `--radius-md` | `6px` | `2px` | Cards, panels, buttons |
| `--radius-lg` | `8px` | `3px` | Modals, large containers |

Herbarium uses near-flat radii intentionally — use these variables and the theme handles it automatically.

---

## Typography

| Variable | Use for |
|---|---|
| `--font-family-ui` | All UI text (`-apple-system` / `IBM Plex Mono` in herbarium) |
| `--font-family-mono` | Code, terminal output |
| `--font-size-sm` | `12px` — small labels, metadata |
| `--font-size-md` | `13px` — default body text |
| `--font-size-lg` | `14px` — slightly emphasized text |

---

## Usage patterns

### In CSS Modules (preferred)

```css
.container {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
}

.label {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.button {
  background: var(--color-button-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
}

.button:hover {
  background: var(--color-button-hover-bg);
}
```

### In inline styles (extension components)

Extensions often use inline styles because they don't go through the Vite build pipeline:

```tsx
const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
  },
  title: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: 'var(--color-text-muted)',
    marginBottom: 12,
  },
  input: {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    boxSizing: 'border-box',
  },
  btn: {
    padding: '6px 14px',
    background: 'var(--color-button-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontSize: 12,
    cursor: 'pointer',
  },
}
```

---

## Do not

- Do not hardcode hex colors — they break in the other theme.
- Do not use Tailwind or any external CSS framework — not installed.
- Do not invent variable names (e.g. `--bg-color`, `--text-color`) — they will be `undefined`.
