import { writeFile } from 'node:fs/promises'
import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test'
import { openFolderFromMenu, setThemes } from './workbench-helpers'

async function openTreeDocument(page: Page, name: string): Promise<void> {
  await page.getByRole('treeitem', { name: `打开 ${name}`, exact: true }).click()
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('article.md-doc h1').first()).toBeVisible()
}

async function articleColors(page: Page): Promise<string[]> {
  return page.locator('article.md-doc').evaluate((element) => {
    const style = getComputedStyle(element)
    return [style.backgroundColor, style.color]
  })
}

async function contrastMetrics(page: Page, diagnosticsOnly = false) {
  return page.evaluate((onlyDiagnostics) => {
    type Rgb = [number, number, number]
    type Rgba = [number, number, number, number]
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('无法测量界面实际颜色')
    const rgba = (color: string): Rgba => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data
      return [red, green, blue, alpha / 255]
    }
    const blend = ([red, green, blue, alpha]: Rgba, background: Rgb): Rgb => [
      red * alpha + background[0] * (1 - alpha),
      green * alpha + background[1] * (1 - alpha),
      blue * alpha + background[2] * (1 - alpha),
    ]
    const luminance = (color: Rgb): number => {
      const linear = (channel: number): number => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      }
      return linear(color[0]) * 0.2126 + linear(color[1]) * 0.7152 + linear(color[2]) * 0.0722
    }
    const targets: [string, string, number][] = [
      ['toolbar-title', '.window-title', 4.5],
      ['toolbar-unselected', '.menu-trigger[aria-expanded="false"]', 4.5],
      ['toolbar-selected', '.menu-trigger[aria-expanded="true"]', 4.5],
      ['menu-selected', '.command-menu button:focus-visible', 4.5],
      ['menu-unselected', '.command-menu button:not(:focus-visible):not(:disabled)', 4.5],
      ['rail-selected', '.activity-button[aria-pressed="true"]', 3],
      ['rail-unselected', '.activity-button[aria-pressed="false"]', 3],
      ['status-environment', '[data-testid="status-environment"]', 3],
      ['status-path', '.status-document-path', 4.5],
      ['status-directory', '.status-path-directory', 4.5],
      ['status-item', '.status-item', 4.5],
      ['status-theme-label', '.status-theme > span', 4.5],
      ['status-app-theme', '[data-testid="app-theme"]', 4.5],
      ['status-document-theme', '[data-testid="md-theme"]', 4.5],
      ['diagnostics', '.diagnostics', 4.5],
      ['diagnostics-close', '.diagnostics .popup-heading button', 3],
      ['diagnostics-label', '.diagnostics dt', 4.5],
      ['diagnostics-value', '.diagnostics dd', 4.5],
      ['diagnostics-loading', '.diagnostics p', 4.5],
    ]
    return targets.flatMap(([name, selector, minimum]) => {
      if (onlyDiagnostics && !name.startsWith('diagnostics')) return []
      const element = document.querySelector<HTMLElement>(selector)
      if (!element?.getClientRects().length) return []
      const ancestors: Element[] = []
      for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current)
      const background = ancestors.reduce<Rgb>((color, ancestor) => blend(rgba(getComputedStyle(ancestor).backgroundColor), color), [255, 255, 255])
      const color = getComputedStyle(element).color
      const foreground = blend(rgba(color), background)
      const foregroundLuminance = luminance(foreground)
      const backgroundLuminance = luminance(background)
      const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      return [{ name, selector, color, foreground, background, ratio: Number(ratio.toFixed(3)), minimum }]
    })
  }, diagnosticsOnly)
}

function assertContrast(samples: Awaited<ReturnType<typeof contrastMetrics>>): void {
  for (const sample of samples) {
    expect(sample.foreground, `${sample.name}的前景应与背景区分`).not.toEqual(sample.background)
    expect(sample.ratio, `${sample.name}的实际对比度应可读`).toBeGreaterThanOrEqual(sample.minimum)
  }
}

async function assertControlsAccessible(page: Page) {
  const statusbar = page.getByRole('contentinfo')
  const controls: [string, Locator][] = [
    ['文件菜单', page.getByTestId('menu-file')],
    ['查看菜单', page.getByTestId('menu-view')],
    ['帮助菜单', page.getByTestId('menu-help')],
    ['文件面板', page.getByTestId('activity-files')],
    ['搜索面板', page.getByTestId('activity-search')],
    ['大纲面板', page.getByTestId('activity-outline')],
    ['界面主题', statusbar.getByRole('combobox', { name: '界面主题', exact: true })],
    ['正文主题', statusbar.getByRole('combobox', { name: '正文主题', exact: true })],
    ['环境信息', statusbar.getByTestId('status-environment')],
  ]
  for (const [name, control] of controls) {
    await expect(control, `${name}应可见`).toBeVisible()
    await expect(control, `${name}应完整位于窗口内`).toBeInViewport({ ratio: 1 })
    await expect(control, `${name}应可操作`).toBeEnabled()
    await control.click({ trial: true })
  }
  for (const name of ['最小化', '最大化', '关闭窗口']) {
    const control = page.getByRole('button', { name, exact: true })
    await expect(control).toBeVisible()
    await expect(control).toBeInViewport({ ratio: 1 })
    // 浏览器没有桌面窗口；原生调用由桥接单测与桌面复验覆盖。
    await expect(control).toBeDisabled()
  }
  await page.getByTestId('menu-file').click()
  for (const name of ['打开文件…', '打开文件夹…']) {
    const item = page.getByRole('menuitem', { name, exact: true })
    await expect(item).toBeVisible()
    await expect(item).toBeInViewport({ ratio: 1 })
    await expect(item).toBeEnabled()
  }
  await page.keyboard.press('Escape')
  await statusbar.getByTestId('status-environment').click()
  const diagnostics = statusbar.getByRole('dialog', { name: '环境信息', exact: true })
  await expect(diagnostics).toBeVisible()
  await expect(diagnostics).toBeInViewport({ ratio: 1 })
  const diagnosticBounds = await diagnostics.boundingBox()
  const statusBounds = await statusbar.boundingBox()
  if (!diagnosticBounds || !statusBounds) throw new Error('环境信息与状态栏的布局区域缺失')
  const bottomGap = statusBounds.y - diagnosticBounds.y - diagnosticBounds.height
  expect(bottomGap, '环境信息浮层应锚定在底部状态栏上方').toBeGreaterThanOrEqual(0)
  expect(bottomGap, '环境信息浮层应紧邻底部状态栏').toBeLessThanOrEqual(8)
  const diagnosticsContrast = await contrastMetrics(page, true)
  expect(diagnosticsContrast.map(({ name }) => name)).toEqual(expect.arrayContaining(['diagnostics', 'diagnostics-close']))
  assertContrast(diagnosticsContrast)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(diagnostics).toBeHidden()
  await expect(statusbar.getByTestId('app-theme')).toBeVisible()
  await expect(statusbar.getByTestId('md-theme')).toBeVisible()
  for (const control of [statusbar.getByTestId('app-theme'), statusbar.getByTestId('md-theme'), statusbar.getByTestId('status-environment')]) {
    const bounds = await control.boundingBox()
    if (!bounds) throw new Error('底部主题或环境控件的布局区域缺失')
    expect(bounds.y, '底部控件应位于状态栏内部').toBeGreaterThanOrEqual(statusBounds.y)
    expect(bounds.y + bounds.height, '底部控件不应超出状态栏').toBeLessThanOrEqual(statusBounds.y + statusBounds.height)
    expect(bounds.x, '底部控件应位于状态栏宽度内').toBeGreaterThanOrEqual(statusBounds.x)
    expect(bounds.x + bounds.width, '底部控件不应超出状态栏宽度').toBeLessThanOrEqual(statusBounds.x + statusBounds.width)
  }
  return diagnosticsContrast
}

async function assertPanelLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const node = [...document.querySelectorAll(selector)].find((element) => element.getClientRects().length > 0)
      if (!node) throw new Error(`布局区域缺失：${selector}`)
      const { top, right, bottom, left, width, height } = node.getBoundingClientRect()
      return { top, right, bottom, left, width, height }
    }
    const article = document.querySelector<HTMLElement>('article.md-doc')
    const scroll = document.querySelector<HTMLElement>('.reader-scroll')
    if (!article || !scroll) throw new Error('阅读区域缺失')
    const style = getComputedStyle(article)
    return {
      titlebar: rect('.workbench-titlebar'), menubar: rect('.workbench-menubar'),
      windowTitle: rect('.window-title'), windowControls: rect('.window-controls'),
      workspace: rect('.workspace'), activity: rect('.activity-bar'), statusbar: rect('.statusbar'),
      sidebar: rect('[data-testid="workbench-sidebar"]'), reader: rect('.reading-area'), tabs: rect('.document-tabs'),
      sidebarTitle: rect('.explorer-header, .search-panel h2, .sidebar h2'),
      path: rect('.statusbar [aria-label="文档路径"]'), scroll: rect('.reader-scroll'), article: rect('article.md-doc'),
      viewportHeight: innerHeight,
      scrollClientWidth: scroll.clientWidth, scrollClientLeft: scroll.clientLeft,
      articleRadius: style.borderRadius, articleShadow: style.boxShadow,
    }
  })
  // 验证连续工作区的接缝、标题对齐与文章铺满阅读面。
  expect(layout.titlebar.height).toBe(30)
  expect(layout.statusbar.height).toBe(22)
  expect(layout.menubar.top).toBe(layout.titlebar.top)
  expect(layout.menubar.bottom).toBeLessThanOrEqual(layout.titlebar.bottom)
  expect(layout.menubar.right, '菜单不能覆盖文档标题').toBeLessThanOrEqual(layout.windowTitle.left)
  expect(layout.windowTitle.right, '文档标题不能覆盖窗口控制').toBeLessThanOrEqual(layout.windowControls.left)
  expect(Math.abs(layout.titlebar.bottom - layout.workspace.top)).toBeLessThanOrEqual(1)
  expect(layout.activity.left).toBe(layout.workspace.left)
  expect(layout.activity.width).toBe(48)
  expect(Math.abs(layout.activity.right - layout.sidebar.left)).toBeLessThanOrEqual(1)
  for (const panel of [layout.activity, layout.sidebar, layout.reader]) {
    expect(panel.top, '面板应与工作区顶边衔接').toBe(layout.workspace.top)
    expect(panel.bottom, '面板应与工作区底边衔接').toBe(layout.workspace.bottom)
  }
  expect(layout.reader.left).toBe(layout.sidebar.right)
  expect(layout.reader.right).toBe(layout.workspace.right)
  expect(layout.tabs.height).toBe(35)
  expect(layout.sidebarTitle.top).toBe(layout.tabs.top)
  expect(layout.sidebarTitle.bottom).toBe(layout.tabs.bottom)
  expect(Math.abs(layout.tabs.top - layout.reader.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.tabs.left - layout.reader.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.tabs.right - layout.reader.right)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.tabs.bottom - layout.scroll.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.scroll.left - layout.reader.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.scroll.right - layout.reader.right)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.scroll.bottom - layout.reader.bottom)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.workspace.bottom - layout.statusbar.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.statusbar.bottom - layout.viewportHeight)).toBeLessThanOrEqual(1)
  expect(layout.path.top).toBeGreaterThanOrEqual(layout.statusbar.top)
  expect(layout.path.bottom).toBeLessThanOrEqual(layout.statusbar.bottom)
  expect(Math.abs(layout.article.top - layout.scroll.top)).toBeLessThanOrEqual(1)
  const contentLeft = layout.scroll.left + layout.scrollClientLeft
  expect(Math.abs(layout.article.left - contentLeft)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.article.right - contentLeft - layout.scrollClientWidth)).toBeLessThanOrEqual(1)
  expect(layout.article.height, '文章应至少铺满阅读面高度').toBeGreaterThanOrEqual(layout.scroll.height)
  expect(layout.articleRadius).toBe('0px')
  expect(layout.articleShadow).toBe('none')
  return layout
}

async function fontMetrics(page: Page) {
  const contrast = await contrastMetrics(page)
  expect(contrast.map(({ name }) => name)).toEqual(expect.arrayContaining([
    'toolbar-title', 'toolbar-unselected', 'rail-selected', 'rail-unselected',
    'status-environment', 'status-path', 'status-theme-label', 'status-app-theme', 'status-document-theme',
  ]))
  assertContrast(contrast)
  const computed = await page.evaluate(async () => {
    await document.fonts.ready
    const nodes = ['body', 'article.md-doc', 'article.md-doc h1', 'article.md-doc p'].map((selector) => {
      const element = document.querySelector(selector)
      if (!element) return { selector, missing: true }
      const style = getComputedStyle(element)
      const text = element.textContent?.trim().slice(0, 60) || '中文阅读 Markdown'
      return {
        selector,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        fontSetCheck: document.fonts.check(`${style.fontSize} ${style.fontFamily}`, text),
        text,
      }
    })
    const families = ['Microsoft YaHei', 'Microsoft YaHei UI', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Segoe UI', 'SimSun']
    return {
      viewport: { width: innerWidth, height: innerHeight },
      appTheme: document.documentElement.dataset.appTheme,
      markdownTheme: document.querySelector<HTMLElement>('article.md-doc')?.dataset.mdTheme,
      nodes,
      fontSetChecks: Object.fromEntries(families.map((family) => [family, document.fonts.check(`16px "${family}"`, '中文阅读')])),
    }
  })
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.enable')
    await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    const platformFonts = await Promise.all(['body', 'article.md-doc p', 'article.md-doc h1'].map(async (selector) => {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
      if (!nodeId) return { selector, missing: true, fonts: [] }
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
      return { selector, fonts }
    }))
    return {
      ...computed,
      contrast,
      fontSetCheckNote: 'document.fonts.check reports FontFaceSet readiness, not whether a system font exists. platformFonts records actual rendered font usage.',
      platformFonts,
    }
  } finally {
    await session.detach()
  }
}

async function capturePreview(page: Page, testInfo: TestInfo, name: string, panel: 'files' | 'search' | 'outline' = 'files', overlay?: 'menu' | 'environment') {
  await page.locator('.reader-scroll').evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(() => page.locator('.reader-scroll').evaluate((element) => element.scrollTop)).toBe(0)
  await expect(page.getByTestId(`activity-${panel}`)).toHaveAttribute('aria-pressed', 'true')
  if (panel === 'files') {
    await expect(page.getByRole('tree', { name: '文件浏览器' })).toBeVisible()
    await expect(page.getByRole('treeitem', { name: '打开 basic.md', exact: true })).toBeVisible()
    await expect(page.getByRole('treeitem', { name: '打开 basic.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  }
  await expect(page.getByRole('tab', { name: 'basic.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'basic.md', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('tab', { name: 'extended.md', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.locator('article.md-doc h1').first()).toHaveText('基础语法测试样本')
  await expect(page.locator('article.md-doc h1').first()).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('contentinfo').getByRole('navigation', { name: '文档路径', exact: true })).toContainText('basic.md')
  const diagnosticsContrast = await assertControlsAccessible(page)
  if (overlay === 'menu') {
    await page.getByTestId('menu-file').focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menu', { name: '文件', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '打开文件…', exact: true })).toBeFocused()
  } else if (overlay === 'environment') {
    await page.getByTestId('status-environment').click()
    await expect(page.getByRole('dialog', { name: '环境信息', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '关闭环境信息', exact: true })).toBeFocused()
  }
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.documentElement.clientWidth
    return document.documentElement.scrollWidth <= viewport && document.body.scrollWidth <= viewport
  }), { message: `${name} 不应出现窗口横向溢出` }).toBe(true)
  const layout = await assertPanelLayout(page)
  const metrics = await fontMetrics(page)
  if (overlay === 'menu') {
    expect(metrics.contrast.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'toolbar-selected', 'toolbar-unselected', 'menu-selected', 'menu-unselected',
    ]))
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: false, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
  if (overlay) await page.keyboard.press('Escape')
  return { name, ...metrics, layout, diagnosticsContrast }
}

test('VS Code 工作台浅色默认、深色、窄窗口与搜索大纲实际预览', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const metrics: Awaited<ReturnType<typeof capturePreview>>[] = []
  try {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')
    await openFolderFromMenu(page)
    await openTreeDocument(page, 'basic.md')
    await openTreeDocument(page, 'extended.md')
    await expect(page.getByRole('tab')).toHaveCount(2)
    await page.getByRole('tab', { name: 'basic.md', exact: true }).click()
    await expect(page.locator('article.md-doc h1').first()).toBeVisible()
    await expect(page.locator('article.md-doc')).toHaveAttribute('data-md-theme', 'light')

    // 正式应用没有开发样本工具条；预览只隐藏这一条，不替换或合成界面。
    await page.locator('.fixturebar').evaluate((element) => { (element as HTMLElement).style.display = 'none' })
    await expect(page.getByTestId('fixture-select')).toBeHidden()
    await page.setViewportSize({ width: 1440, height: 900 })
    const lightColors = await articleColors(page)
    metrics.push(await capturePreview(page, testInfo, 'light-1440'))
    metrics.push(await capturePreview(page, testInfo, 'menu-light-1440', 'files', 'menu'))
    metrics.push(await capturePreview(page, testInfo, 'environment-light-1440', 'files', 'environment'))

    await setThemes(page, 'dark')
    expect(await articleColors(page), '界面深色不应改变浅色正文').toEqual(lightColors)
    await setThemes(page, undefined, 'dark')
    expect(await articleColors(page), '正文深色应实际改变正文颜色').not.toEqual(lightColors)
    metrics.push(await capturePreview(page, testInfo, 'dark-1440'))
    metrics.push(await capturePreview(page, testInfo, 'menu-dark-1440', 'files', 'menu'))

    await setThemes(page, 'light', 'light')
    await page.setViewportSize({ width: 1024, height: 900 })
    metrics.push(await capturePreview(page, testInfo, 'light-1024'))
    await page.setViewportSize({ width: 640, height: 900 })
    metrics.push(await capturePreview(page, testInfo, 'light-640'))

    await page.setViewportSize({ width: 1440, height: 900 })
    await setThemes(page, undefined, 'paper')
    metrics.push(await capturePreview(page, testInfo, 'paper-1440'))
    await setThemes(page, undefined, 'light')
    await page.keyboard.press('Control+f')
    await page.getByRole('textbox', { name: '搜索当前文档' }).fill('CommonMark')
    await expect(page.getByTestId('search-summary')).not.toHaveText('0 个匹配')
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('md-reader-search-current')?.size ?? 0)).toBeGreaterThan(0)
    metrics.push(await capturePreview(page, testInfo, 'search-light-1440', 'search'))

    await page.getByTestId('activity-outline').click()
    await expect(page.getByRole('navigation', { name: '文档目录' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '文档目录' }).getByRole('button').first()).toContainText('基础语法测试样本')
    await expect.poll(() => page.evaluate(() => CSS.highlights.has('md-reader-search'))).toBe(false)
    metrics.push(await capturePreview(page, testInfo, 'outline-light-1440', 'outline'))
  } finally {
    const path = testInfo.outputPath('font-metrics.json')
    await writeFile(path, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8')
    await testInfo.attach('font-metrics', { path, contentType: 'application/json' })
  }
})
