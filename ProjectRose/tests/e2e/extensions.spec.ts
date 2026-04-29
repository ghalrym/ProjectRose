import { test, expect } from './fixtures/electron'
import type { ElectronApplication } from 'playwright'
import { createSeedProject, openProject } from './fixtures/project'
import { screenshot } from './fixtures/screenshot'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// Replace the install-from-git IPC handler with a no-op that returns success.
// The actual extension files are staged from the test process via stageFakeExtension.
async function mockInstallHandler(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('extension:installFromGit')
    ipcMain.handle('extension:installFromGit', async () => ({ ok: true }))
  })
}

// Write a minimal fake extension into <rootPath>/.projectrose/extensions/<id>/.
// Must be called AFTER the Extensions tab's initial loadInstalled() resolves
// (with the empty list) — otherwise the renderer's "newly added" detection
// won't fire and the nav item won't register.
function stageFakeExtension(rootPath: string, id: string, name: string): void {
  const extDir = join(rootPath, '.projectrose', 'extensions', id)
  mkdirSync(extDir, { recursive: true })

  const manifest = {
    id,
    name,
    version: '0.1.0',
    description: `Test extension: ${name}`,
    author: 'Test',
    navItem: { label: name, iconName: 'test' },
    provides: { pageView: true, globalSettings: true, main: false }
  }
  writeFileSync(join(extDir, 'rose-extension.json'), JSON.stringify(manifest))

  const rendererCode = `"use strict";
const React = require('react');
function PageView() { return React.createElement('div', null, '${name} Page'); }
function SettingsView() { return React.createElement('div', { 'data-testid': '${id}-settings' }, '${name} Settings Panel'); }
exports.PageView = PageView;
exports.SettingsView = SettingsView;
`
  writeFileSync(join(extDir, 'renderer.js'), rendererCode)
}

// Open Settings → Extensions, let the initial (empty) list load resolve,
// run the staging callback to write the fake extension to disk, then paste
// a fake URL and click the URL form's INSTALL button (the first — catalog
// rows have their own INSTALL buttons below). The IPC handler returns ok,
// the renderer re-lists, and the staged extension is detected as "new".
async function installViaUrlForm(
  win: import('playwright').Page,
  stage: () => void
): Promise<void> {
  await win.getByRole('button', { name: /^№\d+\s+SETTINGS$/ }).click()
  // Sidebar Extensions toggle expands the submenu; Manage opens the install panel
  await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
  await win.getByRole('button', { name: 'Manage', exact: true }).click()
  // Wait for ExtensionsTab's initial loadInstalled() to settle with empty result
  await win.waitForTimeout(500)
  stage()
  await win.getByPlaceholder(/github\.com/).fill('https://example.test/repo.git')
  await win.getByRole('button', { name: /^INSTALL$/ }).first().click()
  await win.waitForTimeout(1500)
}

test.describe('Extension System', () => {
  test.describe('install and lifecycle', () => {
    test('extensions tab shows install panel when project is open', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await win.getByRole('button', { name: /^№\d+\s+SETTINGS$/ }).click()
      await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
      await win.getByRole('button', { name: 'Manage', exact: true }).click()
      await expect(win.getByText('INSTALL FROM GIT')).toBeVisible({ timeout: 5000 })
      await expect(win.getByPlaceholder(/github\.com/)).toBeVisible()
      await screenshot(win, 'extensions--empty')
    })

    test('installing an extension adds it to the list', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-test-ext', 'Test Extension'))

      // Switch to Installed tab and verify the row is there
      await win.getByRole('button', { name: /^Installed/ }).click()
      await expect(win.getByRole('button', { name: 'Disable', exact: true })).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--installed')
    })

    test('installed extension appears in nav bar', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-navtest', 'Nav Test'))

      // The extension's nav label should appear as a nav button (format: №XX NAV TEST)
      await expect(win.getByRole('button', { name: /^№\d+ NAV TEST$/ })).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--nav-item')
    })
  })

  test.describe('settings panel', () => {
    test('installed extension with globalSettings appears in settings sidebar', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-settingstest', 'Settings Test'))

      // After install we're on the Extensions submenu's Manage page; the
      // submenu auto-expands so the extension's settings entry is visible.
      await expect(win.getByRole('button', { name: /Settings Test/ })).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--settings-sidebar')
    })

    test('clicking extension settings sidebar item renders SettingsView', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-settingspanel', 'Panel Test'))

      await win.getByRole('button', { name: /Panel Test/ }).click()

      // The extension's SettingsView should render
      await expect(win.locator('[data-testid="rose-settingspanel-settings"]')).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'extensions--settings-panel')
    })
  })

  test.describe('disable / uninstall', () => {
    test('disabling an extension keeps it in list but marks it disabled', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-disabletest', 'Disable Test'))

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

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-removetest', 'Removable Test'))

      await win.getByRole('button', { name: /^Installed/ }).click()
      await win.getByRole('button', { name: 'Uninstall', exact: true }).click()
      await win.waitForTimeout(500)

      await expect(win.getByText(/No extensions installed/)).toBeVisible({ timeout: 3000 })
      await screenshot(win, 'extensions--uninstalled')
    })
  })

  test.describe('settings sidebar core items always present', () => {
    test('core settings pages are always in sidebar regardless of extensions', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await win.getByRole('button', { name: /^№\d+\s+SETTINGS$/ }).click()
      const sidebar = win.getByRole('complementary')
      // Sidebar items include a №XX prefix in their accessible name
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+General$/ })).toBeVisible({ timeout: 5000 })
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+Shortcuts$/ })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+Providers$/ })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+Tools$/ })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: /^№\d+\s+Skills$/ })).toBeVisible()
      await expect(sidebar.getByRole('button', { name: /Extensions/ })).toBeVisible()
    })
  })
})
