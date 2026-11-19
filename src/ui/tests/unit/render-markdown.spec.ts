import { describe, expect, it } from 'vitest'
import { DEFAULT_PARSE_OPTIONS, renderMarkdown } from '@/core/markdown'

describe('renderMarkdown 统一渲染入口', () => {
  it('返回设计约定的结果、源码行和 UTF-8 字节数', async () => {
    const result = await renderMarkdown('# 中文标题\n\n正文。\n', { jobId: 7, generation: 3 })

    expect(result).toMatchObject({
      ok: true,
      jobId: 7,
      generation: 3,
      toc: [{ level: 1, text: '中文标题', id: '中文标题', line: 1 }],
      blocks: [{ line: 1, endLine: 1, tag: 'h1' }, { line: 3, endLine: 3, tag: 'p' }],
      mermaidCount: 0,
      unknownLangs: [],
      hasRawHtml: false,
    })
    expect(result.html).toContain('id="中文标题"')
    expect(result.htmlBytes).toBe(new TextEncoder().encode(result.html).byteLength)
    expect(result.parseMs).toBeGreaterThanOrEqual(0)
  })

  it('默认装配任务列表、脚注、Alerts、数学和代码高亮', async () => {
    const { html, hasRawHtml } = await renderMarkdown([
      '- [x] 完成 **任务**', '', '> [!NOTE]', '> 提示', '',
      '数学 $x^2$ 和脚注[^a]。', '', '```js', 'const x = 1', '```', '', '[^a]: 脚注内容',
    ].join('\n'))

    expect(html).toContain('task-list-checkbox')
    expect(html).toContain('disabled')
    expect(html).toContain('<strong>任务</strong>')
    expect(html).toContain('markdown-alert-note')
    expect(html).toContain('footnote-ref')
    expect(html).toContain('class="katex"')
    expect(html).toContain('--shiki-light')
    expect(html).toContain('--shiki-dark')
    expect(hasRawHtml).toBe(false)
  })

  it('功能开关按每次调用生效，且不会污染后续渲染', async () => {
    const text = '> [!NOTE]\n> 提示\n\n$x^2$\n\n```mermaid\ngraph TD; A-->B\n```\n'
    const disabled = await renderMarkdown(text, { alerts: false, math: false, mermaid: false })
    expect(disabled.html).not.toContain('markdown-alert-note')
    expect(disabled.html).not.toContain('class="katex"')
    expect(disabled.html).not.toContain('class="md-mermaid"')
    expect(disabled.mermaidCount).toBe(0)

    const enabled = await renderMarkdown(text)
    expect(enabled.html).toContain('markdown-alert-note')
    expect(enabled.html).toContain('class="katex"')
    expect(enabled.html).toContain('class="md-mermaid"')
    expect(enabled.mermaidCount).toBe(1)
    expect(DEFAULT_PARSE_OPTIONS.math).toBe(true)
  })

  it('原始 HTML 标记包含内联 HTML，但不把生成的图表和复选框算进去', async () => {
    const generated = await renderMarkdown('- [ ] 任务\n\n```mermaid\ngraph TD; A-->B\n```\n')
    expect(generated.hasRawHtml).toBe(false)
    const authored = await renderMarkdown('- 正文 <span>原始 HTML</span>\n')
    expect(authored.hasRawHtml).toBe(true)
    const disabled = await renderMarkdown('<script>alert(1)</script>\n', { html: false })
    expect(disabled.html).not.toContain('<script>')
    expect(disabled.hasRawHtml).toBe(false)
  })

  it('未知语言去重且只属于当前文档，后续内容照常渲染', async () => {
    const result = await renderMarkdown('```not-a-real-lang\nx\n```\n\n```not-a-real-lang\ny\n```\n\n# 后续\n')
    expect(result.unknownLangs).toEqual(['not-a-real-lang'])
    expect(result.html).toContain('md-code--plain')
    expect(result.toc[0]?.text).toBe('后续')
    expect((await renderMarkdown('# 干净文档')).unknownLangs).toEqual([])
  })

  it('生产入口安装链接校验，并标记嵌套的外链与懒加载图片', async () => {
    const { html } = await renderMarkdown('[外链](https://example.com) ![图](./图.png) [危险](javascript:alert(1))')
    expect(html).toContain('data-md-external="1"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('data-md-image="1"')
    expect(html).not.toMatch(/href="javascript:/i)
  })

  it('并发调用和重复渲染不串用统计、选项或标题 id', async () => {
    const source = '# 相同\n\n# 相同\n'
    const [a, b] = await Promise.all([
      renderMarkdown(source, { jobId: 1, generation: 1 }),
      renderMarkdown(source, { jobId: 2, generation: 8, math: false }),
    ])
    expect(a.html).toBe(b.html)
    expect(a.jobId).toBe(1)
    expect(b.jobId).toBe(2)
    expect(b.generation).toBe(8)
    expect(a.toc.map((entry) => entry.id)).toEqual(['相同', '相同-1'])
    expect((await renderMarkdown(source)).html).toBe(a.html)
  })

  it('高亮主题加载失败仍保留代码和正文，后续可恢复默认高亮', async () => {
    const source = '```js\nconst x = 1\n```\n\n# 后续\n'
    const fallback = await renderMarkdown(source, { shikiThemeLight: 'not-a-real-theme' })
    expect(fallback.html).toContain('const x = 1')
    expect(fallback.toc[0]?.text).toBe('后续')
    const recovered = await renderMarkdown(source)
    expect(recovered.html).toContain('class="shiki')
  })

  it('空文档返回空的可序列化结果', async () => {
    const result = await renderMarkdown('')
    expect(result).toMatchObject({ ok: true, jobId: 0, generation: 0, html: '', toc: [], blocks: [], htmlBytes: 0 })
    expect(structuredClone(result)).toEqual(result)
  })
})
