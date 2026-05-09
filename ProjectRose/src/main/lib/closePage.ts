function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

export function renderClosePage(error: string | null): string {
  const isError = error !== null && error !== undefined
  const heading = isError ? 'Sign-in failed' : 'You can close this tab'
  const body = isError
    ? `Return to ProjectRose and try again.<br><span class="reason">${escape(error)}</span>`
    : 'Return to ProjectRose — you’re signed in.'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ProjectRose &middot; ${escape(heading)}</title>
<style>
  :root { --paper: #f6efe2; --ink: #2a2620; --ink-soft: #6b5e4e; --sepia: #8a6a3a; --line: #d8ccb6; }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: ui-serif, Georgia, "Times New Roman", serif; }
  .card { max-width: 460px; padding: 40px; border: 1px solid var(--line); background: var(--paper); }
  .label { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; font-size: 10px; letter-spacing: 1.6px; color: var(--ink-soft); margin-bottom: 12px; text-transform: uppercase; }
  h1 { font-size: 22px; font-weight: 400; letter-spacing: -0.4px; margin: 0 0 16px; }
  p { font-size: 14px; line-height: 1.6; color: var(--ink-soft); margin: 0; }
  .reason { display: inline-block; margin-top: 8px; font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; font-size: 12px; color: var(--sepia); }
</style>
</head>
<body>
  <div class="card">
    <div class="label">ProjectRose</div>
    <h1>${escape(heading)}</h1>
    <p>${body}</p>
  </div>
  <script>try { window.close() } catch (_) {}</script>
</body>
</html>`
}
