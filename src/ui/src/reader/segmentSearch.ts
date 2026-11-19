import { countMatches, DocumentSearch, type SearchSummary } from './search'
import { type SegmentView, yieldToReader } from './segments'

export class SegmentedSearch {
  private counts: number[] = []
  private query = ''
  private current = 0
  private version = 0
  private highlight: DocumentSearch | undefined
  constructor(private view: SegmentView) {}
  private summary(): SearchSummary { return { count: this.counts.reduce((sum, count) => sum + count, 0), current: this.current } }

  async update(query: string, current = 1, reveal = true): Promise<SearchSummary | undefined> {
    const version = ++this.version
    this.clearHighlight()
    this.query = query
    this.counts = []
    this.current = 0
    if (!query) return this.summary()
    const counts: number[] = []
    let lastYield = performance.now()
    for (let index = 0; index < this.view.segments.length; index += 1) {
      if (version !== this.version || this.view.disposed) return undefined
      counts.push(countMatches(await this.view.staging(index, () => version === this.version), query))
      if (performance.now() - lastYield > 12) { await yieldToReader(); lastYield = performance.now() }
    }
    if (version !== this.version || this.view.disposed) return undefined
    this.counts = counts
    const total = this.summary().count
    this.current = total ? Math.min(total, Math.max(1, current)) : 0
    await this.show(reveal)
    if (version !== this.version || this.view.disposed) return undefined
    return this.summary()
  }

  async move(delta: number): Promise<SearchSummary | undefined> {
    const total = this.summary().count
    const version = ++this.version
    if (total) this.current = ((this.current - 1 + delta) % total + total) % total + 1
    await this.show(true)
    if (version !== this.version || this.view.disposed) return undefined
    return this.summary()
  }

  clearHighlight(): void { this.highlight?.clear(); this.highlight = undefined }
  refresh(): void { void this.show(false) }
  private async show(reveal: boolean): Promise<void> {
    const version = this.version
    const query = this.query
    const current = this.current
    const isCurrent = () => version === this.version && !this.view.disposed
    this.clearHighlight()
    if (!current) return
    let remaining = current
    const index = this.counts.findIndex((count) => {
      if (remaining <= count) return true
      remaining -= count; return false
    })
    if (index < 0) return
    if (reveal) await this.view.show(index, false, isCurrent)
    if (!isCurrent()) return
    this.clearHighlight()
    const shell = this.view.shells[index]
    if (!shell || shell.dataset.placeholder) return
    this.highlight = new DocumentSearch(shell)
    this.highlight.update(query, remaining, reveal)
  }
  clear(): void { this.version += 1; this.clearHighlight(); this.counts = []; this.current = 0 }
}
