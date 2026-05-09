import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'
import { createSeedProject, openProject } from './fixtures/project'
import { screenshot } from './fixtures/screenshot'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// ── Helpers (mirrors extensions.spec.ts) ──────────────────────

async function mockInstallHandler(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('extension:installFromGit')
    ipcMain.handle('extension:installFromGit', async () => ({ ok: true }))
  })
}

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
    provides: { pageView: true, globalSettings: false, main: false },
  }
  writeFileSync(join(extDir, 'rose-extension.json'), JSON.stringify(manifest))

  const rendererCode = `"use strict";
const React = require('react');
function PageView() { return React.createElement('div', { 'data-testid': '${id}-page' }, '${name} Page'); }
exports.PageView = PageView;
`
  writeFileSync(join(extDir, 'renderer.js'), rendererCode)
}

// Settings → Extensions tab: install form is on the page directly. Fill the
// URL field, stage the fake extension on disk, click INSTALL. The mocked IPC
// handler returns ok and the renderer re-lists, picking up the staged
// extension as newly installed.
async function installViaUrlForm(win: Page, stage: () => void): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
  await win.waitForTimeout(500)
  stage()
  await win.getByPlaceholder(/github\.com/).fill('https://example.test/repo.git')
  await win.getByRole('button', { name: /^INSTALL$/ }).first().click()
  await win.waitForTimeout(1500)
}

async function openAppBoard(win: Page): Promise<void> {
  await win.getByRole('button', { name: 'Open apps' }).click()
  await expect(win.getByRole('dialog', { name: 'Apps' })).toBeVisible({ timeout: 5000 })
}

// Returns the AppsDrawer sidebar entry whose accessible name contains the
// given text. Sidebar buttons follow the pattern "№XX <name>".
function sidebarEntry(win: Page, label: RegExp | string) {
  const re = typeof label === 'string' ? new RegExp(label) : label
  return win.getByRole('dialog', { name: 'Apps' }).getByRole('button', { name: re })
}

// ── Tests ─────────────────────────────────────────────────────

test.describe('App Board', () => {
  test.describe('drawer entry', () => {
    test('rose-mark FAB opens the apps drawer', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)
      await expect(win.getByText('App Board', { exact: true })).toBeVisible()
      await screenshot(win, 'app-board--default')
    })

    test('drawer with no extensions shows the empty state', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)
      await expect(win.getByText(/No extensions installed/)).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('extensions on the board', () => {
    test('installed extension appears in the drawer sidebar', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-boardtest', 'Board Test'))

      await openAppBoard(win)
      await expect(sidebarEntry(win, /^№\d+.*Board Test/)).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'app-board--with-extension')
    })

    test('selecting an extension renders its page view in the main pane', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-launchtest', 'Launch Test'))

      await openAppBoard(win)
      await sidebarEntry(win, /^№\d+.*Launch Test/).click()

      await expect(win.locator('[data-testid="rose-launchtest-page"]')).toBeVisible({ timeout: 5000 })
    })
  })
})
