import type { ExtensionManifest } from '@shared/extension-types'

// Renderer-side manifest for rose-routines. The main-process side
// (`src/main/extensions/builtins/rose-routines/main.ts`) declares an
// identical manifest — they must match because they are the two halves of
// the same built-in. The renderer manifest is what BUILTIN_EXTENSIONS
// publishes to the App Board.
export const manifest: ExtensionManifest = {
  id: 'rose-routines',
  name: 'Routines',
  version: '1.0.0',
  description:
    'Recurring prompts that fire the Agent on a calendar schedule. Each fire is saved for audit.',
  author: 'ProjectRose',
  latin: 'Rota',
  navItem: { label: 'Routines', iconName: 'clock' },
  provides: {
    pageView: true,
    main: true,
    detachedRunWithTools: true,
    notifyStatus: true,
    broadcast: true
  }
}
