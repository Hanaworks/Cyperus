import type { MarkdownIt, Token } from 'markdown-it'
import type { RenderSegment } from '../render/contract'
import type { MarkdownRenderEnv } from './augment'

export const SEGMENT_THRESHOLD = 8 * 1024 * 1024
const targetSize = 32 * 1024
const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))

// Raw HTML may span several markdown-it tokens. Keep its enclosing element in
// one segment as well; malformed/unclosed HTML conservatively keeps the tail.
function trackHtml(html: string, stack: string[]): void {
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const tag = match[1]?.toLowerCase()
    if (!tag || voidTags.has(tag) || /\/\s*>$/.test(match[0])) continue
    if (match[0].startsWith('</')) {
      const index = stack.lastIndexOf(tag)
      if (index >= 0) stack.splice(index)
    } else stack.push(tag)
  }
}

/** Tokens are parsed together so references, duplicate IDs and footnotes stay global. */
export function renderSegments(md: MarkdownIt, tokens: Token[], env: MarkdownRenderEnv): RenderSegment[] {
  const groups: Token[][] = []
  let group: Token[] = []
  let depth = 0
  let size = 0
  const rawStack: string[] = []
  for (const token of tokens) {
    if (!depth && !rawStack.length && group.length && (size >= targetSize || group.length >= 200
      || (size >= targetSize / 2 && (token.type === 'hr' || (token.type === 'heading_open' && /h[12]/.test(token.tag)))))) {
      groups.push(group); group = []; size = 0
    }
    group.push(token)
    depth += token.nesting
    size += token.content.length
    if (token.type === 'html_block') trackHtml(token.content, rawStack)
    for (const child of token.children ?? []) if (child.type === 'html_inline') trackHtml(child.content, rawStack)
  }
  if (group.length) groups.push(group)
  let lastLine = 1
  return groups.map((part) => {
    const html = md.renderer.render(part, md.options, env)
    const mapped = part.filter((token) => token.map)
    const startLine = mapped[0]?.map?.[0]
    const line = startLine === undefined ? lastLine : startLine + 1
    const endLine = mapped.reduce((end, token) => Math.max(end, token.map?.[1] ?? line), line)
    lastLine = endLine
    const anchors = [...html.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((match) => match[1] ?? '')
    return { html, line, endLine, anchors, ...(html.length > 512 * 1024 ? { oversized: true } : {}) }
  })
}
