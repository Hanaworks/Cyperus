import type { Token } from 'markdown-it'
import type { TocEntry } from '../render/contract'
import { headingText } from './anchors'

export interface TocNode extends TocEntry {
  children: TocNode[]
}

// 目录与 HTML 共用同一份 heading token，避免另行生成锚点造成偏差。
export function extractToc(tokens: readonly Token[]): TocEntry[] {
  const entries: TocEntry[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token?.type !== 'heading_open' || !/^h[1-6]$/.test(token.tag)) continue

    const inline = tokens[index + 1]
    const id = token.attrGet('id')
    if (inline?.type !== 'inline' || !id || !token.map) continue

    entries.push({
      level: Number(token.tag.slice(1)),
      text: headingText(inline),
      id: String(id),
      line: token.map[0] + 1,
    })
  }

  return entries
}

// 跳级标题直接归入最近的较浅标题，不生成源码中不存在的中间节点。
export function buildTocTree(entries: readonly TocEntry[]): TocNode[] {
  const roots: TocNode[] = []
  const stack: TocNode[] = []

  for (const entry of entries) {
    const node: TocNode = { ...entry, children: [] }
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= node.level) {
      stack.pop()
    }

    const parent = stack.at(-1)
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push(node)
  }

  return roots
}
