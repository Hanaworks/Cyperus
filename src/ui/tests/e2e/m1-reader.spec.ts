import { expect, test } from '@playwright/test'
import { setThemes } from './workbench-helpers'

test('external edits restore the same paragraph after content is inserted above it', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('fixture-select').selectOption('basic.md')
  await page.getByTestId('open-fixture').click()
  await page.evaluate(async () => {
    const path = '/src/core/ipc/mockBridge.ts'
    const mock = await import(path)
    const doc = await mock.mockBridge.openDocument('basic.md')
    mock.mockEmitChanged(doc.docId, `# Position\n\n${Array.from({ length: 120 }, (_, i) => `Paragraph ${i}: stable reading content.`).join('\n\n')}`)
  })
  await expect(page.locator('article h1')).toHaveText('Position')
  await page.locator('article p').nth(60).evaluate((node) => {
    const scroll = document.querySelector('.reader-scroll')
    if (!scroll) throw new Error('Missing reader viewport')
    scroll.scrollTop += node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + 10
  })
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('md-preview.workspace.v1') ?? '{}').tabs?.[0]?.anchor?.text)).toContain('Paragraph 60:')
  const before = await page.locator('article p').filter({ hasText: 'Paragraph 60:' }).evaluate((node) => node.getBoundingClientRect().top)
  await page.evaluate(async () => {
    const path = '/src/core/ipc/mockBridge.ts'
    const mock = await import(path)
    const doc = await mock.mockBridge.openDocument('basic.md')
    mock.mockEmitChanged(doc.docId, '# Position\n\n' + 'Inserted paragraph.\n\n'.repeat(30)
      + Array.from({ length: 120 }, (_, i) => `Paragraph ${i}: stable reading content.`).join('\n\n'))
  })
  await expect(page.locator('article p')).toHaveCount(150)
  await expect.poll(async () => Math.abs(await page.locator('article p').filter({ hasText: 'Paragraph 60:' }).evaluate((node) => node.getBoundingClientRect().top) - before)).toBeLessThan(3)
})

test('large documents bound DOM and preserve full search, distant anchors, themes and traversal', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.evaluate(() => {
    const filler = (`plain ${'x'.repeat(1200)}\n\n`).repeat(3500)
    const graph = '\n\n```mermaid\ngraph LR; A-->B\n```\n\n'
    return window.__M0__?.openText('# Start\n\n[Go tail](#tail)\n\nneedle\n\n' + graph + filler
      + '# Middle\n\nnee**dle**\n\n' + graph + filler + '# Tail\n\nneedle\n\n<a name="legacy"></a>\n\n[Legacy](#legacy)' + graph, 'large.md')
  })
  await expect(page.locator('article')).toHaveAttribute('data-segment-count', /^\d+$/)
  expect(await page.locator('article p').count()).toBeLessThan(150)
  await expect(page.locator('article #tail')).toHaveCount(0)
  await page.getByRole('link', { name: 'Go tail' }).click()
  await expect(page.locator('article #tail')).toBeFocused()
  await expect(page.locator('article #start')).toHaveCount(0)
  await page.getByRole('link', { name: 'Legacy', exact: true }).click()
  await expect(page.locator('article a[name="legacy"]')).toBeFocused()
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: '搜索当前文档' }).fill('needle')
  await expect(page.getByTestId('search-summary')).toHaveText('1 / 3')
  await page.getByRole('button', { name: '上一个匹配' }).click()
  await expect(page.getByTestId('search-summary')).toHaveText('3 / 3')
  await expect(page.locator('article #tail')).toBeAttached()
  await setThemes(page, 'dark', 'paper')
  await expect(page.getByTestId('search-summary')).toHaveText('3 / 3')
  expect(await page.locator('article p').count()).toBeLessThan(250)
  const completed = await page.evaluate(() => window.__M0__?.renderAll())
  expect(completed?.graphs).toEqual({ done: 3, error: 0, pending: 0 })
  expect(completed?.cancelled).toBe(false)
  expect(completed?.visitedSegments).toBe(completed?.totalSegments)
  await expect(page.locator('article')).toHaveAttribute('data-all-segments-visited', 'true')
  expect(await page.locator('article p').count()).toBeLessThan(250)
})

test('returning to the top then immediately switching tabs clears the saved semantic anchor', async ({ page }) => {
  await page.goto('/')
  for (const name of ['basic.md', 'theme.md']) {
    await page.getByTestId('fixture-select').selectOption(name)
    await page.getByTestId('open-fixture').click()
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
  }
  await page.getByRole('tab', { name: 'basic.md', exact: true }).click()
  await expect(page.locator('article h1').first()).toBeVisible()
  await page.locator('.reader-scroll').evaluate((node) => { node.scrollTop = 500 })
  await expect.poll(() => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('md-preview.workspace.v1') ?? '{}').tabs?.find((tab: { path: string }) => tab.path.endsWith('basic.md'))?.anchor))).toBe(true)
  await page.evaluate(() => {
    const viewport = document.querySelector('.reader-scroll')
    const other = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.includes('theme.md'))
    if (!viewport || !other) throw new Error('Missing reading tabs')
    viewport.scrollTop = 0
    other.click()
  })
  await expect(page.getByRole('tab', { name: 'theme.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'basic.md', exact: true }).click()
  await expect.poll(() => page.locator('.reader-scroll').evaluate((node) => node.scrollTop)).toBe(0)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('md-preview.workspace.v1') ?? '{}').tabs?.find((tab: { path: string }) => tab.path.endsWith('basic.md'))?.anchor)).toBeUndefined()
})

test('link target feedback supports keyboard focus and named anchors', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__M0__?.openText('# Links\n\n[Named target](#legacy)\n\n<a name="legacy"></a>\n\nend', 'named.md'))
  const link = page.getByRole('link', { name: 'Named target' })
  await link.focus()
  await expect(page.getByRole('contentinfo')).toContainText('#legacy')
  await page.keyboard.press('Enter')
  await expect(page.locator('article a[name="legacy"]')).toBeFocused()
  await expect(page.locator('article a[name="legacy"]')).toHaveClass(/md-anchor-flash/)
})

test('over-budget active HTML spills to storage and keeps full search and navigation accessible', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.evaluate(() => {
    const filler = `ordinary ${'x'.repeat(1024)}\n\n`.repeat(50_000)
    return window.__M0__?.openText(`# Start\n\n[Last section](#tail)\n\nfirstneedle\n\n${filler}# Tail\n\nlastneedle`, 'stored-large.md')
  })
  const stats = await page.evaluate(() => window.__M0__?.stats())
  expect(stats?.cache?.retainedHtmlBytes).toBe(0)
  expect(stats?.cache?.storedHtmlBytes).toBeGreaterThan(48 * 1024 * 1024)
  expect(stats?.cache?.overBudgetBytes).toBe(0)
  expect(stats?.segments).toBeGreaterThan(100)
  expect(await page.locator('article p').count()).toBeLessThan(200)
  await page.getByRole('link', { name: 'Last section' }).click()
  await expect(page.locator('article #tail')).toBeFocused()
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: '搜索当前文档' }).fill('needle')
  await expect(page.getByTestId('search-summary')).toHaveText('1 / 2', { timeout: 45_000 })
  await page.getByRole('button', { name: '上一个匹配' }).click()
  await expect(page.getByTestId('search-summary')).toHaveText('2 / 2')
  await expect(page.locator('article #tail')).toBeAttached()
  expect(await page.locator('article p').count()).toBeLessThan(200)
  await page.evaluate(() => window.__M0__?.close())
  await expect.poll(() => page.evaluate(() => window.__M0__?.stats().cache?.storedHtmlBytes)).toBe(0)
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('markdown-preview-derived-segments-v1')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const count = database.transaction('parts', 'readonly').objectStore('parts').count()
      count.onsuccess = () => { database.close(); resolve(count.result) }
      count.onerror = () => { database.close(); reject(count.error) }
    }
  }))).toBe(0)
})
