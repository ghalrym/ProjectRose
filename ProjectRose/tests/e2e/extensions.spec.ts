import { test, expect } from './fixtures/electron'
import type { ElectronApplication } from 'playwright'
import { createSeedProject, openProject } from './fixtures/project'
import { screenshot } from './fixtures/screenshot'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

// Extension code now lives once in the agent-global install dir
// (~/.rose/extensions/<id>/) and per-workspace state lives under
// <rootPath>/.projectrose/extensions/<id>/state.json. Staging mirrors both.
async function getAgentHome(app: ElectronApplication): Promise<string> {
  return await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
}

// IDs staged into the agent install dir within a test, removed after.
const stagedExtensionIds = new Set<string>()

test.afterEach(async ({ app }) => {
  if (stagedExtensionIds.size === 0) return
  const home = await getAgentHome(app)
  for (const id of stagedExtensionIds) {
    try { rmSync(join(home, '.rose', 'extensions', id), { recursive: true, force: true }) } catch { /* ignore */ }
  }
  stagedExtensionIds.clear()
})

// Stub out the two-step install IPCs so the renderer's INSTALL button:
//   1) installPreviewFromGit -> returns a fake token + the manifest the test
//      will stage on disk (no real git clone),
//   2) installConfirm        -> returns ok (no real build/move).
// After installConfirm the renderer re-fetches via extension:list, which goes
// to the real handler and reads whatever stageFakeExtension wrote to disk.
async function mockInstallHandler(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ['extension:installFromGit', 'extension:installPreviewFromGit', 'extension:installConfirm']) {
      try { ipcMain.removeHandler(channel) } catch { /* not registered */ }
    }
    ipcMain.handle('extension:installFromGit', async () => ({ ok: true }))
    ipcMain.handle('extension:installPreviewFromGit', async () => ({
      ok: true,
      token: 'test-token',
      manifest: {
        id: 'rose-preview-stub',
        name: 'Preview Stub',
        version: '0.1.0',
        description: 'Stub manifest returned by mocked preview IPC',
        author: 'Test',
        provides: { pageView: true }
      }
    }))
    ipcMain.handle('extension:installConfirm', async () => ({ ok: true }))
  })
}

// Write a minimal fake extension into the agent install dir
// (<agentHome>/.rose/extensions/<id>/) and opt the workspace into it via
// state.json. Must be called AFTER the Extensions tab's initial loadInstalled
// resolves so the renderer's "newly added" detection fires.
function stageFakeExtension(agentHome: string, rootPath: string, id: string, name: string): void {
  stagedExtensionIds.add(id)

  const installDir = join(agentHome, '.rose', 'extensions', id)
  mkdirSync(installDir, { recursive: true })

  const manifest = {
    id,
    name,
    version: '0.1.0',
    description: `Test extension: ${name}`,
    author: 'Test',
    navItem: { label: name, iconName: 'test' },
    provides: { pageView: true, globalSettings: true, main: false }
  }
  writeFileSync(join(installDir, 'rose-extension.json'), JSON.stringify(manifest))

  const rendererCode = `"use strict";
const React = require('react');
function PageView() { return React.createElement('div', null, '${name} Page'); }
function SettingsView() { return React.createElement('div', { 'data-testid': '${id}-settings' }, '${name} Settings Panel'); }
exports.PageView = PageView;
exports.SettingsView = SettingsView;
`
  writeFileSync(join(installDir, 'renderer.js'), rendererCode)

  // Per-workspace opt-in overlay. listInstalledExtensions defaults missing
  // overlays to disabled, so without this the row would render as Enable
  // rather than Disable.
  const overlayDir = join(rootPath, '.projectrose', 'extensions', id)
  mkdirSync(overlayDir, { recursive: true })
  writeFileSync(join(overlayDir, 'state.json'), JSON.stringify({ enabled: true }))
}

// Open the dock Settings shortcut, expand the Extensions sidebar item, wait
// for the install form (now rendered directly on the Extensions page — no
// separate Manage tab anymore), stage the extension on disk, then submit the
// URL form. The mocked preview IPC returns ok + a token so the renderer
// shows the install confirmation dialog; we click its INSTALL button to
// finalize. After confirm, the renderer re-fetches via extension:list,
// picking up the staged extension as newly installed.
async function installViaUrlForm(
  win: import('playwright').Page,
  stage: () => void
): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
  await win.waitForTimeout(500)
  stage()
  await win.getByPlaceholder(/github\.com/).fill('https://example.test/repo.git')
  await win.getByRole('button', { name: /^INSTALL$/ }).first().click()
  // The mocked preview IPC opens an install-confirmation dialog. Click its
  // INSTALL button (scoped to the dialog so it can't match the URL form's).
  const dialog = win.getByRole('dialog', { name: /^Install / })
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  await dialog.getByRole('button', { name: /^INSTALL$/ }).click()
  await win.waitForTimeout(1500)
}

test.describe('Extension System', () => {
  test.describe('install and lifecycle', () => {
    test('extensions tab shows install panel when project is open', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await win.getByRole('button', { name: 'Settings', exact: true }).click()
      await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
      await expect(win.getByText('INSTALL FROM GIT')).toBeVisible({ timeout: 5000 })
      await expect(win.getByPlaceholder(/github\.com/)).toBeVisible()
      await screenshot(win, 'extensions--empty')
    })

    test('installing an extension adds it to the list', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-test-ext', 'Test Extension'))

      // Switch to Installed tab and verify the row is there
      await win.getByRole('button', { name: /^Installed/ }).click()
      await expect(win.getByRole('button', { name: 'Disable', exact: true })).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--installed')
    })

    test('installed extension appears in apps drawer', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-navtest', 'Nav Test'))

      // Open the AppsDrawer and confirm the extension shows up as a card. Cards
      // have an accessible name that begins with a "№XX " specimen prefix —
      // distinct from the settings sidebar entry (just "Nav Test").
      await win.getByRole('button', { name: 'Open apps' }).click()
      await expect(win.getByRole('button', { name: /^№\d+.*Nav Test/ })).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--app-card')
    })
  })

  test.describe('settings panel', () => {
    test('installed extension with globalSettings exposes a cog button in the apps drawer', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-settingstest', 'Settings Test'))

      // Extension settings are accessed via the per-extension cog button in
      // the AppsDrawer sidebar (no longer a SettingsView sidebar entry).
      await win.getByRole('button', { name: 'Open apps' }).click()
      await expect(win.getByRole('button', { name: 'Settings Test settings', exact: true })).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--settings-sidebar')
    })

    test('clicking the cog button renders SettingsView in the main pane', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-settingspanel', 'Panel Test'))

      await win.getByRole('button', { name: 'Open apps' }).click()
      await win.getByRole('button', { name: 'Panel Test settings', exact: true }).click()

      // The extension's SettingsView should render in the main pane
      await expect(win.locator('[data-testid="rose-settingspanel-settings"]')).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--settings-panel')
    })
  })

  test.describe('disable / uninstall', () => {
    test('disabling an extension keeps it in list but marks it disabled', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-disabletest', 'Disable Test'))

      await win.getByRole('button', { name: /^Installed/ }).click()
      await win.getByRole('button', { name: 'Disable', exact: true }).click()
      await win.waitForTimeout(500)

      await expect(win.getByRole('button', { name: 'Enable', exact: true })).toBeVisible({ timeout: 3000 })
      await screenshot(win, 'extensions--disabled')
    })

    test('uninstalling an extension removes it from the list', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-removetest', 'Removable Test'))

      await win.getByRole('button', { name: /^Installed/ }).click()
      await win.getByRole('button', { name: 'Uninstall', exact: true }).click()
      await win.waitForTimeout(500)

      // Two elements match this text after uninstall: the ExtensionsTab inline
      // empty state and the AppsDrawer's emptyTitle. Scope to the ExtensionsTab
      // copy by anchoring on the rest of its sentence.
      await expect(win.getByText(/No extensions installed\. Switch to Discover/)).toBeVisible({ timeout: 3000 })
      await screenshot(win, 'extensions--uninstalled')
    })
  })

  test.describe('settings sidebar core items always present', () => {
    test('core settings pages are always in sidebar regardless of extensions', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await win.getByRole('button', { name: 'Settings', exact: true }).click()
      const sidebar = win.getByRole('complementary')
      // Sidebar items include a №XX prefix in their accessible name
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+General$/ })).toBeVisible({ timeout: 5000 })
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+Providers$/ })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+Tools$/ })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+Skills$/ })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: /Extensions/ })).toBeVisible()
    })
  })
})
