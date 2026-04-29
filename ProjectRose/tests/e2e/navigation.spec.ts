import { test, expect } from './fixtures/electron'
import { createSeedProject, openProject } from './fixtures/project'
import { screenshot } from './fixtures/screenshot'

test.describe('Navigation', () => {
  test.beforeEach(async ({ app, win }) => {
    const dir = createSeedProject()
    await openProject(app, win, dir)
  })

  test('TopBar renders brand after project open', async ({ win }) => {
    await expect(win.getByText('ProjectRose')).toBeVisible()
  })

  test('ViewToggle shows all default nav buttons', async ({ win }) => {
    await expect(win.getByRole('button', { name: /^№\d+\s+AGENT$/ })).toBeVisible()
    await expect(win.getByRole('button', { name: /^№\d+\s+EDITOR$/ })).toBeVisible()
    await expect(win.getByRole('button', { name: /^№\d+\s+SETTINGS$/ })).toBeVisible()
  })

  test('chat view is active by default', async ({ win }) => {
    await expect(win.getByRole('button', { name: '+ New Session' })).toBeVisible()
    await screenshot(win, 'chat--view')
  })

  test('navigate to editor view', async ({ win }) => {
    await win.locator('button', { hasText: 'EDITOR' }).click()
    await win.waitForTimeout(500)
    await screenshot(win, 'editor--view')
  })

  test('navigate to settings view', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+SETTINGS$/ }).click()
    await expect(win.getByRole('complementary').getByText('Settings', { exact: false })).toBeVisible()
    await screenshot(win, 'settings--view')
  })

  test('theme toggle in TopBar cycles data-theme', async ({ win }) => {
    const before = await win.evaluate(() => document.documentElement.getAttribute('data-theme'))
    await win.getByTitle(/Switch to/).click()
    const after = await win.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(after).not.toBe(before)
  })

  test('navigate back to agent view', async ({ win }) => {
    await win.locator('button', { hasText: 'EDITOR' }).click()
    await win.locator('button', { hasText: 'AGENT' }).click()
    await expect(win.getByRole('button', { name: '+ New Session' })).toBeVisible()
  })
})
