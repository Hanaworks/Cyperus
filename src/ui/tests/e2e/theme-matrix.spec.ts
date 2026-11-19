import { expect, type Locator, type Page, test } from '@playwright/test'
import { setThemes } from './workbench-helpers'

const fixtures = [
  { id: 'basic', file: 'basic.md', heading: '基础语法测试样本' },
  { id: 'extended', file: 'extended.md', heading: '扩展语法测试样本' },
  { id: 'cjk', file: 'cjk-typography.md', heading: 'CJK 排版测试样本' },
] as const

async function colors(element: Locator): Promise<string[]> {
  return element.evaluate((node) => {
    const style = getComputedStyle(node)
    return [style.backgroundColor, style.color]
  })
}

async function verifySyntax(page: Page, fixture: (typeof fixtures)[number]): Promise<void> {
  const article = page.locator('article.md-doc')
  await expect(article.locator('h1').first()).toHaveText(fixture.heading)
  await expect(article.locator('blockquote').first()).toBeAttached()
  await expect(article.locator('ul li').first()).toBeAttached()
  await expect(article.locator('pre code').first()).toBeAttached()

  if (fixture.id === 'basic') {
    for (const level of [2, 3, 4, 5, 6]) await expect(article.locator(`h${level}`).first()).toBeAttached()
    await expect(article.locator('strong').filter({ hasText: '粗体文本' })).toHaveCount(1)
    await expect(article.locator('em').filter({ hasText: '斜体文本' })).toHaveCount(1)
    await expect(article.locator('a[href="https://example.com"]').first()).toBeAttached()
    return
  }
  if (fixture.id === 'extended') {
    await expect(article.locator('table').first()).toContainText('左对齐')
    await expect(article.locator('input.task-list-checkbox').first()).toBeDisabled()
    await expect(article.locator('input.task-list-checkbox:checked').first()).toBeChecked()
    for (const selector of ['.footnote-ref', '.footnotes', '.markdown-alert-note', '.katex', '.shiki']) {
      await expect(article.locator(selector).first()).toBeAttached()
    }
    await page.evaluate(() => window.__M0__?.renderAll())
    await expect(article.locator('.md-mermaid[data-state="done"] svg')).toHaveCount(4)
    await expect(article.locator('.md-mermaid[data-state="error"]')).toHaveCount(1)
    return
  }
  await expect(article.locator('h2[id="纯中文标题"]')).toHaveText('纯中文标题')
  const repeated = article.locator('h3').filter({ hasText: /^重复标题$/ })
  await expect(repeated).toHaveCount(3)
  const ids = await repeated.evaluateAll((headings) => headings.map((heading) => heading.id))
  expect(ids.every(Boolean)).toBe(true)
  expect(new Set(ids).size).toBe(3)
  await expect(article.locator('table')).toContainText('实时刷新')
  await expect(article).toContainText('数字：１２３ 全角与 123 半角。')
  await expect(article.locator('pre code').first()).toContainText('用户列表')
}

test.describe('App × Markdown theme matrix evidence', () => {
  for (const fixture of fixtures) {
    for (const appTheme of ['light', 'dark'] as const) {
      for (const markdownTheme of ['light', 'dark', 'paper'] as const) {
        test(`${fixture.id} / app-${appTheme} / markdown-${markdownTheme}`, async ({ page }, testInfo) => {
          const errors: string[] = []
          page.on('pageerror', (error) => errors.push(error.message))
          await page.goto('/')
          await page.getByTestId('fixture-select').selectOption(fixture.file)
          await page.getByTestId('open-fixture').click()
          const article = page.locator('article.md-doc')
          const statusbar = page.getByRole('contentinfo')
          await expect(article.locator('h1').first()).toBeVisible()
          const parseCount = await page.evaluate(() => window.__M0__?.stats().parseCount)
          expect(parseCount).toBeGreaterThan(0)

          await setThemes(page, appTheme, markdownTheme)
          const documentColors = await colors(article)
          const shellColors = await colors(statusbar)

          // Both directions are exercised for every combination, including the
          // default light/light case. Attributes alone do not prove CSS isolation.
          await setThemes(page, appTheme === 'light' ? 'dark' : 'light')
          await expect(article).toHaveAttribute('data-md-theme', markdownTheme)
          expect(await colors(article)).toEqual(documentColors)
          expect(await colors(statusbar)).not.toEqual(shellColors)
          await setThemes(page, appTheme)
          expect(await colors(statusbar)).toEqual(shellColors)

          await setThemes(page, undefined, markdownTheme === 'dark' ? 'light' : 'dark')
          await expect(page.locator('html')).toHaveAttribute('data-app-theme', appTheme)
          expect(await colors(statusbar)).toEqual(shellColors)
          expect(await colors(article)).not.toEqual(documentColors)
          await setThemes(page, undefined, markdownTheme)
          expect(await colors(article)).toEqual(documentColors)

          await verifySyntax(page, fixture)
          expect(await page.evaluate(() => window.__M0__?.stats().parseCount)).toBe(parseCount)
          expect(errors).toEqual([])
          await page.evaluate(() => document.fonts.ready)
          // Evidence only: no golden comparison, snapshot approval, or new baseline.
          await page.screenshot({
            path: testInfo.outputPath(`${fixture.id}-app-${appTheme}-markdown-${markdownTheme}.png`),
            animations: 'disabled',
          })
        })
      }
    }
  }
})
