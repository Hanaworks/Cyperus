export interface SearchSummary { count: number; current: number; pending?: boolean }
interface TextPart { node: Text; start: number; end: number }

const skipped = 'script,style,svg,.md-mermaid,.katex,.katex-mathml,[aria-hidden="true"],[hidden]'
const blocks = 'p,pre,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,div'
const highlightName = 'md-reader-search'
const currentName = 'md-reader-search-current'

function textGroups(root: HTMLElement): Map<Element, TextPart[]> {
  const groups = new Map<Element, TextPart[]>()
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || parent.closest(skipped) || !node.textContent) continue
    const block = parent.closest(blocks) ?? root
    const parts = groups.get(block) ?? []
    const start = parts.at(-1)?.end ?? 0
    parts.push({ node: node as Text, start, end: start + node.textContent.length })
    groups.set(block, parts)
  }
  return groups
}

function searchPattern(query: string): RegExp {
  return new RegExp([...query].map((char) => '\\^$.*+?()[]{}|'.includes(char) ? `\\${char}` : char).join(''), 'giu')
}

/** Same rendered-text rules as highlighting, without retaining DOM Ranges. */
export function countMatches(root: HTMLElement, query: string): number {
  if (!query) return 0
  const pattern = searchPattern(query)
  let count = 0
  for (const parts of textGroups(root).values()) {
    for (const _match of parts.map((part) => part.node.data).join('').matchAll(pattern)) count += 1
  }
  return count
}

// Ranges leave rich document structure intact; the fallback wraps text fragments only.
export class DocumentSearch {
  private ranges: Range[] = []
  private marks: HTMLElement[][] = []
  private index = 0
  constructor(private root: HTMLElement) {}

  private get native(): boolean {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
  }

  private summary(): SearchSummary {
    return { count: this.ranges.length, current: this.ranges.length ? this.index + 1 : 0 }
  }

  update(query: string, current = 1, reveal = true): SearchSummary {
    this.clear()
    if (!query) return this.summary()
    const pattern = searchPattern(query)
    const fragments: TextPart[][] = []
    for (const parts of textGroups(this.root).values()) {
      const text = parts.map((part) => part.node.data).join('')
      for (const match of text.matchAll(pattern)) {
        const start = match.index
        const end = start + match[0].length
        const first = parts.find((part) => start < part.end)
        const last = parts.find((part) => end <= part.end)
        if (!first || !last) continue
        const range = this.root.ownerDocument.createRange()
        range.setStart(first.node, start - first.start)
        range.setEnd(last.node, end - last.start)
        this.ranges.push(range)
        fragments.push(parts.filter((part) => part.start < end && part.end > start)
          .map((part) => ({ node: part.node, start: Math.max(0, start - part.start), end: Math.min(part.node.length, end - part.start) })))
      }
    }
    if (this.native) CSS.highlights.set(highlightName, new Highlight(...this.ranges))
    else {
      // Reverse offsets keep earlier fragments valid while splitting the same Text node.
      this.marks = Array.from({ length: fragments.length }, () => [])
      for (let i = fragments.length - 1; i >= 0; i -= 1) {
        for (const part of [...(fragments[i] ?? [])].reverse()) {
          part.node.splitText(part.end)
          const text = part.node.splitText(part.start)
          const mark = this.root.ownerDocument.createElement('mark')
          mark.className = 'md-search-match'
          text.parentNode?.insertBefore(mark, text)
          mark.append(text)
          this.marks[i]?.push(mark)
        }
      }
    }
    this.index = Math.max(0, Math.min(this.ranges.length - 1, Number.isFinite(current) ? Math.floor(current) - 1 : 0))
    this.showCurrent(reveal)
    return this.summary()
  }

  move(delta: number): SearchSummary {
    if (this.ranges.length) this.index = (this.index + delta + this.ranges.length) % this.ranges.length
    this.showCurrent()
    return this.summary()
  }

  private showCurrent(reveal = true): void {
    const range = this.ranges[this.index]
    if (!range) return
    if (this.native) CSS.highlights.set(currentName, new Highlight(range))
    else for (let i = 0; i < this.marks.length; i += 1) {
      for (const mark of this.marks[i] ?? []) mark.classList.toggle('md-search-current', i === this.index)
    }
    if (!reveal) return
    if (this.native) this.revealRange(range)
    else this.marks[this.index]?.[0]?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  }

  private revealRange(range: Range): void {
    const element = range.startContainer.parentElement
    element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    const viewport = this.root.closest<HTMLElement>('.reader-scroll')
    if (!viewport || typeof range.getBoundingClientRect !== 'function') return
    const code = element?.closest('pre')
    if (code && code.scrollWidth > code.clientWidth) {
      const text = range.getBoundingClientRect()
      const box = code.getBoundingClientRect()
      code.scrollLeft += text.left - box.left - (code.clientWidth - text.width) / 2
    }
    const text = range.getBoundingClientRect()
    const box = viewport.getBoundingClientRect()
    viewport.scrollTop += text.top - box.top - (viewport.clientHeight - text.height) / 2
  }

  clear(): void {
    if (this.native) { CSS.highlights.delete(highlightName); CSS.highlights.delete(currentName) }
    for (const group of this.marks) for (const mark of group) mark.replaceWith(...mark.childNodes)
    if (this.marks.length) this.root.normalize()
    this.marks = []
    this.ranges = []
    this.index = 0
  }
}
