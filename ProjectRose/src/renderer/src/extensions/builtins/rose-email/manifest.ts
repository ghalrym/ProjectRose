import type { ExtensionManifest } from '@shared/extension-types'

export const manifest: ExtensionManifest = {
  id: 'rose-email',
  name: 'Email',
  version: '1.6.0',
  description: 'Single-account email — IMAP/SMTP or Gmail. Inbox and compose.',
  author: 'ProjectRose',
  latin: 'Epistula',
  provides: {
    pageView: true,
    globalSettings: true
  }
}
