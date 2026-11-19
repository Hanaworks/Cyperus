import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/core/markdown'

// T06：真实夹具统一调用生产入口，避免测试内部装配与生产实现脱节。

const REPO_ROOT = resolve(__dirname, '../../../..')

function readFixture(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, 'fixtures', rel), 'utf8')
}

async function render(source: string): Promise<string> {
  const result = await renderMarkdown(source)
  return result.segments ? result.segments.map((segment) => segment.html).join('') : result.html
}

describe('生产管线渲染真实夹具', () => {
  it('basic.md 渲染出核心结构', async () => {
    const html = await render(readFixture('basic.md'))

    expect(html).toContain('<h1')
    expect(html).toContain('<h6')
    expect(html).toMatch(/<blockquote\b/)
    expect(html).toMatch(/<ol\b/)
    expect(html).toMatch(/<ul\b/)
    expect(html).toContain('<hr')
    expect(html).toContain('<code>')
  })

  it('extended.md 覆盖全部扩展语法', async () => {
    const html = await render(readFixture('extended.md'))

    expect(html, 'GFM 表格').toMatch(/<table\b/)
    expect(html, 'GFM 删除线').toContain('<s>')
    expect(html, '脚注').toContain('footnote-ref')

    for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
      expect(html, `Alert ${kind}`).toContain(`markdown-alert-${kind}`)
    }

    expect(html, 'KaTeX 行内').toContain('class="katex"')
    expect(html, 'KaTeX 块级').toContain('katex-display')
    expect(html, 'Shiki').toContain('class="shiki')

    expect(html, '原始 HTML 块').toContain('custom-block')
    expect(html, 'details').toContain('<details>')
  })

  it('extended.md 的未知语言不中断整篇渲染（FR-011）', async () => {
    const html = await render(readFixture('extended.md'))

    // zzz-unknown-lang 应降级为纯文本代码块
    expect(html).toContain('md-code--plain')
    // 且后续内容仍在
    expect(html).toContain('表格')
    expect(html).toMatch(/<table\b/)
  })

  it('extended.md 的错误公式不拖垮全文', async () => {
    const html = await render(readFixture('extended.md'))
    expect(html).toContain('mermaid')
    expect(html).toMatch(/<table\b/)
  })

  it('links.md 全部链接类型都被渲染为 <a href>', async () => {
    const html = await render(readFixture('links.md'))

    // ⚠️ markdown-it 会把 href 中的非 ASCII 字符百分号编码（T05 实测），
    // 但标题 id 保持原文。前端跳转时必须先 decodeURIComponent，否则中文锚点全失效。
    // 详见 docs/design/14-link-navigation.md §3.3
    expect(html).toContain('href="#3-%E6%9C%AC%E5%9C%B0-markdown-%E9%93%BE%E6%8E%A5"')
    expect(html).toContain('id="3-本地-markdown-链接"')

    // 本地 md
    expect(html).toContain('href="./tabs/a.md"')
    expect(html).toContain('href="./tabs/B.MD"')
    // 外链
    expect(html).toContain('href="https://example.com"')
    // mailto
    expect(html).toContain('href="mailto:test@example.com"')

    // 危险 scheme 必须被 markdown-it 拦掉
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="JaVaScRiPt:')
    expect(html).not.toMatch(/href="data:text\/html/i)
    expect(html).not.toContain('href="file:///')
  })

  it('锚点 href 的编码形式可被 decodeURIComponent 还原为标题 id', async () => {
    const html = await render(readFixture('links.md'))

    const hrefs = [...html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1])
    const ids = [...html.matchAll(/<h[1-6][^>]*id="([^"]*)"/g)].map((m) => m[1])

    // 取第 3 节的编码 href，解码后应能在标题 id 集合中找到
    const encoded = hrefs.find((h) => h?.startsWith('3-%E6%9C%AC%E5%9C%B0'))
    expect(encoded, '未找到第 3 节的锚点 href').toBeDefined()
    const decoded = decodeURIComponent(encoded as string)
    expect(ids, `解码后的锚点 ${decoded} 没有对应的标题 id`).toContain(decoded)
  })

  it('links.md 中图片包裹链接被正确嵌套', async () => {
    const html = await render(readFixture('links.md'))
    expect(html).toMatch(/<a href="https:\/\/example\.com"[^>]*><img[^>]+>/)
  })

  it('html-safety.md 的危险内容在渲染阶段存在（供后续消毒验证）', async () => {
    const html = await render(readFixture('html-safety.md'))

    // markdown-it 在 html:true 下保留这些，消毒是 DOMPurify 的职责（T25）。
    // 若这里不成立，T25 的用例会变成空转。
    expect(html).toContain('<script>')
    expect(html).toContain('onerror=')
    expect(html).toContain('<iframe')
  })

  it('cjk-typography.md 生成中文标题 id', async () => {
    const html = await render(readFixture('cjk-typography.md'))

    expect(html).toContain('id="纯中文标题"')
    expect(html).toContain('id="中英混排标题-english-mixed-标题"')
    expect(html).toMatch(/id="重复标题"/)
    expect(html).toMatch(/id="重复标题-1"/)
    expect(html).toMatch(/id="重复标题-2"/)
  })

  it('theme.md 覆盖全部视觉元素', async () => {
    const html = await render(readFixture('theme.md'))

    for (let level = 1; level <= 6; level += 1) {
      expect(html, `h${level}`).toContain(`<h${level}`)
    }
    expect(html).toMatch(/<table\b/)
    expect(html).toMatch(/<blockquote\b/)
    expect(html).toContain('<hr')
    expect(html).toContain('class="katex"')
    expect(html).toContain('class="shiki')
    expect(html).toContain('markdown-alert')
  })

  it('tabs/ 全部 20 个文件可渲染且各有唯一标记', async () => {
    const names = [
      'a',
      'B',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
      'm',
      'n',
      'o',
      'p',
      'q',
      'r',
      's',
      't',
    ]

    for (const name of names) {
      const source = readFixture(`tabs/${name}.md`)
      const html = await render(source)
      expect(html, `${name}.md 未渲染标题`).toContain('<h1')
      expect(html, `${name}.md 缺少唯一标记`).toContain(`TAB-MARKER-${name.toUpperCase()}`)
    }
  })

  it('10 MB 文件能在合理时间内渲染（灾难性退化防护）', async () => {
    const source = readFixture('generated/10mb.md')

    const start = performance.now()
    const html = await render(source)
    const elapsed = performance.now() - start

    expect(html.length).toBeGreaterThan(source.length)
    // 这不是性能验收，只是防止出现灾难性回归（例如意外的 O(n²)）。
    // 真实阈值在 M0（T15）实测后写入 ADR-003。
    expect(elapsed, `10 MB 渲染耗时 ${elapsed.toFixed(0)}ms，疑似算法退化`).toBeLessThan(30_000)

    console.log(
      `[bench] 10 MB 渲染: ${elapsed.toFixed(0)} ms, HTML ${(html.length / 1024 / 1024).toFixed(1)} MB`,
    )
  }, 60_000)
})

const fixtureNames = [
  ...readdirSync(resolve(REPO_ROOT, 'fixtures')).filter((name) => name.endsWith('.md')),
  ...readdirSync(resolve(REPO_ROOT, 'fixtures/tabs')).map((name) => `tabs/${name}`),
].filter((name) => name.endsWith('.md')).sort()

describe('固定夹具 golden HTML', () => {
  for (const name of fixtureNames) {
    it(`${name} 与预期 HTML 一致且重复渲染稳定`, async () => {
      const source = readFixture(name)
      const html = await render(source)
      expect(await render(source)).toBe(html)
      await expect(html).toMatchFileSnapshot(resolve(__dirname, '../golden', `${name}.html`))
    })
  }
})
