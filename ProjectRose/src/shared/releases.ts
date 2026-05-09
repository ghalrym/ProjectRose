export interface ReleaseEntry {
  version: string
  tag: string | null
  date: string | null
  title: string
  highlights: string[]
  unreleased?: boolean
}

export const RELEASES: ReleaseEntry[] = [
  {
    version: '1.5.0',
    tag: null,
    date: null,
    title: 'Account sign-in, Concrete CMS, and compression-toast fix',
    unreleased: true,
    highlights: [
      'Account sign-in flow connects to a hosted server for API access — no manual provider-key entry required',
      'Bottom dock button can be repositioned to your preferred spot',
      'New Concrete CMS extension available in the in-app discovery page',
      'Fix: chat compression toast no longer cycles — clicking Compress now hides the toast and the reported context usage reflects the post-compression view'
    ]
  },
  {
    version: '1.4.0',
    tag: null,
    date: null,
    title: 'Screen sharing, redesigned navigation, and new extensions',
    unreleased: true,
    highlights: [
      'Chat composer can share a screen, a window, or a camera feed with the agent',
      'A fresh frame is attached automatically to each message you send while sharing is on',
      'Live preview tile shows what the agent will see before you send',
      'Agent can take its own screenshots while working on screenshare-based tasks',
      'Redesigned navigation with a bottom dock and an apps drawer that pulls up from the menu bar',
      'Chat can open in full or half-screen view',
      'Settings button is now a cogwheel; agent and settings split out of the apps drawer',
      'New WordPress and Bond extensions, available in the in-app discovery page',
      'Extensions can mark individual tools as off-by-default',
      'Project opening no longer shows the app bar or breadcrumb'
    ]
  },
  {
    version: '1.3.1',
    tag: null,
    date: null,
    title: 'Extension prompts and session-aware extensions',
    unreleased: true,
    highlights: [
      'Auto-update no longer forced — users can defer or skip versions',
      'Extensions can ship their own prompts',
      'Session id is passed to extensions so they can react to fresh user turns',
      'Coding harness extension added',
      'System tray supports closing the app',
      'Chat panel is now expandable',
      'adjustable active listening timer'
    ]
  },
  {
    version: '1.2.3',
    tag: 'v1.2.3-build.37',
    date: '2026-05-01',
    title: 'TTS extracted, two new bundled extensions',
    highlights: [
      'TTS removed from base app and moved to a dedicated extension',
      'New vllm-omni TTS extension',
      'Two additional extensions added to the base install set',
      'Auto-update issue with locating the build artifact fixed',
      'TTS test suite stabilized'
    ]
  },
  {
    version: '1.2.2',
    tag: 'v1.2.2-build.34',
    date: '2026-04-30',
    title: 'Previous-session view and auto-update infrastructure',
    highlights: [
      'View previous active sessions',
      'Auto-update infrastructure landed',
      'Project picker dropdown'
    ]
  },
  {
    version: '1.2.0',
    tag: 'v1.2.0-build.33',
    date: '2026-04-29',
    title: 'Dead-code purge and indexing cleanup',
    highlights: [
      'Large removal of dead code',
      'Indexing and project tools cleanup'
    ]
  },
  {
    version: '1.1.5',
    tag: 'v1.1.5-build.32',
    date: '2026-04-29',
    title: 'on_user_message hook and status bar polish',
    highlights: [
      'New on_user_message extension hook lets extensions reset state on fresh user turns',
      'Injections can now be collapsed in the chat',
      'Fix: status bar contributions from extensions were not rendering',
      'Status bar shows the build version',
      'Fix: non-viewable extensions no longer appear in navigation'
    ]
  },
  {
    version: '1.1.0',
    tag: 'v1.1.0-build.31',
    date: '2026-04-29',
    title: 'Chat hook infrastructure',
    highlights: [
      'Chat hook infrastructure for extensions',
      'Settings navigation improvements',
      'Fixed text input bug where the cursor would reset',
      'User-facing error message when no provider is configured',
      'Updated screenshots'
    ]
  },
  {
    version: '1.0.3-build.30',
    tag: 'v1.0.3-build.30',
    date: '2026-04-29',
    title: 'Documentation correction',
    highlights: ['Documentation correction']
  },
  {
    version: '1.0.3-build.29',
    tag: 'v1.0.3-build.29',
    date: '2026-04-29',
    title: 'GitHub Pages site update',
    highlights: ['GitHub Pages site update', 'Test fixes']
  },
  {
    version: '1.0.2-build.27',
    tag: 'v1.0.2-build.27',
    date: '2026-04-28',
    title: 'Initial tagged release',
    highlights: [
      'First tagged build with the auto-update channel wired up',
      'Build configuration corrected for proper versioning',
      'Discover page and install-from-disk extension flow'
    ]
  }
]
