import type { MarkdownIt, StateCore, Token } from 'markdown-it'

const CHECKBOX_TOKEN = 'md_task_checkbox'
const TASK_PREFIX = /^\[([ xX])\]\s/

function addClass(token: Token, className: string): void {
  const classes = String(token.attrGet('class') ?? '').split(/\s+/)
  if (!classes.includes(className)) token.attrJoin('class', className)
}

// 在已解析的 children 上移除前缀，保留强调、脚注等插件产出的 token。
// 重新 inline.parse 会重复登记脚注引用等 env 状态，因此不重解析正文。
function stripPrefix(inline: Token, marker: string): boolean {
  const children = inline.children
  const first = children?.[0]
  if (!children || !first) return false

  if (first.type === 'text' && first.content.startsWith(marker)) {
    first.content = first.content.slice(marker.length)
    if (!first.content) children.shift()
  } else if (
    first.type === 'link_open' &&
    children[1]?.type === 'text' &&
    children[1].content === marker[1] &&
    children[2]?.type === 'link_close'
  ) {
    // 若文档定义了 [x]: url，markdown-it 已把 [x] 解析为快捷引用链接。
    children.splice(0, 3)
  } else {
    return false
  }

  const next = children[0]
  if (next?.type === 'text') {
    next.content = next.content.replace(/^\s/, '')
    if (!next.content) children.shift()
  } else if (next?.type === 'softbreak' && inline.content[3] === '\n') {
    children.shift()
  }

  inline.content = inline.content.slice(marker.length + 1)
  return true
}

function transformTask(state: StateCore, index: number, list: Token | undefined): void {
  const listItem = state.tokens[index]
  const paragraph = state.tokens[index + 1]
  const inline = state.tokens[index + 2]
  // 只认列表项直接开头的首段，不扫描后续段落、标题或引用里的 inline。
  if (!listItem || paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline' || !list) return

  const match = TASK_PREFIX.exec(inline.content)
  if (!match || !stripPrefix(inline, match[0].slice(0, 3))) return

  const checked = match[1] !== ' '
  const checkbox = new state.Token(CHECKBOX_TOKEN, 'input', 0)
  checkbox.attrSet('type', 'checkbox')
  checkbox.attrSet('class', 'task-list-checkbox')
  checkbox.attrSet('disabled', '')
  if (checked) checkbox.attrSet('checked', '')
  checkbox.attrSet('aria-checked', String(checked))
  inline.children?.unshift(checkbox)

  addClass(listItem, 'task-list-item')
  addClass(list, 'contains-task-list')
}

// 首版只读任务列表。用内部 token 产出 input，避免将生成的控件误计作原始 HTML。
export function installTaskList(md: MarkdownIt): void {
  md.renderer.rules[CHECKBOX_TOKEN] = (tokens, index, options, _env, renderer) =>
    `${renderer.renderToken(tokens, index, options)} `

  md.core.ruler.after('inline', 'md_task_list', (state) => {
    const lists: Token[] = []

    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index]
      if (!token) continue

      switch (token.type) {
        case 'bullet_list_open':
        case 'ordered_list_open':
          lists.push(token)
          break
        case 'bullet_list_close':
        case 'ordered_list_close':
          lists.pop()
          break
        case 'list_item_open':
          transformTask(state, index, lists[lists.length - 1])
          break
      }
    }
  })
}
