import type { ReadingAnchor } from '../core/documents/workspaceState'
import type { RenderSegment } from '../core/render/contract'
import { readSegmentHtml } from '../core/render/segmentStore'
import { renderInto } from './renderInto'
import { captureAnchor, findAnchorBlock, restoreAnchor } from './scrollAnchor'

interface Hooks { mount?(root: HTMLElement, index: number): void; unmount?(index: number): void; changing?(): void; changed?(): void }
export const yieldToReader = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
export function findNamedAnchor(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
    ?? root.querySelector<HTMLElement>(`a[name="${CSS.escape(id)}"]`)
}

/** Stable-height shells retain document scroll geometry while distant DOM is released. */
export class SegmentView {
  readonly shells: HTMLElement[]
  private resident = new Set<number>()
  current = 0
  disposed = false
  private request = 0
  private navigation = 0

  constructor(readonly article: HTMLElement, private viewport: HTMLElement,
    readonly segments: RenderSegment[], private hasRawHtml: boolean, private hooks: Hooks = {}) {
    this.shells = segments.map((segment, index) => {
      const shell = document.createElement('section')
      shell.dataset.segment = String(index)
      shell.dataset.placeholder = 'true'
      shell.style.display = 'flow-root'
      shell.style.overflowAnchor = 'none'
      // Bounded resident segments are laid out so height measurements are real;
      // giant indivisible blocks retain the browser's content-visibility fallback.
      shell.style.contentVisibility = segment.oversized ? 'auto' : 'visible'
      const width = Math.max(320, article.clientWidth || 800)
      const charsPerLine = Math.max(20, width / 9)
      // Estimate before first visit; measured height replaces it on eviction.
      shell.style.height = `${Math.max(80, Math.ceil((segment.htmlLength ?? segment.html.length) / charsPerLine) * 26)}px`
      return shell
    })
    article.replaceChildren(...this.shells)
  }

  async staging(index: number, isCurrent = () => true): Promise<HTMLElement> {
    const root = document.createElement('div')
    const segment = this.segments[index]
    const html = segment ? await this.read(segment, isCurrent) : ''
    if (!this.disposed && isCurrent()) renderInto(root, { html, hasRawHtml: this.hasRawHtml })
    return root
  }

  private evict(index: number): void {
    for (const item of [...this.resident]) if (Math.abs(item - index) > 3) {
      const shell = this.shells[item]
      if (!shell) continue
      const height = Math.max(1, shell.getBoundingClientRect().height)
      this.hooks.unmount?.(item)
      shell.replaceChildren()
      shell.style.height = `${height}px`
      shell.dataset.placeholder = 'true'
      this.resident.delete(item)
    }
  }

  private async read(segment: RenderSegment, isCurrent = () => true): Promise<string> {
    try { return await readSegmentHtml(segment) }
    catch (error) { if (this.disposed || !isCurrent()) return ''; throw error }
  }

  private mount(loaded: Map<number, string>): void {
    for (const [item, html] of loaded) {
      const shell = this.shells[item]
      if (!shell || this.resident.has(item)) continue
      renderInto(shell, { html, hasRawHtml: this.hasRawHtml })
      shell.style.height = ''
      delete shell.dataset.placeholder
      this.resident.add(item)
      this.hooks.mount?.(shell, item)
    }
  }

  async show(index: number, preserve = false, isCurrent = () => true): Promise<boolean> {
    if (this.disposed || !isCurrent()) return false
    index = Math.max(0, Math.min(this.segments.length - 1, index))
    const needed = [index - 1, index, index + 1].filter((item) => item >= 0 && item < this.segments.length)
    const request = ++this.request
    const fresh = () => !this.disposed && request === this.request && isCurrent()
    if (index === this.current && needed.every((item) => this.resident.has(item))) return true
    const loaded = new Map<number, string>()
    for (const item of needed) {
      const segment = this.segments[item]
      if (segment && !this.resident.has(item)) loaded.set(item, await this.read(segment, fresh))
      if (!fresh()) return false
    }
    const anchor = preserve ? captureAnchor(this.article, this.viewport) : undefined
    const oldTop = this.shells[index]?.getBoundingClientRect().top ?? 0
    this.hooks.changing?.()
    this.current = index
    this.evict(index)
    this.mount(loaded)
    if (preserve && (!anchor || !findAnchorBlock(this.article, anchor, false) || !restoreAnchor(this.article, this.viewport, anchor))) {
      this.viewport.scrollTop += (this.shells[index]?.getBoundingClientRect().top ?? 0) - oldTop
    }
    this.hooks.changed?.()
    return true
  }

  updateViewport(): Promise<boolean> {
    const top = this.viewport.getBoundingClientRect().top
    let low = 0; let high = this.shells.length - 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if ((this.shells[middle]?.getBoundingClientRect().bottom ?? 0) <= top) low = middle + 1
      else high = middle - 1
    }
    return this.show(Math.min(low, this.shells.length - 1), true)
  }

  measure(index: number): void {
    const shell = this.shells[index]
    if (!shell || !this.resident.has(index)) return
    const visibility = shell.style.contentVisibility
    shell.style.contentVisibility = 'visible'
    // A giant indivisible block also needs real layout for an explicit full pass.
    void shell.getBoundingClientRect().height
    shell.style.contentVisibility = visibility
  }

  private navigationGuard(isCurrent: () => boolean): () => boolean {
    const navigation = ++this.navigation
    return () => !this.disposed && navigation === this.navigation && isCurrent()
  }

  private async scan(matches: (root: HTMLElement) => boolean, fresh: () => boolean): Promise<number> {
    for (let index = 0; index < this.segments.length; index += 1) {
      if (!fresh()) return -1
      const root = await this.staging(index, fresh)
      if (!fresh()) return -1
      if (matches(root)) return index
      if (index % 8 === 7) await yieldToReader()
    }
    return -1
  }

  async anchor(id: string, isCurrent = () => true): Promise<HTMLElement | null> {
    const fresh = this.navigationGuard(isCurrent)
    if (!fresh()) return null
    const present = findNamedAnchor(this.article, id)
    if (present) return present
    // Metadata covers generated IDs; parsing fallback also decodes raw HTML entities.
    let index = this.segments.findIndex((segment) => segment.anchors.includes(id))
    if (index < 0) index = await this.scan((root) => Boolean(findNamedAnchor(root, id)), fresh)
    if (index < 0 || !fresh()) return null
    await this.show(index, false, fresh)
    return fresh() ? findNamedAnchor(this.article, id) : null
  }

  async restore(anchor: ReadingAnchor, isCurrent = () => true): Promise<boolean> {
    const fresh = this.navigationGuard(isCurrent)
    if (!fresh()) return false
    const guess = Math.max(0, this.segments.findIndex((segment) => segment.endLine >= anchor.line))
    await this.show(guess, false, fresh)
    if (!fresh()) return false
    if (findAnchorBlock(this.article, anchor, false)) return restoreAnchor(this.article, this.viewport, anchor)
    const index = await this.scan((root) => Boolean(findAnchorBlock(root, anchor, false)), fresh)
    if (!fresh()) return false
    await this.show(index < 0 ? guess : index, false, fresh)
    return fresh() && restoreAnchor(this.article, this.viewport, anchor)
  }

  dispose(): void { this.disposed = true; for (const index of this.resident) this.hooks.unmount?.(index); this.resident.clear() }
}
