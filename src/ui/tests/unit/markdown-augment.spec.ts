import katexPlugin from '@vscode/markdown-it-katex'
import katex from 'katex'
import githubAlerts from 'markdown-it-github-alerts'
import type { Highlighter } from 'shiki'
import { createHighlighter } from 'shiki'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MarkdownRenderEnv } from '@/core/markdown/augment'
import { installAugmentRules } from '@/core/markdown/augment'
import { installHighlighter } from '@/core/markdown/plugins'
import { createMarkdownIt, MARKDOWN_IT_OPTIONS } from '@/core/markdown/preset'
import { installTaskList } from '@/core/markdown/rules/taskList'

function makeMarkdown(mermaid = true) {
  const md = createMarkdownIt()
  installAugmentRules(md, { mermaid })
  return md
}

function openingTags(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? []
}

describe('顶层源码行与 blocks', () => {
  it('独立块级公式标记实际的外层 p，并保留生成公式的快速路径', () => {
    const md = createMarkdownIt()
    md.use(katexPlugin, { katex, throwOnError: false })
    installAugmentRules(md, { mermaid: true })
    const env: MarkdownRenderEnv = {}
    const html = md.render('$$\nx^2\n$$\n', env)

    expect(env.blocks).toEqual([{ line: 1, endLine: 3, tag: 'p' }])
    expect(openingTags(html, 'p')[0]).toContain('class="katex-block"')
    expect(openingTags(html, 'p')[0]).toContain('data-src-line="1"')
    expect(openingTags(html, 'p')[0]).toContain('data-src-end="3"')
    expect(html.match(/data-src-line=/g)).toHaveLength(1)
    expect(env.hasRawHtml).toBe(false)
  })

  it.each([
    ['> $$\n> x^2\n> $$\n', 'blockquote'],
    ['- $$\n  x^2\n  $$\n', 'ul'],
  ])('嵌套公式仅标记外层 %s', (source, tag) => {
    const md = createMarkdownIt()
    md.use(katexPlugin, { katex, throwOnError: false })
    installAugmentRules(md, { mermaid: true })
    const env: MarkdownRenderEnv = {}
    const html = md.render(source, env)

    expect(env.blocks).toEqual([{ line: 1, endLine: 3, tag }])
    expect(html).toContain('class="katex-block"')
    expect(openingTags(html, 'p').every((opening) => !opening.includes('data-src-'))).toBe(true)
    expect(html.match(/data-src-line=/g)).toHaveLength(1)
  })

  it('覆盖容器、自闭合块和两种代码块，只标记顶层元素', () => {
    const source = '# 标题\n\n段落\n续行\n\n- 一级\n  - 嵌套\n\n1. 编号\n\n> 引用\n>\n> 次段\n\n| 列 |\n| --- |\n| 值 |\n\n---\n\n```js\nconst value = 1\n```\n\n    缩进代码\n    第二行\n\n```mermaid\ngraph TD; A-->B\n```\n'
    const env: MarkdownRenderEnv = {}
    const html = makeMarkdown().render(source, env)

    expect(env.blocks).toEqual([
      { line: 1, endLine: 1, tag: 'h1' },
      { line: 3, endLine: 4, tag: 'p' },
      { line: 6, endLine: 8, tag: 'ul' },
      { line: 9, endLine: 10, tag: 'ol' },
      { line: 11, endLine: 13, tag: 'blockquote' },
      { line: 15, endLine: 17, tag: 'table' },
      { line: 19, endLine: 19, tag: 'hr' },
      { line: 21, endLine: 23, tag: 'pre' },
      { line: 25, endLine: 26, tag: 'pre' },
      { line: 28, endLine: 30, tag: 'div' },
    ])
    expect(html.match(/data-src-line=/g)).toHaveLength(10)
    expect(html).toContain('<h1 data-src-line="1" data-src-end="1">')
    expect(html).toContain('<hr data-src-line="19" data-src-end="19">')
    expect(openingTags(html, 'pre')[0]).toContain('data-src-line="21"')
    expect(openingTags(html, 'pre')[1]).toContain('data-src-end="26"')
    expect(openingTags(html, 'code').every((tag) => !tag.includes('data-src-'))).toBe(true)
    expect(openingTags(html, 'li').every((tag) => !tag.includes('data-src-'))).toBe(true)
  })

  it('Alert 自定义 renderer 仍把行号放到顶层 div', () => {
    const md = createMarkdownIt()
    md.use(githubAlerts)
    installAugmentRules(md, { mermaid: true })
    const env: MarkdownRenderEnv = {}
    const html = md.render('> [!NOTE]\n> 提示\n', env)

    expect(env.blocks).toEqual([{ line: 1, endLine: 2, tag: 'div' }])
    expect(openingTags(html, 'div')[0]).toContain('data-src-line="1"')
    expect(openingTags(html, 'div')[0]).toContain('data-src-end="2"')
    expect(env.hasRawHtml).toBe(false)
  })
})

describe('Mermaid 安全占位', () => {
  it('使用专用 token，以 UTF-8 base64 保存中文和脚本字符串', () => {
    const md = makeMarkdown()
    const env: MarkdownRenderEnv = {}
    const code = 'graph TD\n甲["中文 😀 </div><script>alert(1)</script>"] --> 乙\n'
    const tokens = md.parse(`前言\n\n\`\`\`mermaid title="示例"\n${code}\`\`\`\n`, env)
    const html = md.renderer.render(tokens, md.options, env)
    const placeholder = tokens.find((token) => token.attrGet('data-mermaid-id'))

    expect(placeholder).toBeDefined()
    expect(placeholder?.type).not.toMatch(/^(?:fence|html_block|html_inline)$/)
    expect(html).toContain('class="md-mermaid"')
    expect(html).toContain('data-src-line="3"')
    expect(html).toContain('data-src-end="6"')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('中文')
    const encoded = html.match(/data-code="([^"]*)"/)?.[1]
    expect(encoded).toBeDefined()
    const bytes = Uint8Array.from(atob(encoded ?? ''), (character) => character.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe(code)
    expect(env.mermaidCount).toBe(1)
    expect(env.hasRawHtml).toBe(false)
  })

  it('同篇 id 唯一，同一实例重复解析 id 稳定且统计重置', () => {
    const md = makeMarkdown()
    const env: MarkdownRenderEnv = {}
    const source = '```mermaid\ngraph TD; A-->B\n```\n\n```MERMAID\ngraph TD; C-->D\n```\n'
    const first = md.render(source, env)
    const firstIds = [...first.matchAll(/data-mermaid-id="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(firstIds).size).toBe(2)
    expect(env.mermaidCount).toBe(2)
    expect(md.render(source, env)).toBe(first)
    expect(env.mermaidCount).toBe(2)
    expect(env.blocks).toHaveLength(2)

    md.render('普通正文\n', env)
    expect(env.mermaidCount).toBe(0)
    expect(env.blocks).toEqual([{ line: 1, endLine: 1, tag: 'p' }])
    expect(env.hasRawHtml).toBe(false)
  })

  it('关闭 Mermaid 时保留转义的纯代码块', () => {
    const env: MarkdownRenderEnv = {}
    const html = makeMarkdown(false).render('```mermaid\n<script>中文</script>\n```\n', env)
    expect(html).toContain('<pre data-src-line="1" data-src-end="3">')
    expect(html).toContain('language-mermaid')
    expect(html).toContain('&lt;script&gt;中文&lt;/script&gt;')
    expect(html).not.toContain('md-mermaid')
    expect(env.blocks).toEqual([{ line: 1, endLine: 3, tag: 'pre' }])
    expect(env.mermaidCount).toBe(0)
    expect(env.hasRawHtml).toBe(false)
  })

  it('嵌套图表可占位，但不额外注入源码行标记', () => {
    const env: MarkdownRenderEnv = {}
    const html = makeMarkdown().render('> ```mermaid\n> graph TD; A-->B\n> ```\n', env)
    expect(html).toContain('md-mermaid')
    expect(env.mermaidCount).toBe(1)
    expect(env.blocks).toEqual([{ line: 1, endLine: 3, tag: 'blockquote' }])
    expect(html.match(/data-src-line=/g)).toHaveLength(1)
  })

  it('大图表编码不通过展开参数触发调用栈溢出', () => {
    const code = `graph TD\n${'甲-->乙\n'.repeat(40_000)}`
    const env: MarkdownRenderEnv = {}
    const html = makeMarkdown().render(`\`\`\`mermaid\n${code}\`\`\`\n`, env)
    const encoded = html.match(/data-code="([^"]*)"/)?.[1]
    expect(encoded).toBeDefined()
    expect(atob(encoded ?? '').length).toBe(new TextEncoder().encode(code).length)
    expect(env.mermaidCount).toBe(1)
  })
})

describe('作者原始 HTML 检测', () => {
  it('关闭 HTML 时将 Alert 自定义标题中的标签转义为文本', () => {
    const md = createMarkdownIt({ ...MARKDOWN_IT_OPTIONS, html: false })
    md.use(githubAlerts)
    installAugmentRules(md, { mermaid: true })
    const env: MarkdownRenderEnv = {}
    const tokens = md.parse('> [!NOTE] <img src="x" onerror="alert(1)"> & 标题\n> 正文\n', env)
    const html = md.renderer.render(tokens, md.options, env)

    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt; &amp; 标题')
    expect(env.hasRawHtml).toBe(false)
    expect(md.renderer.render(tokens, md.options, env)).toBe(html)
  })

  it('Alert 插件提取的自定义标题若含 HTML 仍要求消毒', () => {
    const md = createMarkdownIt()
    md.use(githubAlerts)
    installAugmentRules(md, { mermaid: true })
    const env: MarkdownRenderEnv = {}
    const html = md.render('> [!NOTE] <img src="x" onerror="alert(1)">\n> 正文\n', env)
    expect(html).toContain('onerror=')
    expect(env.hasRawHtml).toBe(true)
  })

  it('仅含生成的 checkbox 与 Mermaid 时不触发原始 HTML 标记', () => {
    const md = createMarkdownIt()
    installTaskList(md)
    installAugmentRules(md, { mermaid: true })
    const env: MarkdownRenderEnv = {}
    const html = md.render('- [x] 完成\n\n```mermaid\ngraph TD; A-->B\n```\n', env)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('md-mermaid')
    expect(env.hasRawHtml).toBe(false)
  })

  it.each([
    '<div>原始块</div>\n',
    '正文 <span>原始行内</span>\n',
    '> 引用内 **加粗 <i>HTML</i>**\n',
    '- 项目\n  - 嵌套 <img src="x" onerror="alert(1)">\n',
  ])('递归检测作者原始 HTML：%s', (source) => {
    const env: MarkdownRenderEnv = {}
    makeMarkdown().render(source, env)
    expect(env.hasRawHtml).toBe(true)
  })

  it('代码与转义 HTML 不误判，复用 env 不保留旧结果', () => {
    const md = makeMarkdown()
    const env: MarkdownRenderEnv = {}
    md.render('<div>原始</div>\n', env)
    expect(env.hasRawHtml).toBe(true)
    md.render('```html\n<script>alert(1)</script>\n```\n\n`<b>代码</b>` &lt;i&gt;文本\n', env)
    expect(env.hasRawHtml).toBe(false)
  })
})

describe('行内链接与图片', () => {
  it('遍历 inline.children，为外链和图片添加属性', () => {
    const html = makeMarkdown().render('**[安全链接](https://example.com)** [HTTP](http://example.com) [邮件](mailto:test@example.com) [![图片](img.png)](https://example.com/image)\n')
    const links = openingTags(html, 'a')
    expect(links).toHaveLength(4)
    for (const link of links) {
      expect(link).toContain('rel="noopener noreferrer"')
      expect(link).toContain('data-md-external="1"')
    }
    const image = openingTags(html, 'img')[0]
    expect(image).toContain('loading="lazy"')
    expect(image).toContain('decoding="async"')
    expect(image).toContain('data-md-image="1"')
  })

  it('本地链接和文内锚点不加外链标记', () => {
    const html = makeMarkdown().render('[本地](./文档.md) [锚点](#目标)\n')
    expect(html).not.toContain('data-md-external')
    expect(html).not.toContain('rel=')
  })
})

describe('Shiki fence 的源码行属性', () => {
  let highlighter: Highlighter
  beforeAll(async () => {
    highlighter = await createHighlighter({ themes: ['github-light', 'github-dark'], langs: ['javascript'] })
  })
  afterAll(() => highlighter?.dispose())

  it.each([
    ['js', 'shiki'],
    ['zzz-unknown-lang', 'md-code--plain'],
    ['mermaid', 'md-code--mermaid'],
  ])('%s 高亮或降级后仍在 pre 上标行号', (language, expectedClass) => {
    const md = createMarkdownIt()
    installHighlighter(md, {
      highlighter,
      themeLight: 'github-light',
      themeDark: 'github-dark',
      unknownLangs: new Set(),
    })
    // 单独验证高亮 renderer 消费 Token 契约，避免 augment 的兜底包装掩盖回归。
    const tokens = md.parse(`前言\n\n\`\`\`${language}\nconst value = 1\n\`\`\`\n`, {})
    const fence = tokens.find((token) => token.type === 'fence')
    expect(fence).toBeDefined()
    fence?.attrSet('data-src-line', '3')
    fence?.attrSet('data-src-end', '5')
    const html = md.renderer.render(tokens, md.options, {})
    const pre = openingTags(html, 'pre')[0]
    expect(pre).toContain(expectedClass)
    expect(pre).toContain('data-src-line="3"')
    expect(pre).toContain('data-src-end="5"')
    expect(openingTags(html, 'code')[0]).not.toContain('data-src-')
  })
})
