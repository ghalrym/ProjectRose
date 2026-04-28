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

interface FakeExtOptions {
  tools?: { name: string; displayName: string; description: string }[]
}

function stageFakeExtension(
  rootPath: string,
  id: string,
  name: string,
  opts: FakeExtOptions = {}
): void {
  const extDir = join(rootPath, '.projectrose', 'extensions', id)
  mkdirSync(extDir, { recursive: true })

  const manifest = {
    id,
    name,
    version: '0.1.0',
    description: `Test extension: ${name}`,
    author: 'Test',
    navItem: { label: name, iconName: 'test' },
    provides: {
      pageView: true,
      globalSettings: false,
      main: false,
      ...(opts.tools ? { tools: opts.tools } : {}),
    },
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
  await win.locator('button', { hasText: 'SETTINGS' }).click()
  await win.getByRole('button', { name: /Extensions/ }).click()
  await win.waitForTimeout(500)
  stage()
  await win.getByPlaceholder(/github\.com/).fill('https://example.test/repo.git')
  await win.getByRole('button', { name: /^INSTALL$/ }).first().click()
  await win.waitForTimeout(1500)
}

async function openAppBoard(win: Page): Promise<void> {
  await win.locator('button', { hasText: /^№\d+\s*APPS$/ }).click()
  await expect(win.getByText('PROJECTROSE · APPS · BOARD')).toBeVisible({ timeout: 5000 })
}

function appCard(win: Page, appId: string) {
  return win.locator(`[data-testid="app-card"][data-app-id="${appId}"]`)
}

function expandedCard(win: Page, appId: string) {
  return win.locator(`[data-testid="app-card-expanded"][data-app-id="${appId}"]`)
}

// ── Tests ─────────────────────────────────────────────────────

test.describe('App Board', () => {
  test.describe('toolbar entry', () => {
    test('APPS button appears between AGENT and EDITOR', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)

      const labels = await win
        .locator('button')
        .filter({ hasText: /^№\d+/ })
        .allInnerTexts()
      const collapsed = labels.map((t) => t.replace(/\s+/g, ' ').trim())

      const agentIdx = collapsed.findIndex((t) => /AGENT/.test(t))
      const appsIdx = collapsed.findIndex((t) => /APPS/.test(t))
      const editorIdx = collapsed.findIndex((t) => /EDITOR/.test(t))
      const settingsIdx = collapsed.findIndex((t) => /SETTINGS/.test(t))

      expect(agentIdx).toBeGreaterThanOrEqual(0)
      expect(appsIdx).toBe(agentIdx + 1)
      expect(editorIdx).toBe(appsIdx + 1)
      expect(settingsIdx).toBe(editorIdx + 1)
    })

    test('clicking APPS opens the app board page', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)
      await expect(win.getByPlaceholder('Search apps & extensions…')).toBeVisible()
      await screenshot(win, 'app-board--default')
    })
  })

  test.describe('built-in apps', () => {
    test('shows the built-in Editor as a card', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      await expect(appCard(win, 'editor')).toBeVisible()
      await expect(appCard(win, 'editor')).toContainText('Editor')
      await expect(appCard(win, 'editor')).toContainText('Rosa scriptoris')
    })

    test('clicking the Editor card launches the editor view', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      await appCard(win, 'editor').click()

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

      const search = win.getByPlaceholder('Search apps & extensions…')
      await search.fill('edit')
      await expect(appCard(win, 'editor')).toBeVisible()

      await search.fill('zzznomatch')
      await expect(appCard(win, 'editor')).not.toBeVisible()
      await expect(win.getByText(/No apps match/)).toBeVisible()
    })

    test('CLEAR button restores the full grid', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      const search = win.getByPlaceholder('Search apps & extensions…')
      await search.fill('zzznomatch')
      await expect(win.getByText(/No apps match/)).toBeVisible()

      await win.getByRole('button', { name: 'CLEAR' }).click()
      await expect(search).toHaveValue('')
      await expect(appCard(win, 'editor')).toBeVisible()
    })

    test('count label updates as search narrows', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await openAppBoard(win)

      // Built-in editor only → "1 of 1"
      await expect(win.getByText(/^1 of 1$/)).toBeVisible()

      await win.getByPlaceholder('Search apps & extensions…').fill('zzznomatch')
      await expect(win.getByText(/^0 of 1$/)).toBeVisible()
    })
  })

  test.describe('alphabetical ordering', () => {
    test('apps are sorted alphabetically by name', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      // Install two fake extensions whose names sort before/after "Editor"
      await installViaUrlForm(win, () => {
        stageFakeExtension(dir, 'rose-aaa', 'Aardvark')
        stageFakeExtension(dir, 'rose-zzz', 'Zebra')
      })

      await openAppBoard(win)

      const ids = await win.locator('[data-testid="app-card"]').evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.appId ?? '')
      )

      expect(ids).toEqual(['rose-aaa', 'editor', 'rose-zzz'])
    })
  })

  test.describe('extensions on the board', () => {
    test('installed extension appears as an app card', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-boardtest', 'Board Test'))

      await openAppBoard(win)
      await expect(appCard(win, 'rose-boardtest')).toBeVisible()
      await expect(appCard(win, 'rose-boardtest')).toContainText('Board Test')
      await screenshot(win, 'app-board--with-extension')
    })

    test('clicking an extension card launches its page view', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () => stageFakeExtension(dir, 'rose-launchtest', 'Launch Test'))

      await openAppBoard(win)
      await appCard(win, 'rose-launchtest').click()

      await expect(win.locator('[data-testid="rose-launchtest-page"]')).toBeVisible({ timeout: 5000 })
    })

    test('extension with tools exposes them as sub-items when expanded', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () =>
        stageFakeExtension(dir, 'rose-tooltest', 'Tool Test', {
          tools: [
            { name: 'do_thing', displayName: 'Do Thing', description: 'Does the thing' },
            { name: 'undo_thing', displayName: 'Undo Thing', description: 'Undoes the thing' },
          ],
        }),
      )

      await openAppBoard(win)

      // Right-click expands (avoids the nested-button quirk on the in-card hint)
      await appCard(win, 'rose-tooltest').click({ button: 'right' })

      const panel = expandedCard(win, 'rose-tooltest')
      await expect(panel).toBeVisible({ timeout: 3000 })
      await expect(panel).toContainText('Inside · 2 items')

      const subIds = await panel
        .locator('[data-testid="app-subcard"]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.subId ?? ''))

      expect(subIds).toEqual(['rose-tooltest:do_thing', 'rose-tooltest:undo_thing'])

      await expect(panel.getByText('Do Thing', { exact: true })).toBeVisible()
      await expect(panel.getByText('Undo Thing', { exact: true })).toBeVisible()
      await screenshot(win, 'app-board--expanded')
    })

    test('OPEN button in expanded panel launches the extension', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () =>
        stageFakeExtension(dir, 'rose-opentest', 'Open Test', {
          tools: [{ name: 'thing', displayName: 'Thing', description: 'A thing' }],
        }),
      )

      await openAppBoard(win)
      await appCard(win, 'rose-opentest').click({ button: 'right' })
      await expandedCard(win, 'rose-opentest')
        .getByRole('button', { name: 'OPEN', exact: true })
        .click()

      await expect(win.locator('[data-testid="rose-opentest-page"]')).toBeVisible({ timeout: 5000 })
    })

    test('COLLAPSE returns the panel to a regular tile', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () =>
        stageFakeExtension(dir, 'rose-collapsetest', 'Collapse Test', {
          tools: [{ name: 't', displayName: 'T', description: 'T desc' }],
        }),
      )

      await openAppBoard(win)
      await appCard(win, 'rose-collapsetest').click({ button: 'right' })
      const panel = expandedCard(win, 'rose-collapsetest')
      await expect(panel).toBeVisible()

      await panel.getByRole('button', { name: /COLLAPSE/ }).click()
      await expect(expandedCard(win, 'rose-collapsetest')).not.toBeVisible()
      await expect(appCard(win, 'rose-collapsetest')).toBeVisible()
    })

    test('clicking a sub-item also launches the extension', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)

      await installViaUrlForm(win, () =>
        stageFakeExtension(dir, 'rose-subclick', 'Sub Click', {
          tools: [{ name: 'go', displayName: 'Go', description: 'Go go go' }],
        }),
      )

      await openAppBoard(win)
      await appCard(win, 'rose-subclick').click({ button: 'right' })
      await win.locator('[data-testid="app-subcard"][data-sub-id="rose-subclick:go"]').click()

      await expect(win.locator('[data-testid="rose-subclick-page"]')).toBeVisible({ timeout: 5000 })
    })
  })
})
