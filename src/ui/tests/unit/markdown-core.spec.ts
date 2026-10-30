import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeHeadingIds, installHeadingAnchors } from '@/core/markdown/anchors'
import { createMarkdownIt, installLinkValidator } from '@/core/markdown/preset'
import {
  dedupeIds,
  fenceLang,
  hasRawHtmlToken,
  shouldHighlight,
  slugify,
} from '@/core/markdown/slug'

const REPO_ROOT = resolve(__dirname, '../../../..')

function readFixture(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, 'fixtures', rel), 'utf8')
}

describe('slugify（无状态）', () => {
  it('转小写、空白转连字符', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('保留中文', () => {
    expect(slugify('中文标题')).toBe('中文标题')
  })

  it('中英混排', () => {
    expect(slugify('中英混排 Title 示例')).toBe('中英混排-title-示例')
  })

  it('移除全角标点与 emoji', () => {
    expect(slugify('含标点的标题：逗号、句号（全角）')).toBe('含标点的标题逗号句号全角')
    expect(slugify('🎯 目标')).toBe('目标')
  })

  it('保留数字、下划线、连字符', () => {
    expect(slugify('v0.4 与 API_v2-beta')).toBe('v04-与-api_v2-beta')
  })

  it('纯标点返回空串', () => {
    expect(slugify('—— …… ））')).toBe('')
  })

  it('压缩连续空白', () => {
    expect(slugify('a   b\tc')).toBe('a-b-c')
  })
})

describe('dedupeIds（单次渲染内去重）', () => {
  it('首个保持原名，后续加数字后缀', () => {
    expect(dedupeIds(['a', 'a', 'a'])).toEqual(['a', 'a-1', 'a-2'])
  })

  it('不同 base 互不影响', () => {
    expect(dedupeIds(['a', 'b', 'a', 'b'])).toEqual(['a', 'b', 'a-1', 'b-1'])
  })

  it('空输入返回空数组', () => {
    expect(dedupeIds([])).toEqual([])
  })

  it('不修改输入数组', () => {
    const input = ['a', 'a']
    const copy = [...input]
    dedupeIds(input)
    expect(input).toEqual(copy)
  })
})

describe('fenceLang / shouldHighlight', () => {
  it('提取语言标识', () => {
    expect(fenceLang('js')).toBe('js')
    expect(fenceLang('js title="x"')).toBe('js')
    expect(fenceLang('  python  ')).toBe('python')
  })

  it('无语言返回 undefined', () => {
    expect(fenceLang('')).toBeUndefined()
    expect(fenceLang(undefined)).toBeUndefined()
    expect(fenceLang('   ')).toBeUndefined()
  })

  it('mermaid 不应被高亮', () => {
    expect(shouldHighlight('mermaid')).toBe(false)
    expect(shouldHighlight('MERMAID')).toBe(false)
    expect(shouldHighlight('js')).toBe(true)
    expect(shouldHighlight(undefined)).toBe(false)
  })
})

describe('hasRawHtmlToken（按需消毒的判定）', () => {
  it('无原始 HTML 时返回 false', () => {
    const md = createMarkdownIt()
    const tokens = md.parse('# 标题\n\n普通段落 **粗体**\n', {})
    expect(hasRawHtmlToken(tokens)).toBe(false)
  })

  it('含 html_block 时返回 true', () => {
    const md = createMarkdownIt()
    const tokens = md.parse('<div>块级 HTML</div>\n', {})
    expect(hasRawHtmlToken(tokens)).toBe(true)
  })

  it('含 html_inline 时返回 true', () => {
    const md = createMarkdownIt()
    const tokens = md.parse('文本 <span>内联</span> 文本\n', {})
    expect(hasRawHtmlToken(tokens)).toBe(true)
  })

  it('代码块中的 HTML 标签不算原始 HTML', () => {
    const md = createMarkdownIt()
    const tokens = md.parse('```html\n<div>x</div>\n```\n', {})
    // fence token 的 content 里有标签，但不是 html_block/html_inline
    expect(hasRawHtmlToken(tokens)).toBe(false)
  })
})

describe('标题锚点 id 稳定性（防止 T05 发现的漂移问题复现）', () => {
  it('同一实例渲染同一文档两次，id 完全一致', () => {
    const md = createMarkdownIt()
    installHeadingAnchors(md)

    const source = '# 标题\n\n## 重复\n\n## 重复\n\n## 重复\n'

    const extractIds = (html: string): string[] =>
      [...html.matchAll(/<h[1-6][^>]*id="([^"]*)"/g)].map((m) => m[1] as string)

    const first = extractIds(md.render(source))
    const second = extractIds(md.render(source))
    const third = extractIds(md.render(source))

    expect(first).toEqual(['标题', '重复', '重复-1', '重复-2'])
    expect(second, '第二次渲染的 id 发生了漂移').toEqual(first)
    expect(third, '第三次渲染的 id 发生了漂移').toEqual(first)
  })

  it('真实夹具 cjk-typography.md 两次渲染 id 一致', () => {
    const md = createMarkdownIt()
    installHeadingAnchors(md)

    const source = readFixture('cjk-typography.md')
    const extractIds = (html: string): string[] =>
      [...html.matchAll(/<h[1-6][^>]*id="([^"]*)"/g)].map((m) => m[1] as string)

    const first = extractIds(md.render(source))
    const second = extractIds(md.render(source))

    expect(first.length).toBeGreaterThan(10)
    expect(second).toEqual(first)
  })

  it('不同文档之间互不影响（无跨文档串扰）', () => {
    const md = createMarkdownIt()
    installHeadingAnchors(md)

    const docA = md.render('# 相同标题\n')
    const docB = md.render('# 相同标题\n')

    expect(docA).toContain('id="相同标题"')
    expect(docB, '第二个文档的 id 受第一个文档影响').toContain('id="相同标题"')
    expect(docB).not.toContain('id="相同标题-1"')
  })

  it('computeHeadingIds 与真实渲染结果一致', () => {
    const md = createMarkdownIt()
    installHeadingAnchors(md)

    const texts = ['中文标题', '重复标题', '重复标题', '重复标题']
    const source = texts.map((t) => `## ${t}\n`).join('\n')

    const expected = computeHeadingIds(texts)
    const actual = [...md.render(source).matchAll(/<h[1-6][^>]*id="([^"]*)"/g)].map(
      (m) => m[1] as string,
    )

    expect(actual).toEqual(expected)
  })

  it('标题含行内标记时用纯文本生成 id', () => {
    const md = createMarkdownIt()
    installHeadingAnchors(md)

    const html = md.render('## 含 **粗体** 与 `代码` 的标题\n')
    expect(html).toContain('id="含-粗体-与-代码-的标题"')
  })
})

describe('链接校验（第一道防线）', () => {
  function makeValidated() {
    const md = createMarkdownIt()
    installLinkValidator(md)
    return md
  }

  it('拦截 javascript: 与变体', () => {
    const md = makeValidated()
    expect(md.validateLink('javascript:alert(1)')).toBe(false)
    expect(md.validateLink('JaVaScRiPt:alert(1)')).toBe(false)
  })

  it('拦截 vbscript: 与 file:', () => {
    const md = makeValidated()
    expect(md.validateLink('vbscript:msgbox')).toBe(false)
    expect(md.validateLink('file:///C:/x')).toBe(false)
  })

  it('拦截 data:text/html 与 data:image/svg+xml', () => {
    const md = makeValidated()
    expect(md.validateLink('data:text/html,<script>')).toBe(false)
    expect(md.validateLink('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
  })

  it('允许 data:image 位图', () => {
    const md = makeValidated()
    expect(md.validateLink('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(md.validateLink('data:image/jpeg;base64,/9j/4AAQ')).toBe(true)
  })

  it('允许正常链接', () => {
    const md = makeValidated()
    expect(md.validateLink('https://example.com')).toBe(true)
    expect(md.validateLink('./a.md')).toBe(true)
    expect(md.validateLink('#anchor')).toBe(true)
    expect(md.validateLink('mailto:a@b.c')).toBe(true)
  })

  it('拒绝空链接', () => {
    const md = makeValidated()
    expect(md.validateLink('')).toBe(false)
    expect(md.validateLink('   ')).toBe(false)
  })

  it('渲染结果中不出现危险 href', () => {
    const md = makeValidated()
    const html = md.render('[a](javascript:alert(1)) [b](data:text/html,x) [c](file:///x)')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="data:text/html')
    expect(html).not.toContain('href="file:///')
  })
})

describe('markdown 基础配置', () => {
  it('使用 default preset，GFM 能力可用', () => {
    const md = createMarkdownIt()
    expect(md.render('| a |\n|---|\n| 1 |')).toContain('<table>')
    expect(md.render('~~x~~')).toContain('<s>')
    expect(md.render('https://example.com')).toContain('href=')
  })

  it('关闭 typographer，引号不被替换为弯引号', () => {
    const md = createMarkdownIt()
    const html = md.render('他说 "你好" 和 \'再见\'')
    // 双引号在 HTML 文本节点中会被转义为 &quot;，这是正确行为；
    // 关键是**没有**被替换成中文弯引号 “ ”
    expect(html).not.toContain('“')
    expect(html).not.toContain('”')
    expect(html).not.toContain('‘')
    expect(html).not.toContain('’')
  })

  it('breaks 关闭：单换行不产生 <br>', () => {
    const md = createMarkdownIt()
    const html = md.render('第一行\n第二行')
    expect(html).not.toContain('<br>')
    expect(html).toContain('第一行\n第二行')
  })
})
