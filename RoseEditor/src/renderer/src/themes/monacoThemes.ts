import type { editor } from 'monaco-editor'

export const roseDarkTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cba6f7' },
    { token: 'string', foreground: 'a6e3a1' },
    { token: 'number', foreground: 'fab387' },
    { token: 'type', foreground: 'f9e2af' },
    { token: 'function', foreground: '89b4fa' },
    { token: 'variable', foreground: 'cdd6f4' },
    { token: 'constant', foreground: 'fab387' },
    { token: 'operator', foreground: '89dceb' }
  ],
  colors: {
    'editor.background': '#1e1e2e',
    'editor.foreground': '#cdd6f4',
    'editor.lineHighlightBackground': '#313244',
    'editor.selectionBackground': '#45475a',
    'editor.inactiveSelectionBackground': '#313244',
    'editorCursor.foreground': '#f5e0dc',
    'editorWhitespace.foreground': '#45475a',
    'editorIndentGuide.background': '#313244',
    'editorIndentGuide.activeBackground': '#45475a',
    'editorLineNumber.foreground': '#6c7086',
    'editorLineNumber.activeForeground': '#cdd6f4',
    'editor.findMatchBackground': '#f9e2af40',
    'editor.findMatchHighlightBackground': '#f9e2af20',
    'editorGutter.background': '#1e1e2e',
    'minimap.background': '#181825',
    'scrollbarSlider.background': '#31324480',
    'scrollbarSlider.hoverBackground': '#45475a80',
    'scrollbarSlider.activeBackground': '#585b7080'
  }
}

export const roseLightTheme: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '9ca0b0', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8839ef' },
    { token: 'string', foreground: '40a02b' },
    { token: 'number', foreground: 'fe640b' },
    { token: 'type', foreground: 'df8e1d' },
    { token: 'function', foreground: '1e66f5' },
    { token: 'variable', foreground: '4c4f69' },
    { token: 'constant', foreground: 'fe640b' },
    { token: 'operator', foreground: '04a5e5' }
  ],
  colors: {
    'editor.background': '#eff1f5',
    'editor.foreground': '#4c4f69',
    'editor.lineHighlightBackground': '#ccd0da',
    'editor.selectionBackground': '#bcc0cc',
    'editor.inactiveSelectionBackground': '#ccd0da',
    'editorCursor.foreground': '#dc8a78',
    'editorWhitespace.foreground': '#bcc0cc',
    'editorIndentGuide.background': '#ccd0da',
    'editorIndentGuide.activeBackground': '#bcc0cc',
    'editorLineNumber.foreground': '#9ca0b0',
    'editorLineNumber.activeForeground': '#4c4f69',
    'editor.findMatchBackground': '#df8e1d40',
    'editor.findMatchHighlightBackground': '#df8e1d20',
    'editorGutter.background': '#eff1f5',
    'minimap.background': '#e6e9ef',
    'scrollbarSlider.background': '#ccd0da80',
    'scrollbarSlider.hoverBackground': '#bcc0cc80',
    'scrollbarSlider.activeBackground': '#9ca0b080'
  }
}
