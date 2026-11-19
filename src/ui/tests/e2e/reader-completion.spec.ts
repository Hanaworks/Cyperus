import { expect, type Page, test } from '@playwright/test'
import { openFolderFromMenu, setThemes } from './workbench-helpers'

async function openFixture(page: Page, name: string) {
  await page.getByTestId('fixture-select').selectOption(name)
  await page.getByTestId('open-fixture').click()
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('article h1').first()).toBeVisible()
}
async function change(page: Page, path: string, text?: string, gone = false) {
  await page.evaluate(async ({ path, text, gone }) => {
    const modulePath = '/src/core/ipc/mockBridge.ts'
    const mock = await import(modulePath)
    const meta = await mock.mockBridge.openDocument(path)
    if (gone) mock.mockEmitGone(meta.docId)
    else mock.mockEmitChanged(meta.docId, text)
  }, { path, text, gone })
}

test('本地链接支持后台打开、跨文档中文锚点及失败提示', async ({ page }) => {
  await page.goto('/')
  await openFixture(page, 'links.md')
  await page.locator('article').getByRole('link', { name: 'tabs/a.md#章节一', exact: true }).click({ modifiers: ['Control'] })
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: 'links.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'a.md', exact: true }).click()
  await expect(page.locator('article #章节一')).toBeFocused()
  await page.getByRole('tab', { name: 'links.md', exact: true }).click()
  await page.locator('article').getByRole('link', { name: '不存在', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不存在')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.locator('article').getByRole('link', { name: 'https://example.com', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => {
    const modulePath = '/src/core/ipc/mockBridge.ts'
    return (await import(modulePath)).mockOpenedUrls
  })).toContain('https://example.com')
  expect(new URL(page.url()).hostname).toBe('127.0.0.1')
})

test('真实阅读流程处理活动更新、后台更新、删除和恢复', async ({ page }) => {
  await page.goto('/')
  await openFixture(page, 'basic.md')
  await change(page, 'basic.md', '# 更新后的文档\n\nword word')
  await expect(page.locator('article h1')).toHaveText('更新后的文档')
  await openFixture(page, 'theme.md')
  const count = await page.evaluate(() => window.__M0__?.stats().parseCount)
  await change(page, 'basic.md', '# 后台更新')
  expect(await page.evaluate(() => window.__M0__?.stats().parseCount)).toBe(count)
  await page.getByRole('tab', { name: 'basic.md', exact: true }).click()
  await expect(page.locator('article h1')).toHaveText('后台更新')
  await change(page, 'basic.md', undefined, true)
  await expect(page.getByRole('alert')).toContainText('删除')
  await expect(page.locator('article h1')).toHaveText('后台更新')
  await change(page, 'basic.md', '# 文件恢复')
  await expect(page.locator('article h1')).toHaveText('文件恢复')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('重启恢复目录、标签、主题、搜索及阅读位置', async ({ page }) => {
  await page.goto('/')
  await openFolderFromMenu(page)
  await openFixture(page, 'basic.md')
  await openFixture(page, 'theme.md')
  await page.getByRole('tab', { name: 'basic.md', exact: true }).click()
  await setThemes(page, 'dark', 'paper')
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: '搜索当前文档' }).fill('CommonMark')
  await page.locator('.reader-scroll').evaluate((element) => { element.scrollTop = 500; element.dispatchEvent(new Event('scroll')) })
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('md-preview.workspace.v1') ?? '{}').tabs?.[0]?.scrollTop)).toBe(500)
  await page.reload()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: 'basic.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('app-theme')).toHaveValue('dark')
  await expect(page.getByTestId('md-theme')).toHaveValue('paper')
  await expect(page.getByRole('textbox', { name: '搜索当前文档' })).toHaveValue('CommonMark')
  await expect.poll(() => page.locator('.reader-scroll').evaluate((element) => element.scrollTop)).toBe(500)
  await page.getByTestId('activity-files').click()
  await expect(page.getByRole('tree', { name: '文件浏览器' })).toBeVisible()
})

test('损坏会话回退，恢复失效路径不留下空白标签', async ({ page }) => {
  await page.addInitScript(() => {
    const value = sessionStorage.getItem('test.nextWorkspace')
    if (value !== null) { localStorage.setItem('md-preview.workspace.v1', value); sessionStorage.removeItem('test.nextWorkspace') }
  })
  await page.goto('/')
  await page.evaluate(() => sessionStorage.setItem('test.nextWorkspace', 'bad json'))
  await page.reload()
  await expect(page.getByRole('button', { name: '打开 Markdown 文件', exact: true })).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('test.nextWorkspace', JSON.stringify({ schemaVersion: 1,
    tabs: [{ path: 'missing.md' }, { path: 'basic.md' }], activePath: 'missing.md' })))
  await page.reload()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'basic.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('alert')).toContainText('missing.md')
})

test('标签拖动接入真实会话，关闭右侧并可恢复，顺序跨重启保留', async ({ page }) => {
  await page.goto('/')
  await openFixture(page, 'basic.md')
  await openFixture(page, 'links.md')
  await openFixture(page, 'theme.md')
  const theme = page.getByRole('tab', { name: 'theme.md', exact: true })
  const first = page.getByRole('tab', { name: 'basic.md', exact: true })
  await theme.dragTo(first, { targetPosition: { x: 4, y: 10 } })
  await expect(page.getByRole('tab').first()).toHaveAccessibleName('theme.md')
  await page.reload()
  await expect(page.getByRole('tab').first()).toHaveAccessibleName('theme.md')
  await first.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '关闭右侧', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.keyboard.press('Control+Shift+t')
  await expect(page.getByRole('tab')).toHaveCount(3)
  await expect(page.getByRole('tab').last()).toHaveAccessibleName('links.md')
})
