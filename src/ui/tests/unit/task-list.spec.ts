import { describe, expect, it } from 'vitest'
import { createMarkdownIt } from '@/core/markdown/preset'
import { installTaskList } from '@/core/markdown/rules/taskList'
import { hasRawHtmlToken } from '@/core/markdown/slug'

function makeMd() {
  const md = createMarkdownIt()
  installTaskList(md)
  return md
}

function checkboxTags(html: string): string[] {
  return html.match(/<input\b[^>]*>/g) ?? []
}

describe('只读任务列表', () => {
  it('未完成任务输出 disabled checkbox、aria 状态和列表类名', () => {
    const html = makeMd().render('- [ ] 待办\n')
    const checkboxes = checkboxTags(html)

    expect(html).toContain('<ul class="contains-task-list">')
    expect(html).toContain('<li class="task-list-item">')
    expect(checkboxes).toHaveLength(1)
    expect(checkboxes[0]).toContain('type="checkbox"')
    expect(checkboxes[0]).toContain('class="task-list-checkbox"')
    expect(checkboxes[0]).toMatch(/\sdisabled(?:\s|=|>)/)
    expect(checkboxes[0]).toContain('aria-checked="false"')
    expect(checkboxes[0]).not.toMatch(/\schecked(?:\s|=|>)/)
    expect(html).toMatch(/<input\b[^>]*> 待办<\/li>/)
    expect(html).not.toContain('[ ]')
  })

  it.each(['x', 'X'])('识别 [%s] 并保持只读', (marker) => {
    const html = makeMd().render(`- [${marker}] 已完成\n`)
    const checkboxes = checkboxTags(html)

    expect(checkboxes).toHaveLength(1)
    expect(checkboxes[0]).toMatch(/\schecked(?:\s|=|>)/)
    expect(checkboxes[0]).toMatch(/\sdisabled(?:\s|=|>)/)
    expect(checkboxes[0]).toContain('aria-checked="true"')
    expect(html).not.toContain(`[${marker}]`)
  })

  it('嵌套任务列表只标记任务项及其直接父列表', () => {
    const md = makeMd()
    const tokens = md.parse('- 普通父项\n  - [x] 子任务\n  - 普通子项\n- [ ] 根任务\n', {})

    expect(tokens.filter((token) => token.type === 'bullet_list_open').map((token) => token.attrGet('class')))
      .toEqual(['contains-task-list', 'contains-task-list'])
    expect(tokens.filter((token) => token.type === 'list_item_open').map((token) => token.attrGet('class')))
      .toEqual([null, 'task-list-item', null, 'task-list-item'])
    expect(checkboxTags(md.renderer.render(tokens, md.options, {}))).toHaveLength(2)

    const nestedOnly = md.parse('- 普通父项\n  - [ ] 子任务\n', {})
    expect(nestedOnly.filter((token) => token.type === 'bullet_list_open').map((token) => token.attrGet('class')))
      .toEqual([null, 'contains-task-list'])
  })

  it('支持有序列表及有序/无序混合嵌套', () => {
    const html = makeMd().render('1. [ ] 第一项\n   - [X] 子任务\n2. 普通项\n')

    expect(html).toContain('<ol class="contains-task-list">')
    expect(html).toContain('<ul class="contains-task-list">')
    expect(checkboxTags(html)).toHaveLength(2)
    expect(html.match(/class="task-list-item"/g)).toHaveLength(2)
  })

  it('保留强调、行内代码、链接和转义后的正文', () => {
    const html = makeMd().render('- [x] **粗体**、*强调*、`[ ] 代码` 与 [链接](https://example.com) \\<tag>\n')

    expect(checkboxTags(html)).toHaveLength(1)
    expect(html).toMatch(/<input\b[^>]*> <strong>粗体<\/strong>/)
    expect(html).toContain('<em>强调</em>')
    expect(html).toContain('<code>[ ] 代码</code>')
    expect(html).toContain('<a href="https://example.com">链接</a>')
    expect(html).toContain('&lt;tag&gt;')
  })

  it('保留松散列表段落和后续段落', () => {
    const html = makeMd().render('- [ ] **第一段**\n\n  第二段\n\n- 普通项\n')

    expect(checkboxTags(html)).toHaveLength(1)
    expect(html).toMatch(/<p><input\b[^>]*> <strong>第一段<\/strong><\/p>/)
    expect(html).toContain('<p>第二段</p>')
  })

  it('方框后允许制表符或换行空白', () => {
    const html = makeMd().render('- [ ]\t**制表符**\n- [x]\n  下一行\n')

    expect(checkboxTags(html)).toHaveLength(2)
    expect(html).toContain('<strong>制表符</strong>')
    expect(html).toContain('下一行')
    expect(html).not.toContain('[x]')
  })

  it.each([
    '- [x]紧邻正文\n',
    '- [y] 非任务\n',
    '- [] 非任务\n',
    '- \\[ ] 转义方框\n',
    '- `[ ] 代码`\n',
    '[ ] 普通段落\n',
    '> [x] 普通引用\n',
    '```markdown\n- [ ] 围栏代码\n```\n',
    '    - [x] 缩进代码\n',
  ])('不把非任务语法转换成复选框：%s', (source) => {
    const html = makeMd().render(source)

    expect(checkboxTags(html)).toHaveLength(0)
    expect(html).not.toContain('task-list-item')
    expect(html).not.toContain('contains-task-list')
  })

  it.each([
    '- 第一行\n  [ ] 第二行\n',
    '- 第一段\n\n  [x] 第二段\n',
    '- > [ ] 列表内引用\n',
    '- ## 首个块是标题\n\n  [x] 后续段落\n',
  ])('只检查列表项开头的直接首段：%s', (source) => {
    const html = makeMd().render(source)

    expect(checkboxTags(html)).toHaveLength(0)
    expect(html).toMatch(/\[[ x]\]/)
  })

  it('引用内真正的任务列表仍能识别', () => {
    const html = makeMd().render('> - [x] 引用内任务\n')

    expect(html).toContain('<blockquote>')
    expect(checkboxTags(html)).toHaveLength(1)
    expect(html).toContain('aria-checked="true"')
  })

  it('方框对应快捷引用定义时仍识别任务，并保留正文引用', () => {
    const html = makeMd().render('- [x] **完成**与 [文档][ref]\n\n[x]: https://example.com/marker\n[ref]: https://example.com/doc\n')

    expect(checkboxTags(html)).toHaveLength(1)
    expect(html).not.toContain('href="https://example.com/marker"')
    expect(html).toContain('<strong>完成</strong>')
    expect(html).toContain('<a href="https://example.com/doc">文档</a>')
  })

  it.each([
    ['- [x] [ref] **正文**\n\n[ref]: https://example.com/doc\n', '<a href="https://example.com/doc">ref</a>'],
    ['- [x] [] **正文**\n\n[x]: https://example.com/marker\n', '[]'],
  ])('引用链接解析吞入后续方括号时恢复正文：%s', (source, restored) => {
    const html = makeMd().render(source)

    expect(checkboxTags(html)).toHaveLength(1)
    expect(html).toContain(restored)
    expect(html).toContain('<strong>正文</strong>')
  })

  it('保留列表和列表项已有类名', () => {
    const md = makeMd()
    md.core.ruler.before('inline', 'test_existing_list_classes', (state) => {
      for (const token of state.tokens) {
        if (token.type === 'bullet_list_open') token.attrSet('class', 'existing-list')
        if (token.type === 'list_item_open') token.attrSet('class', 'existing-item')
      }
    })

    const html = md.render('- [ ] 第一项\n- [x] 第二项\n')
    expect(html).toContain('class="existing-list contains-task-list"')
    expect(html).toContain('class="existing-item task-list-item"')
    expect(html).not.toContain('contains-task-list contains-task-list')
  })

  it('内部复选框 token 不被计作原始 HTML', () => {
    const md = makeMd()
    const tokens = md.parse('- [ ] **待办**\n', {})
    const inline = tokens.find((token) => token.type === 'inline')

    expect(inline?.content).toBe('**待办**')
    expect(inline?.children?.[0]?.type).toBe('md_task_checkbox')
    expect(hasRawHtmlToken(tokens)).toBe(false)
    expect(hasRawHtmlToken(md.parse('- [x] <span>原始 HTML</span>\n', {}))).toBe(true)
  })

  it('关闭原始 HTML 时仍渲染只读复选框', () => {
    const md = makeMd().set({ html: false })
    const html = md.render('- [ ] <span>正文</span>\n')

    expect(checkboxTags(html)).toHaveLength(1)
    expect(html).toContain('&lt;span&gt;正文&lt;/span&gt;')
  })

  it('重复使用解析器不会累积复选框或类名', () => {
    const md = makeMd()
    const source = '- [x] **已完成**\n'
    const first = md.render(source, {})

    expect(checkboxTags(first)).toHaveLength(1)
    expect(md.render(source, {})).toBe(first)
    expect(md.render('- 普通列表\n', {})).not.toContain('task-list')
  })
})
