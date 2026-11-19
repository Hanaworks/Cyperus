import { expect, type Page, test } from '@playwright/test'

async function renderDiagram(page: Page, code: string) {
  return page.evaluate(async (source) => {
    const modulePath = '/src/reader/MermaidLayer.ts'
    const { MermaidLayer } = await import(modulePath)
    const article = document.createElement('article')
    article.className = 'md-doc'
    article.dataset.mdTheme = 'light'
    article.dataset.testMermaid = 'true'
    const node = document.createElement('div')
    node.className = 'md-mermaid'
    node.dataset.code = btoa(Array.from(new TextEncoder().encode(source), (byte) => String.fromCharCode(byte)).join(''))
    article.append(node)
    document.body.append(article)
    const layer = new MermaidLayer(article, 'light')
    await layer.renderAll()
    const state = node.dataset.state
    layer.dispose()
    return state
  }, code)
}

test('Mermaid 图片元数据在调用渲染器之前拒绝，不尝试设置 Image.src 或发送图片请求', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://example.test/')) requests.push(request.url())
  })
  await page.route('https://example.test/**', (route) => route.abort())
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    if (!descriptor?.set) throw new Error('Image.src setter unavailable')
    const setSource = descriptor.set
    const attempts: string[] = []
    Object.defineProperty(window, '__mermaidImageAttempts', { value: attempts })
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value: string) { attempts.push(value); setSource.call(this, value) },
    })
  })
  await page.goto('/')

  const state = await renderDiagram(page, 'flowchart TD\n A@{ img: "https://example.test/leak.png", label: "X" }')

  expect(await page.evaluate(() => (window as unknown as { __mermaidImageAttempts: string[] }).__mermaidImageAttempts)).toEqual([])
  expect(requests).toEqual([])
  expect(state).toBe('error')
  await expect(page.locator('[data-test-mermaid] p')).toContainText('不支持')
  await expect(page.locator('[data-test-mermaid] details pre')).toContainText('https://example.test/leak.png')
})

test('真实 Mermaid SVG 的边与箭头保持可见', async ({ page }) => {
  await page.goto('/')
  expect(await renderDiagram(page, 'graph TD\n A[开始] --> B[结束]')).toBe('done')
  const edge = page.locator('[data-test-mermaid] svg path.flowchart-link')
  await expect(edge).toHaveCount(1)
  const paint = await edge.evaluate((node) => {
    const style = getComputedStyle(node)
    return { stroke: style.stroke, width: Number.parseFloat(style.strokeWidth), fill: style.fill, marker: style.markerEnd }
  })
  expect(paint.stroke).not.toBe('none')
  expect(paint.width).toBeGreaterThan(0)
  expect(paint.fill).toBe('none')
  expect(paint.marker).not.toBe('none')
  const arrow = page.locator('[data-test-mermaid] svg marker path').first()
  expect(await arrow.evaluate((node) => getComputedStyle(node).fill)).not.toBe('none')
})

test('时序图和饼图保留真实绘制样式', async ({ page }) => {
  await page.goto('/')
  expect(await renderDiagram(page, 'sequenceDiagram\n Alice->>Bob: hello')).toBe('done')
  const sequence = page.locator('[data-test-mermaid] svg .messageLine0').first()
  expect(await sequence.evaluate((node) => getComputedStyle(node).stroke)).not.toBe('none')
  expect(await renderDiagram(page, 'pie title 分布\n "甲" : 40\n "乙" : 60')).toBe('done')
  const fills = await page.locator('[data-test-mermaid] svg path.pieCircle').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fill))
  expect(fills).toHaveLength(2)
  expect(fills[0]).not.toBe('none')
  expect(fills[0]).not.toBe(fills[1])
})

test('SVG 消毒保留图内安全绘制规则，丢弃越界 CSS、外链、资源元素与事件', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const modulePath = '/src/reader/svg.ts'
    const { sanitizeSvg } = await import(modulePath)
    const clean = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" id="md-graph-99999" onload="alert(1)">
      <style>
        @import url("https://example.test/import.css");
        body { display:none; }
        #md-graph-99999 + .app-shell { display:none; }
        #md-graph-99999 .edge { stroke:#123456; fill:none; position:fixed; background-image:url(https://example.test/paint.png); }
        #md-graph-99999 .unsafe { fill:url(https://example.test/fill.svg); }
      </style>
      <foreignObject><img src="https://example.test/foreign.png" /></foreignObject>
      <image href="https://example.test/image.png" />
      <feImage href="https://example.test/filter.png" />
      <use href="https://example.test/use.svg#x" />
      <a href="https://example.test/link"><text>link</text></a>
      <path class="edge" d="M0 0L20 20" style="stroke:#345678;fill:none" onclick="alert(1)"/>
      <path class="unsafe" d="M0 0L20 20" fill="url(https://example.test/attr.svg)"/>
    </svg>`, 'md-graph-99999')
    const host = document.createElement('div')
    host.innerHTML = clean
    document.body.append(host)
    const edge = host.querySelector('.edge')
    if (!edge) throw new Error('Sanitized edge missing')
    return { clean, stroke: getComputedStyle(edge).stroke, fill: getComputedStyle(edge).fill }
  })
  expect(result.clean).not.toMatch(/https:|onload|onclick|foreignObject|<image|<feImage|<use|<a\b|position|\.app-shell|body\s*\{/i)
  expect(result.clean).toContain('#md-graph-99999 .edge')
  expect(result.stroke).toBe('rgb(52, 86, 120)')
  expect(result.fill).toBe('none')
  await expect(page.locator('.app-shell')).toBeVisible()
})
