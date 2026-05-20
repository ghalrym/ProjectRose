# Changelog

## Unreleased

### Breaking — Agent state moves to `~/.rose/`

ProjectRose now stores the Agent's identity, model/provider config, installed
extensions, and recent-workspaces list at `~/.rose/` (Windows:
`C:\Users\<you>\.rose\`). The previous machine-level store at
`app.getPath('userData')` and the workspace-level `<ws>/.projectrose/config.json`
are no longer read. Extensions install once globally at `~/.rose/extensions/<id>/`
and are enabled/disabled and configured per workspace.

There is **no automatic migration**. Follow these steps once before launching
the new build:

1. **Back up any existing workspace data at `~/.rose/`.** If `~/.rose/` is being
   used as a workspace folder on your machine (it was the default workspace
   suggestion in prior versions), copy `~/.rose/.projectrose/` somewhere safe.
2. **Delete `~/.rose/`.** The new build creates it fresh as the Agent home.
   Anything at that path that is not the new layout will be ignored.
3. **(Optional) Move your `app.getPath('userData')/settings.json` providerKeys
   into the new `~/.rose/settings.json`** after first launch. The first launch
   writes a default file you can edit, or use the Settings panel.
4. **Pick a workspace folder explicitly on launch.** There is no default; the
   open-folder dialog will prompt every time the app cannot resume a recent
   workspace. The WelcomeView is the new entry point when no workspace is open.
5. **Reinstall first-party extensions.** Per-workspace extension installs from
   prior versions are not migrated. Extensions now install to
   `~/.rose/extensions/<id>/`; they default to **enabled** in the workspace
   where you install them and **disabled** in every other workspace.
6. **Per-extension settings (accounts, profiles, etc.) are now per-workspace.**
   Re-enter them in each workspace where you want the extension active.

If you have the developer symlink `Desktop/ProjectRose/.rose ->
/c/Users/Andrew/.rose` from prior local setup, delete it — `~/.rose/` is no
longer a workspace.

See `docs/adr/0003-single-agent-collapse.md`, `0004-rose-agent-home.md`,
`0005-extension-model.md`, and `0006-no-default-workspace.md` for the rationale.
