// rose-email — second built-in extension.
//
// Pattern mirrors rose-contacts: manifest + PageView + SettingsView are
// statically imported here and registered in
// src/renderer/src/extensions/builtins/index.ts.

export { manifest } from './manifest'
export { InboxPage as PageView } from './InboxPage'
export { EmailSettings as SettingsView } from './EmailSettings'
