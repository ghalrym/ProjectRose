import Editor, { type OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useThemeStore } from '../../stores/useThemeStore'
import { roseDarkTheme, roseHerbariumTheme } from '../../themes/monacoThemes'

loader.config({ monaco })

let themesRegistered = false

// Shared Monaco markdown editor used by Memory > Diary, Memory > Behavior
// Records, and the top-level Contacts tab. Theme is reactive to the renderer
// theme store, font matches the rest of the app's monospace.

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false
}: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}): JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const monacoTheme = theme === 'dark' ? 'rose-dark' : 'rose-herbarium'

  const handleMount: OnMount = (_editor, monacoInstance) => {
    if (!themesRegistered) {
      monacoInstance.editor.defineTheme('rose-dark', roseDarkTheme)
      monacoInstance.editor.defineTheme('rose-herbarium', roseHerbariumTheme)
      themesRegistered = true
    }
    monacoInstance.editor.setTheme(monacoTheme)
  }

  return (
    <Editor
      height="100%"
      language="markdown"
      value={value}
      theme={monacoTheme}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        readOnly,
        fontFamily: theme === 'dark'
          ? "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace"
          : "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        renderLineHighlight: 'none',
        glyphMargin: false,
        folding: false,
        lineNumbers: 'off',
        padding: { top: 12, bottom: 12 }
      }}
    />
  )
}
