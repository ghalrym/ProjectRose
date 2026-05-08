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

async function installViaUrlForm(win: Page, stage: () => void): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
  await win.getByRole('button', { name: 'Manage', exact: true }).click()
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

// Returns the AppsDrawer card whose accessible name contains the given text.
// Cards have an accessible name like "№02 RS Editor".
function appCard(win: Page, label: RegExp | string) {
  const re = typeof label === 'string' ? new RegExp(label) : label
  return win.getByRole('dialog', { name: 'Apps' }).getByRole('button').filter({ hasText: re })
}

// ── Tests ─────────────────────────────────────────────────────

test.describe('App Board', () => {
  test.describe('drawer entry', () => {
    test('rose-mark FAB opens the apps drawer', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)
      await expect(win.getByText('App Board', { exact: true })).toBeVisible()
      await expect(win.getByPlaceholder(/Search apps/)).toBeVisible()
      await screenshot(win, 'app-board--default')
    })
  })

  test.describe('built-in apps', () => {
    test('shows the built-in Editor as a card', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      const card = appCard(win, /Editor/).first()
      await expect(card).toBeVisible()
      await expect(card).toContainText('Editor')
      await expect(card).toContainText('Rosa scriptoris')
    })

    test('clicking the Editor card launches the editor view', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      await appCard(win, /Editor/).first().click()

      // Editor view shows the FileActions toolbar (Open Folder/Open/New/Save)
      await expect(win.getByRole('button', { name: 'Open Folder' })).toBeVisible({ timeout: 5000 })
      await expect(win.getByRole('button', { name: 'Save' })).toBeVisible()
    })
  })

  test.describe('search', () => {
    test('search filters cards by query', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      const search = win.getByPlaceholder(/Search apps/)
      await search.fill('edit')
      await expect(appCard(win, /Editor/)).toBeVisible()

      await search.fill('zzznomatch')
      await expect(appCard(win, /Editor/)).not.toBeVisible()
      await expect(win.getByText(/No apps match/)).toBeVisible()
    })

    test('clearing the query restores the full grid', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      const search = win.getByPlaceholder(/Search apps/)
      await search.fill('zzznomatch')
      await expect(win.getByText(/No apps match/)).toBeVisible()

      await search.fill('')
      await expect(appCard(win, /Editor/)).toBeVisible()
    })
  })

  test.describe('extensions on the board', () => {
    test('installed extension appears as an app card', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-boardtest', 'Board Test'))

      await openAppBoard(win)
      await expect(appCard(win, /Board Test/)).toBeVisible()
      await screenshot(win, 'app-board--with-extension')
    })

    test('clicking an extension card launches its page view', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-launchtest', 'Launch Test'))

      await openAppBoard(win)
      await appCard(win, /Launch Test/).click()

      await expect(win.locator('[data-testid="rose-launchtest-page"]')).toBeVisible({ timeout: 5000 })
    })
  })
})
