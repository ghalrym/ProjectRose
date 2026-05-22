import type { RendererExtension } from '../registry'
import * as roseContacts from './rose-contacts'

// Built-in extensions — ship inside the host repo, register at module load,
// always enabled, cannot be uninstalled. See docs/adr/0010-built-in-extensions.md
// for the architectural contract and `rose-contacts/` for the reference
// implementation.
//
// Order in this array determines order in the App Board sidebar — built-ins
// always render before user-installed extensions.
export const BUILTIN_EXTENSIONS: RendererExtension[] = [
  {
    manifest: roseContacts.manifest,
    PageView: roseContacts.PageView,
    SettingsView: roseContacts.SettingsView,
    provenance: 'builtin'
  }
]
