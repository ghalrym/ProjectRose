import { test, expect } from './fixtures/electron'
import { createSeedProject, openProject } from './fixtures/project'
import { screenshot } from './fixtures/screenshot'

test.describe('Navigation', () => {
  test.beforeEach(async ({ app, win }) => {
    const dir = createSeedProject()
    await openProject(app, win, dir)
  })

  test('TopBar renders brand after project open', async ({ win }) => {
    await expect(win.getByRole('button', { name: /Project\s*Rose/ })).toBeVisible()
  })

  test('BottomDock shows the apps FAB and view-shortcut button', async ({ win }) => {
    // Rose-mark FAB on the left toggles the AppsDrawer.
    await expect(win.getByRole('button', { name: 'Open apps' })).toBeVisible()
    // On the chat (default) view, the context-sensitive shortcut targets Settings.
    await expect(win.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  })

  test('chat view is active by default', async ({ win }) => {
    await expect(win.getByRole('button', { name: '+ New Session' })).toBeVisible()
    await screenshot(win, 'chat--view')
  })

  test('navigate to editor view via apps drawer', async ({ win }) => {
    await win.getByRole('button', { name: 'Open apps' }).click()
    await win.getByRole('button', { name: /Editor/ }).first().click()
    // Editor view exposes the FileActions toolbar (Open Folder/Save).
    await expect(win.getByRole('button', { name: 'Open Folder' })).toBeVisible({ timeout: 5000 })
    await screenshot(win, 'editor--view')
  })

  test('navigate to settings view via dock shortcut', async ({ win }) => {
    // On the chat view the dock shortcut button is labeled "Settings"
    await win.getByRole('button', { name: 'Settings', exact: true }).click()
    // Settings sidebar exposes the General page header.
    await expect(win.getByText('General', { exact: true }).first()).toBeVisible({ timeout: 5000 })
    await screenshot(win, 'settings--view')
  })

  test('theme toggle in BottomDock cycles data-theme', async ({ win }) => {
    const before = await win.evaluate(() => document.documentElement.getAttribute('data-theme'))
    await win.getByTitle(/Switch to/).click()
    const after = await win.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(after).not.toBe(before)
  })

  test('navigate back to agent view from settings', async ({ win }) => {
    await win.getByRole('button', { name: 'Settings', exact: true }).click()
    // Once on settings, the dock shortcut flips to "Agent".
    await win.getByRole('button', { name: 'Agent' }).click()
    await expect(win.getByRole('button', { name: '+ New Session' })).toBeVisible()
  })
})
