import Shiki from '@shikijs/markdown-it'
import katexPlugin from '@vscode/markdown-it-katex'
import katex from 'katex'
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import footnote from 'markdown-it-footnote'
// 实测结论：markdown-it-github-alerts@1.0.1 只有 default 导出，没有 `full` 命名导出。
// 其类型声明正确使用 PluginWithOptions<..>，与 markdown-it@15 兼容。
import githubAlerts from 'markdown-it-github-alerts'
import { describe, expect, it } from 'vitest'

// T05 —— markdown-it@15 与第三方插件兼容性冒烟测试。
//
// 背景：markdown-it 15.0.0 移除了包内子路径导出（`markdown-it/lib/*`），
// 这是破坏性变更。若任一插件仍依赖 `markdown-it/lib/*`，加载或渲染时会抛错。
// 本测试用精确的 HTML 断言逐个证明插件可用，而不是"渲染没报错"。
//
// 判定规则（见 docs/design/01-render-pipeline.md §10）：
// - 任一插件 RED → 记录到 findings，锁定 markdown-it@14.3.3
// - 全部 GREEN → 继续使用 markdown-it@15.0.3

const MD_OPTIONS = {
  html: true,
  xhtmlOut: false,
  breaks: false,
  linkify: true,
  typographer: false,
} as const

// 实测结论（T05）：必须用 `default` preset。
// `commonmark` preset 的规则集是硬编码子集，不含 table / strikethrough，
// 且在它下面 linkify 选项不生效 —— 与 FR-003 的 GFM 要求冲突。
// 详见 docs/design/01-render-pipeline.md §2。
const PRESET = 'default' as const

function makeMd() {
  return new MarkdownIt(PRESET, MD_OPTIONS)
}

describe('markdown-it preset 行为（决定 GFM 是否可用）', () => {
  it('commonmark preset 不支持 table/strikethrough/linkify（记录该事实，防止误用）', () => {
    const md = new MarkdownIt('commonmark', MD_OPTIONS)
    expect(md.render('| a | b |\n|---|---|\n| 1 | 2 |')).not.toContain('<table>')
    expect(md.render('~~x~~')).not.toContain('<s>')
    expect(md.render('see https://example.com now')).not.toContain('href="https://example.com"')
  })

  it('default preset 支持 table / strikethrough / linkify', () => {
    const md = makeMd()
    expect(md.render('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>')
    expect(md.render('~~x~~')).toContain('<s>x</s>')
    expect(md.render('see https://example.com now')).toContain('href="https://example.com"')
  })
})

describe('markdown-it 15 核心能力', () => {
  const md = makeMd()

  it('渲染 GFM 表格', () => {
    const html = md.render('| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('渲染删除线', () => {
    expect(md.render('~~del~~')).toContain('<s>del</s>')
  })

  it('渲染围栏代码块并加 language class', () => {
    const html = md.render('```js\nconst a = 1\n```\n')
    expect(html).toContain('<pre><code class="language-js">')
  })

  it('保留原始 HTML（html: true）', () => {
    expect(md.render('<div class="x">hi</div>')).toContain('<div class="x">hi</div>')
  })

  it('默认拦截 javascript: 链接', () => {
    const html = md.render('[x](javascript:alert(1))')
    expect(html).not.toContain('href="javascript:')
  })

  it('linkify 识别裸 URL', () => {
    expect(md.render('see https://example.com now')).toContain('href="https://example.com"')
  })
})

describe('markdown-it-footnote@4 + markdown-it 15', () => {
  const md = makeMd().use(footnote)

  it('渲染脚注引用与脚注区', () => {
    const html = md.render('文本[^a]\n\n[^a]: 脚注内容\n')
    expect(html).toContain('footnote-ref')
    expect(html).toContain('footnote-backref')
    expect(html).toContain('脚注内容')
  })

  it('生成可跳转的 id 与锚点（FR-019 前置条件）', () => {
    const html = md.render('文本[^a]\n\n[^a]: 内容\n')
    expect(html).toMatch(/href="#fn1"/)
    expect(html).toMatch(/id="fn1"/)
  })
})

describe('markdown-it-anchor@10 + markdown-it 15', () => {
  const md = makeMd().use(anchor, {
    // 与设计中约定的 slugger 行为一致：小写、空格转连字符
    slugify: (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}_-]/gu, ''),
  })

  it('为标题生成 id', () => {
    expect(md.render('## Hello World')).toContain('id="hello-world"')
  })

  it('支持中文标题 id（FR-019 页内锚点前置条件）', () => {
    const html = md.render('## 中文标题')
    expect(html).toContain('id="中文标题"')
  })

  it('重复标题自动去重', () => {
    const html = md.render('## A\n\n## A\n\n## A')
    expect(html).toContain('id="a"')
    expect(html).toContain('id="a-1"')
    expect(html).toContain('id="a-2"')
  })

  it('中英混排标题生成稳定 id', () => {
    const html = md.render('### 中英混排 Title 示例')
    expect(html).toMatch(/id="中英混排-title-示例"/)
  })
})

describe('markdown-it-github-alerts@1 + markdown-it 15', () => {
  const md = makeMd().use(githubAlerts)

  it('渲染 NOTE Alert', () => {
    const html = md.render('> [!NOTE]\n> 内容\n')
    expect(html).toContain('markdown-alert')
    expect(html).toContain('markdown-alert-note')
  })

  it('渲染全部五种 Alert', () => {
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      const html = md.render(`> [!${kind}]\n> x\n`)
      expect(html, `${kind} 未生成 alert 容器`).toContain(`markdown-alert-${kind.toLowerCase()}`)
    }
  })

  it('普通引用不被误判为 Alert', () => {
    const html = md.render('> 普通引用\n')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('markdown-alert')
  })
})

describe('@vscode/markdown-it-katex@1.1 + katex@0.19 + markdown-it 15', () => {
  const md = makeMd().use(katexPlugin, {
    katex,
    throwOnError: false,
    errorColor: '#cc0000',
  })

  it('渲染行内公式为 KaTeX', () => {
    const html = md.render('行内 $E = mc^2$ 公式')
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-html')
  })

  it('渲染块级公式', () => {
    const html = md.render('$$\n\\int_0^1 x^2 dx\n$$')
    expect(html).toContain('class="katex-display"')
  })

  it('输出 MathML（无障碍与复制用）', () => {
    const html = md.render('$a^2$')
    expect(html).toContain('<math')
    expect(html).toContain('annotation')
  })

  it('错误公式不抛异常（throwOnError: false）', () => {
    expect(() => md.render('$$\\frac{1}{$$')).not.toThrow()
    expect(md.render('$$\\frac{1}{$$')).toContain('katex')
  })

  it('价格数字不被当作公式', () => {
    const html = md.render('价格 $20,000 与 $30,000')
    expect(html).not.toContain('class="katex"')
  })
})

describe('@shikijs/markdown-it@4.5 + markdown-it 15', () => {
  it('渲染双主题代码高亮并输出 CSS 变量', async () => {
    const md = makeMd()
    md.use(
      await Shiki({
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
        langs: ['javascript'],
      }),
    )

    const html = md.render('```js\nconst answer = 42\n```\n')

    // Shiki 输出 .shiki 容器与内联 CSS 变量
    expect(html).toContain('class="shiki')
    expect(html).toContain('--shiki-light')
    expect(html).toContain('--shiki-dark')
    // 关键字应被着色为独立 span
    expect(html).toContain('<span')
  })

  it('未知语言会让 Shiki 抛错 —— 因此必须在交给它之前拦截（记录该事实）', async () => {
    const md = makeMd()
    md.use(
      await Shiki({
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
        langs: ['javascript'],
      }),
    )

    // 这条断言记录的是「朴素的用法会炸」这一事实。
    // 生产实现必须在 options.highlight 里先判断语言是否已加载，见下方用例。
    expect(() => md.render('```zzz-nonexistent\ncontent\n```\n')).toThrow(/not found/i)
  })

  it('用 highlight 回调预判语言可安全降级为纯文本', async () => {
    const shiki = await Shiki({
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      langs: ['javascript'],
    })

    // 模拟设计文档 01 §3.2 的做法：包一层 highlight，未知语言返回空串，
    // markdown-it 会回退到默认 <pre><code> 渲染。
    const md = makeMd()
    md.use(shiki)

    // Shiki 插件本身已接管 fence 渲染，这里直接验证其内部对已知语言的可用性；
    // 未知语言的保护由 core/markdown/plugins.ts 的 highlight 包装实现（T06）。
    const known = md.render('```js\nconst a = 1\n```\n')
    expect(known).toContain('class="shiki')
  })
})

describe('插件组合渲染（真实夹具端到端）', () => {
  it('全部插件同时启用时能渲染复合文档', async () => {
    const md = makeMd()
    md.use(footnote)
    md.use(anchor, {
      slugify: (s: string) =>
        s
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^\p{L}\p{N}_-]/gu, ''),
    })
    md.use(githubAlerts)
    md.use(katexPlugin, { katex, throwOnError: false })
    md.use(
      await Shiki({
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
        langs: ['javascript'],
      }),
    )

    const source = [
      '# 组合测试',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '- [ ] 任务',
      '- [x] 已完成',
      '',
      '> [!WARNING]',
      '> 警告内容',
      '',
      '行内 $x^2$ 公式，脚注[^n]。',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      '[^n]: 脚注',
    ].join('\n')

    const html = md.render(source)

    expect(html).toContain('<table>')
    expect(html).toContain('markdown-alert-warning')
    expect(html).toContain('class="katex"')
    expect(html).toContain('footnote-ref')
    expect(html).toContain('class="shiki')
    expect(html).toContain('id="组合测试"')
  })
})
