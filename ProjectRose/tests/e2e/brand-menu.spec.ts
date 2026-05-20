import { test, expect } from './fixtures/electron'
import type { ElectronApplication } from '@playwright/test'
import { createSeedProject, openProject } from './fixtures/project'
import { writeFileSync } from 'fs'
import { basename, join } from 'path'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function projectRegex(dir: string): RegExp {
  return new RegExp(escapeRegex(basename(dir)))
}

async function mockOpenFolderDialog(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, projectDir) => {
    const d = dialog as unknown as { showOpenDialog: unknown }
    d.showOpenDialog = (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      Promise.resolve({ canceled: false, filePaths: [projectDir] })
  }, dir)
}

// Recent projects persist in the app's userData dir between test runs. Reset
// before tests that depend on a known recents state. The file write happens
// from the test runner (Node) since `require` isn't available inside
// `app.evaluate` with electron-vite's ESM bundle.
async function clearRecentProjects(app: ElectronApplication): Promise<void> {
  const home = await app.evaluate(({ app: electronApp }) =>
    electronApp.getPath('home')
  )
  try {
    writeFileSync(join(home, '.rose', 'recent-workspaces.json'), '[]', 'utf-8')
  } catch {
    // ignore — file may not exist on a clean machine
  }
}

test.describe('Brand Menu', () => {
  test('clicking the brand opens a dropdown with Open Project, Open Recent Project, and Exit', async ({ app, win }) => {
    const dir = createSeedProject()
    await openProject(app, win, dir)

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await expect(brand).toBeVisible()
    await brand.click()

    await expect(brand).toHaveAttribute('aria-expanded', 'true')
    await expect(win.getByRole('menuitem', { name: 'Open Project' })).toBeVisible()
    await expect(win.getByRole('menuitem', { name: /Open Recent Project/ })).toBeVisible()
    await expect(win.getByRole('menuitem', { name: 'Exit' })).toBeVisible()
  })

  test('Escape closes the dropdown', async ({ app, win }) => {
    const dir = createSeedProject()
    await openProject(app, win, dir)

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await brand.click()
    await expect(win.getByRole('menuitem', { name: 'Open Project' })).toBeVisible()

    await win.keyboard.press('Escape')
    await expect(win.getByRole('menuitem', { name: 'Open Project' })).not.toBeVisible()
  })

  test('outside click closes the dropdown', async ({ app, win }) => {
    const dir = createSeedProject()
    await openProject(app, win, dir)

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await brand.click()
    await expect(win.getByRole('menuitem', { name: 'Open Project' })).toBeVisible()

    // Click somewhere outside the menu (mid-screen, well below the TopBar)
    await win.mouse.click(600, 500)
    await expect(win.getByRole('menuitem', { name: 'Open Project' })).not.toBeVisible()
  })

  test('Open Project switches to a different project without restart', async ({ app, win }) => {
    const dir1 = createSeedProject()
    const dir2 = createSeedProject()

    await openProject(app, win, dir1)

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await expect(brand).toHaveAccessibleName(projectRegex(dir1))

    await mockOpenFolderDialog(app, dir2)

    await brand.click()
    await win.getByRole('menuitem', { name: 'Open Project' }).click()

    // The new project's basename appears in the wordmark; the old one does not
    await expect(brand).toHaveAccessibleName(projectRegex(dir2), { timeout: 10000 })
    await expect(brand).not.toHaveAccessibleName(projectRegex(dir1))
  })

  test('Open Recent Project submenu lists previously-opened projects (excluding current)', async ({ app, win }) => {
    const dir1 = createSeedProject()
    const dir2 = createSeedProject()

    await openProject(app, win, dir1)
    await mockOpenFolderDialog(app, dir2)

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await brand.click()
    await win.getByRole('menuitem', { name: 'Open Project' }).click()
    await expect(brand).toHaveAccessibleName(projectRegex(dir2), { timeout: 10000 })

    // Now dir1 should be in the recents (and not the current dir2)
    await brand.click()
    const recentTrigger = win.getByRole('menuitem', { name: /Open Recent Project/ })
    await expect(recentTrigger).toBeEnabled()
    await recentTrigger.click()

    const recentItems = win.getByRole('menuitem').filter({ hasText: basename(dir1) })
    await expect(recentItems.first()).toBeVisible()

    // Current project should not appear inside the submenu
    const currentEntry = win.getByRole('menuitem').filter({ hasText: basename(dir2) })
    await expect(currentEntry).toHaveCount(0)
  })

  test('selecting a recent project switches back to it', async ({ app, win }) => {
    const dir1 = createSeedProject()
    const dir2 = createSeedProject()

    await openProject(app, win, dir1)
    await mockOpenFolderDialog(app, dir2)

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await brand.click()
    await win.getByRole('menuitem', { name: 'Open Project' }).click()
    await expect(brand).toHaveAccessibleName(projectRegex(dir2), { timeout: 10000 })

    await brand.click()
    await win.getByRole('menuitem', { name: /Open Recent Project/ }).click()
    await win.getByRole('menuitem').filter({ hasText: basename(dir1) }).first().click()

    await expect(brand).toHaveAccessibleName(projectRegex(dir1), { timeout: 10000 })
    await expect(brand).not.toHaveAccessibleName(projectRegex(dir2))
  })

  test('Open Recent Project is disabled when there are no other recents', async ({ app, win }) => {
    // ~/.rose/recent-workspaces.json persists across runs; start clean so the
    // only entry is the project we open in this test.
    await clearRecentProjects(app)

    const dir = createSeedProject()
    await openProject(app, win, dir)

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await brand.click()

    // The current project is filtered out of recents, so on first open the submenu trigger is disabled
    const recentTrigger = win.getByRole('menuitem', { name: /Open Recent Project/ })
    await expect(recentTrigger).toBeDisabled()
  })

  test('Exit invokes the app:quit IPC channel', async ({ app, win }) => {
    const dir = createSeedProject()
    await openProject(app, win, dir)

    // Override the IPC handler so the test can verify the call without
    // actually quitting (which would prevent fixture teardown from completing).
    await app.evaluate(({ ipcMain }) => {
      ;(globalThis as { __quitCalled?: boolean }).__quitCalled = false
      ipcMain.removeHandler('app:quit')
      ipcMain.handle('app:quit', () => {
        ;(globalThis as { __quitCalled?: boolean }).__quitCalled = true
      })
    })

    const brand = win.getByRole('button', { name: /Project\s*Rose/ })
    await brand.click()
    await win.getByRole('menuitem', { name: 'Exit' }).click()

    await expect.poll(
      async () => app.evaluate(() => (globalThis as { __quitCalled?: boolean }).__quitCalled),
      { timeout: 5000 }
    ).toBe(true)
  })
})
