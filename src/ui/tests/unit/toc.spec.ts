import { describe, expect, it } from 'vitest'
import { computeHeadingIds, installHeadingAnchors } from '@/core/markdown/anchors'
import { createMarkdownIt } from '@/core/markdown/preset'
import { dedupeIds, slugify } from '@/core/markdown/slug'
import { buildTocTree, extractToc } from '@/core/markdown/toc'
import type { TocEntry } from '@/core/render/contract'

function makeMarkdown() {
  const md = createMarkdownIt()
  installHeadingAnchors(md)
  return md
}

describe('标题锚点边界', () => {
  it('数字后缀与真实标题 slug 相遇时仍保持唯一', () => {
    expect(dedupeIds(['foo', 'foo', 'foo-1', 'foo', 'foo-2'])).toEqual([
      'foo',
      'foo-1',
      'foo-1-1',
      'foo-2',
      'foo-2-1',
    ])
    expect(dedupeIds(['foo', 'foo-1', 'foo'])).toEqual(['foo', 'foo-1', 'foo-2'])
  })

  it('纯标点标题获得可用 id，同时保留 slugify 的纯函数行为', () => {
    expect(slugify('!!!')).toBe('')
    expect(computeHeadingIds(['!!!', '???', 'section'])).toEqual([
      'section',
      'section-1',
      'section-2',
    ])
  })

  it('调用方复用 env 时，同一文档重复解析的 id 也不漂移', () => {
    const md = makeMarkdown()
    const env = {}
    const source = '# 中文\n\n## 重复\n\n## 重复\n'
    const ids = () =>
      md
        .parse(source, env)
        .filter((token) => token.type === 'heading_open')
        .map((token) => token.attrGet('id'))

    expect(ids()).toEqual(['中文', '重复', '重复-1'])
    expect(ids()).toEqual(['中文', '重复', '重复-1'])
  })

  it('复用 env 的不同文档之间隔离去重状态', () => {
    const md = makeMarkdown()
    const env = {}
    md.parse('# 重复\n\n# 重复\n', env)

    const heading = md.parse('# 重复\n', env)[0]
    expect(heading?.attrGet('id')).toBe('重复')
  })

  it('真实 heading token 的后缀与空 slug 也能去重并聚焦', () => {
    const tokens = makeMarkdown().parse('# foo\n\n# foo\n\n# foo-1\n\n# !!!\n\n# ???\n', {})
    const headings = tokens.filter((token) => token.type === 'heading_open')

    expect(headings.map((token) => token.attrGet('id'))).toEqual([
      'foo',
      'foo-1',
      'foo-1-1',
      'section',
      'section-1',
    ])
    expect(headings.every((token) => token.attrGet('tabindex') === '-1')).toBe(true)
  })
})

describe('extractToc', () => {
  it('提取中文、行内纯文本、标题级别与 1-based 源码行', () => {
    const source =
      '# 中文 **标题** 与 [链接](https://example.com) `代码` ![图标](icon.png)\n' +
      '\n正文\n\n### 跳级\n\nSetext 标题\n----------\n'

    expect(extractToc(makeMarkdown().parse(source, {}))).toEqual([
      { level: 1, text: '中文 标题 与 链接 代码 图标', id: '中文-标题-与-链接-代码-图标', line: 1 },
      { level: 3, text: '跳级', id: '跳级', line: 5 },
      { level: 2, text: 'Setext 标题', id: 'setext-标题', line: 7 },
    ])
  })

  it('复用 token 已有 id，并且不修改 token', () => {
    const tokens = makeMarkdown().parse('# 标题\n', {})
    tokens[0]?.attrSet('id', 'assigned-id')
    const before = JSON.stringify(tokens)

    expect(extractToc(tokens)).toEqual([
      { level: 1, text: '标题', id: 'assigned-id', line: 1 },
    ])
    expect(JSON.stringify(tokens)).toBe(before)
  })

  it('重复标题的目录 id 与解析器生成的锚点一致', () => {
    expect(extractToc(makeMarkdown().parse('# 重复\n\n###### 重复\n', {}))).toEqual([
      { level: 1, text: '重复', id: '重复', line: 1 },
      { level: 6, text: '重复', id: '重复-1', line: 3 },
    ])
  })

  it('正文、代码块与原始 HTML 标题不会成为目录项', () => {
    const tokens = makeMarkdown().parse('正文\n\n```md\n# 代码里的标题\n```\n\n<h1>HTML</h1>\n', {})
    expect(extractToc(tokens)).toEqual([])
    expect(extractToc([])).toEqual([])
  })

  it('不为缺少锚点或源码位置的 token 虚构目录数据', () => {
    const noAnchor = createMarkdownIt().parse('# 无锚点\n', {})
    const noMap = makeMarkdown().parse('# 无行号\n', {})
    if (noMap[0]) noMap[0].map = null

    expect(extractToc(noAnchor)).toEqual([])
    expect(extractToc(noMap)).toEqual([])
  })
})

describe('buildTocTree', () => {
  it('允许从 h3 开始，跳级标题归属于最近前置的较浅标题', () => {
    const entries: TocEntry[] = [
      { level: 3, text: '起点', id: 'a', line: 1 },
      { level: 5, text: '跳级', id: 'b', line: 3 },
      { level: 6, text: '最深', id: 'c', line: 5 },
      { level: 4, text: '回退', id: 'd', line: 7 },
      { level: 2, text: '新根', id: 'e', line: 9 },
      { level: 6, text: '再跳级', id: 'f', line: 11 },
      { level: 2, text: '同级', id: 'g', line: 13 },
    ]

    expect(buildTocTree(entries)).toEqual([
      {
        level: 3,
        text: '起点',
        id: 'a',
        line: 1,
        children: [
          {
            level: 5,
            text: '跳级',
            id: 'b',
            line: 3,
            children: [{ level: 6, text: '最深', id: 'c', line: 5, children: [] }],
          },
          { level: 4, text: '回退', id: 'd', line: 7, children: [] },
        ],
      },
      {
        level: 2,
        text: '新根',
        id: 'e',
        line: 9,
        children: [{ level: 6, text: '再跳级', id: 'f', line: 11, children: [] }],
      },
      { level: 2, text: '同级', id: 'g', line: 13, children: [] },
    ])
  })

  it('不修改输入，返回的节点与输入条目互不引用', () => {
    const entries = Object.freeze([
      Object.freeze({ level: 1, text: '标题', id: 'title', line: 1 }),
      Object.freeze({ level: 2, text: '子标题', id: 'child', line: 3 }),
    ])
    const tree = buildTocTree(entries)

    expect(tree[0]).not.toBe(entries[0])
    expect(tree[0]?.children[0]).not.toBe(entries[1])
    expect(entries).toEqual([
      { level: 1, text: '标题', id: 'title', line: 1 },
      { level: 2, text: '子标题', id: 'child', line: 3 },
    ])
    expect(tree[0]?.children).toHaveLength(1)
  })

  it('空目录返回空树', () => {
    expect(buildTocTree([])).toEqual([])
  })
})
