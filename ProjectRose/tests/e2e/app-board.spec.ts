import { test, expect } from './fixtures/electron'
import type { ElectronApplication, Page } from '@playwright/test'
import { createSeedProject, openProject } from './fixtures/project'
import { screenshot } from './fixtures/screenshot'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

async function getAgentHome(app: ElectronApplication): Promise<string> {
  return await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
}

const stagedExtensionIds = new Set<string>()

test.afterEach(async ({ app }) => {
  if (stagedExtensionIds.size === 0) return
  const home = await getAgentHome(app)
  for (const id of stagedExtensionIds) {
    try { rmSync(join(home, '.rose', 'extensions', id), { recursive: true, force: true }) } catch { /* ignore */ }
  }
  stagedExtensionIds.clear()
})

// ── Helpers (mirrors extensions.spec.ts) ──────────────────────

// Stub out the two-step install IPCs so the renderer's INSTALL button:
//   1) installPreviewFromGit -> returns a fake token + manifest (no real clone),
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
    provides: { pageView: true, globalSettings: false, main: false },
  }
  writeFileSync(join(installDir, 'rose-extension.json'), JSON.stringify(manifest))

  const rendererCode = `"use strict";
const React = require('react');
function PageView() { return React.createElement('div', { 'data-testid': '${id}-page' }, '${name} Page'); }
exports.PageView = PageView;
`
  writeFileSync(join(installDir, 'renderer.js'), rendererCode)

  const overlayDir = join(rootPath, '.projectrose', 'extensions', id)
  mkdirSync(overlayDir, { recursive: true })
  writeFileSync(join(overlayDir, 'state.json'), JSON.stringify({ enabled: true }))
}

// Settings → Extensions tab: install form is on the page directly. Fill the
// URL field, stage the fake extension on disk, click INSTALL. The mocked
// preview IPC opens a confirmation dialog; we click its INSTALL button to
// finalize. After confirm, the renderer re-fetches via extension:list,
// picking up the staged extension as newly installed.
async function installViaUrlForm(win: Page, stage: () => void): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
  await win.waitForTimeout(500)
  stage()
  await win.getByPlaceholder(/github\.com/).fill('https://example.test/repo.git')
  await win.getByRole('button', { name: /^INSTALL$/ }).first().click()
  const dialog = win.getByRole('dialog', { name: /^Install / })
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  await dialog.getByRole('button', { name: /^INSTALL$/ }).click()
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

    // Built-in extensions (rose-contacts, rose-email, rose-calendar) ship in
    // BUILTIN_EXTENSIONS and are always registered, so AppsDrawer's empty
    // state (`extensions.length === 0`) is unreachable in the host. Keeping
    // the case skipped until a built-ins-aware empty state is reintroduced.
    test.skip('drawer with no extensions shows the empty state', async ({ app, win }) => {
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
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-boardtest', 'Board Test'))

      await openAppBoard(win)
      await expect(sidebarEntry(win, /^№\d+.*Board Test/)).toBeVisible({ timeout: 5000 })
      await screenshot(win, 'app-board--with-extension')
    })

    test('selecting an extension renders its page view in the main pane', async ({ app, win }) => {
      const dir = createSeedProject()
      await openProject(app, win, dir)
      await mockInstallHandler(app)
      const agentHome = await getAgentHome(app)

      await installViaUrlForm(win, () => stageFakeExtension(agentHome, dir, 'rose-launchtest', 'Launch Test'))

      await openAppBoard(win)
      await sidebarEntry(win, /^№\d+.*Launch Test/).click()

      await expect(win.locator('[data-testid="rose-launchtest-page"]')).toBeVisible({ timeout: 5000 })
    })
  })
})
