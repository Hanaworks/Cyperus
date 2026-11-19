import { expect, test } from '@playwright/test'
import { setThemes } from './workbench-helpers'

async function openFixture(page: import('@playwright/test').Page, name: string) {
  await page.getByTestId('fixture-select').selectOption(name)
  await page.getByTestId('open-fixture').click()
  await expect(page.locator('article.md-doc h1').first()).toBeVisible()
}

test('打开样本、中文目录导航与两套主题不重解析', async ({ page }) => {
  await page.goto('/')
  await openFixture(page, 'cjk-typography.md')
  const before = await page.evaluate(() => window.__M0__?.stats().parseCount)
  await setThemes(page, 'light', 'paper')
  await setThemes(page, 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
  await expect(page.locator('article')).toHaveAttribute('data-md-theme', 'paper')
  expect(await page.evaluate(() => window.__M0__?.stats().parseCount)).toBe(before)
  await page.getByTestId('activity-outline').click()
  await page.locator('nav[aria-label="文档目录"] button').filter({ hasText: '纯中文标题' }).first().click()
  await expect(page.locator('nav button[aria-current="location"]')).toContainText('纯中文标题')
})

test('真实浏览器先消毒后插入，不允许文档脚本和事件执行', async ({ page }) => {
  await page.goto('/')
  await openFixture(page, 'html-safety.md')
  const article = page.locator('article.md-doc')
  await expect(article.locator('script,iframe,style,object,form')).toHaveCount(0)
  await expect(article.locator('[onerror],[onload],[onclick],[srcdoc]')).toHaveCount(0)
  await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0)
  expect(await article.evaluate((el) => [...el.querySelectorAll('[style]')].every((node) => !/url\(|position\s*:/i.test(node.getAttribute('style') ?? '')))).toBe(true)
})

test('原始 HTML 的输入图片和背景资源不能绕过授权发请求', async ({ page }) => {
  const remote: string[] = []
  page.on('request', (request) => { if (request.url().includes('example.test')) remote.push(request.url()) })
  await page.goto('/')
  await page.evaluate(() => window.__M0__?.openText('# 安全边界\n\n<input type="image" src="https://example.test/leak.png">\n<table background="https://example.test/bg.png"><tr><td>正文</td></tr></table>', '安全边界.md'))
  await expect(page.locator('article input[type="image"]')).toHaveCount(0)
  await expect(page.locator('article [background]')).toHaveCount(0)
  expect(remote).toEqual([])
})

test('扩展渲染和局部错误容错、正文与外壳样式隔离', async ({ page }) => {
  await page.goto('/')
  await openFixture(page, 'extended.md')
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.locator('.shiki').first()).toBeAttached()
  await expect(page.locator('input.task-list-checkbox').first()).toBeDisabled()
  await page.evaluate(() => window.__M0__?.renderAll())
  await expect(page.locator('.md-mermaid[data-state="done"] svg').first()).toBeAttached()
  await expect(page.locator('.md-mermaid[data-state="error"]').first()).toBeAttached()
  const before = await page.locator('article').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])
  await setThemes(page, 'dark')
  expect(await page.locator('article').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual(before)
})

test('相对图片经资源解析后加载，缺失图片保留可读替代文字', async ({ page }) => {
  await page.goto('/')
  await openFixture(page, 'extended.md')
  const image = page.locator('article img[alt="示例图片"]')
  await image.scrollIntoViewIfNeeded()
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const missing = page.locator('article img[alt^="不存在的图"]').first()
  await missing.scrollIntoViewIfNeeded()
  await expect(missing).toHaveAttribute('alt', /无法显示|资源不可用/)
})
