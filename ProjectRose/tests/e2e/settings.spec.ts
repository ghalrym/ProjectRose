import { test, expect } from './fixtures/electron'
import { createSeedProject, openProject } from './fixtures/project'
import { screenshot } from './fixtures/screenshot'

// The Settings sidebar is split into separate pages: General, Shortcuts,
// Providers, Tools, Skills, and a collapsible Extensions group.

test.describe('Settings View', () => {
  test.beforeEach(async ({ app, win }) => {
    const dir = createSeedProject()
    await openProject(app, win, dir)
    // Use the toolbar SETTINGS button specifically — the chat panel may also
    // render an "OPEN PROVIDER SETTINGS →" banner when no provider is configured.
    await win.getByRole('button', { name: /^№\d+\s+SETTINGS$/ }).click()
    await expect(win.getByRole('complementary').getByText('Settings', { exact: false })).toBeVisible({ timeout: 5000 })
  })

  // ── Sidebar ──────────────────────────────────────────────────

  test('settings sidebar label is visible', async ({ win }) => {
    // Sidebar label is "Settings · Drawer"
    await expect(win.getByRole('complementary').getByText('Settings', { exact: false })).toBeVisible()
  })

  test('General is the default active page', async ({ win }) => {
    await expect(win.getByText('Names', { exact: true })).toBeVisible()
    await expect(win.getByText('Your Name')).toBeVisible()
    await screenshot(win, 'settings--general')
  })

  test('sidebar contains all core pages', async ({ win }) => {
    const sidebar = win.getByRole('complementary')
    await expect(sidebar.getByRole('button', { name: /^№\d+\s+General$/ })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: /^№\d+\s+Shortcuts$/ })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: /^№\d+\s+Providers$/ })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: /^№\d+\s+Tools$/ })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: /^№\d+\s+Skills$/ })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: /^№\d+\s+Extensions/ })).toBeVisible()
  })

  test('sidebar items show specimen numbers', async ({ win }) => {
    const sidebar = win.getByRole('complementary')
    await expect(sidebar.getByText(/№01/)).toBeVisible()
    await expect(sidebar.getByText(/№02/)).toBeVisible()
    await expect(sidebar.getByText(/№06/)).toBeVisible()
  })

  test('Shortcuts page shows Navigation Bar section', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Shortcuts$/ }).click()
    await expect(win.getByText('Navigation Bar')).toBeVisible({ timeout: 3000 })
  })

  test('navigate to Extensions tab expands it and shows Manage', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Extensions/ }).click()
    await win.waitForTimeout(300)
    await expect(win.getByRole('button', { name: 'Manage', exact: true })).toBeVisible()
    await screenshot(win, 'settings--extensions')
  })

  // ── Status bar ───────────────────────────────────────────────

  test('status bar is visible with save indicator', async ({ win }) => {
    await expect(win.getByText('all changes saved')).toBeVisible()
  })

  test('status bar shows model count', async ({ win }) => {
    await expect(win.getByText(/model.* cataloged/)).toBeVisible()
  })

  // ── Providers page: page header ──────────────────────────────

  test('Providers page shows page header', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText(/PROJECTROSE · SETTINGS · PROVIDERS/)).toBeVisible({ timeout: 3000 })
  })

  // ── Providers page: PLATE I · Providers ─────────────────────

  test('Providers page shows PLATE I Providers section', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText('PLATE I', { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(win.getByText(/keys are masked and status is verified/)).toBeVisible()
  })

  test('all five provider cards are visible', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText('Anthropic', { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(win.getByText('OpenAI', { exact: true })).toBeVisible()
    await expect(win.getByText('Amazon Bedrock', { exact: true })).toBeVisible()
    await expect(win.getByText('Ollama', { exact: true })).toBeVisible()
    await expect(win.getByText('OpenAI-compatible', { exact: true })).toBeVisible()
  })

  test('provider cards show botanical Latin names', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText('Rosa claudia')).toBeVisible({ timeout: 3000 })
    await expect(win.getByText('Rosa generativa')).toBeVisible()
    await expect(win.getByText('Rosa localis')).toBeVisible()
  })

  test('expanding a provider card shows its fields', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    // Click the first provider card header button to expand it (Ollama is first by spec order)
    await win.locator('button[class*="providerCardHeader"]').nth(1).click() // Anthropic — second card
    await expect(win.getByText('API KEY', { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(win.getByRole('button', { name: 'VERIFY & SAVE' })).toBeVisible()
    await expect(win.getByRole('button', { name: 'CLEAR' })).toBeVisible()
    await screenshot(win, 'settings--providers-expanded')
  })

  test('only one provider card can be open at a time', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    // Target only the <button> elements — [class*="providerCardHeader"] would also match
    // the inner div (providerCardHeaderInner) causing wrong elements to be clicked
    const cards = win.locator('button[class*="providerCardHeader"]')
    // Open Anthropic card (second by spec order)
    await cards.nth(1).click()
    await expect(win.getByText('API KEY', { exact: true })).toBeVisible({ timeout: 3000 })
    // Open OpenAI card — Anthropic should close
    await cards.nth(2).click()
    await expect(win.getByText('VERIFY & SAVE')).toBeVisible({ timeout: 3000 })
    // Only one set of provider fields should be visible
    await expect(win.locator('[class*="providerCardBody"]')).toHaveCount(1, { timeout: 3000 })
  })

  // ── Providers page: models nested per-provider ───────────────

  test('expanded provider shows MODELS divider and add button', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await win.locator('button[class*="providerCardHeader"]').nth(1).click() // Anthropic
    await expect(win.getByText('MODELS', { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(win.getByRole('button', { name: /\+ ADD MODEL/ })).toBeVisible()
  })

  test('adding a model adds a row to the provider', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await win.locator('button[class*="providerCardHeader"]').nth(1).click() // Anthropic
    await win.getByRole('button', { name: /\+ ADD MODEL/ }).click()
    await expect(win.locator('[class*="providerModelRow"]')).toBeVisible({ timeout: 3000 })
    await screenshot(win, 'settings--provider-model-added')
  })

  // ── Providers page: PLATE II · Router ───────────────────────

  test('Providers page shows PLATE II Router section', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText('PLATE II', { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(win.getByText('Router', { exact: true })).toBeVisible()
  })

  test('router model field hidden when disabled', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText('PLATE II', { exact: true })).toBeVisible({ timeout: 3000 })
    // Router model select should not be visible when router is off
    await expect(win.getByText('ROUTER MODEL', { exact: true })).not.toBeVisible()
  })

  test('router model field appears when enabled', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    // Find the Enable Router toggle
    const routerRow = win.locator('[class*="hSettingRow"]').filter({ hasText: 'Enable Router' })
    await routerRow.locator('button[role="switch"]').click()
    await expect(win.getByText('ROUTER MODEL', { exact: true })).toBeVisible({ timeout: 3000 })
  })

  // ── Providers page: PLATE III · Behavior & Context ──────────

  test('Providers page shows PLATE III Behavior and Context section', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText('PLATE III', { exact: true })).toBeVisible({ timeout: 3000 })
    await expect(win.getByText('Behavior & Context', { exact: true })).toBeVisible()
  })

  test('behavior panel has expected toggles', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    await expect(win.getByText('BEHAVIOR · CONTEXT')).toBeVisible({ timeout: 3000 })
    await expect(win.getByText('Include thinking in context')).toBeVisible()
    await expect(win.getByText('Auto-summarize at 80% context')).toBeVisible()
    await expect(win.getByText('Stream tool results inline')).toBeVisible()
  })

  test('Providers page colophon is visible', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Providers$/ }).click()
    // Scope to the colophon block (contains 'COLOPHON') to avoid matching header/status bar
    await expect(
      win.locator('[class*="colophon"]').filter({ hasText: 'COLOPHON' })
    ).toContainText('Rosa configurata', { timeout: 3000 })
  })

  // ── Tools page ───────────────────────────────────────────────

  test('Tools page shows page header', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Tools$/ }).click()
    await expect(win.getByText(/PROJECTROSE · SETTINGS · TOOLS/)).toBeVisible({ timeout: 3000 })
  })

  test('Tools page shows core tools panel', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Tools$/ }).click()
    await expect(win.getByText('TOOLS · CORE', { exact: true })).toBeVisible({ timeout: 3000 })
  })

  // ── Skills page ──────────────────────────────────────────────

  test('Skills page shows page header', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Skills$/ }).click()
    await expect(win.getByText(/PROJECTROSE · SETTINGS · SKILLS/)).toBeVisible({ timeout: 3000 })
  })

  test('Skills page shows skills panel', async ({ win }) => {
    await win.getByRole('button', { name: /^№\d+\s+Skills$/ }).click()
    await expect(win.getByText('SKILLS · PROJECT')).toBeVisible({ timeout: 3000 })
  })
})
