// rose-contacts — first built-in extension.
//
// Built-in extensions ship inside the host repo and are statically registered
// at startup via src/renderer/src/extensions/builtins/index.ts. They implement
// the same RendererExtension contract as user-installed extensions (manifest +
// PageView + optional SettingsView), but are always loaded, always enabled, and
// cannot be uninstalled.

export { manifest } from './manifest'
export { ContactsPage as PageView } from './ContactsPage'
export { ContactsSettings as SettingsView } from './ContactsSettings'
