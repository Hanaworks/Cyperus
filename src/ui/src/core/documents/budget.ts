import type { ParseResult } from '../render/contract'

export const DEFAULT_HTML_BUDGET_BYTES = 48 * 1024 * 1024

export interface HtmlCacheStats {
  readonly budgetBytes: number
  readonly retainedHtmlBytes: number
  readonly activeHtmlBytes: number
  readonly backgroundHtmlBytes: number
  // A diagnostic for retained strings only; never a JS heap or RSS limit.
  readonly overBudgetBytes: number
}

export function serializedHtmlBytes(result: Pick<ParseResult, 'html'> & { segments?: readonly { html: string }[] }): number {
  const encoder = new TextEncoder()
  return encoder.encode(result.html).byteLength
    + (result.segments?.reduce((sum, segment) => sum + encoder.encode(segment.html).byteLength, 0) ?? 0)
}

export class HtmlBudget {
  readonly limit: number
  private entries = new Map<string, { bytes: number; used: number }>()
  private clock = 0

  constructor(limit = DEFAULT_HTML_BUDGET_BYTES) {
    if (!Number.isFinite(limit) || limit < 0) throw new RangeError('HTML 缓存预算必须是非负有限字节数')
    this.limit = Math.floor(limit)
  }

  record(id: string, result: ParseResult): void {
    this.entries.set(id, { bytes: serializedHtmlBytes(result), used: ++this.clock })
  }

  touch(id: string): void {
    const entry = this.entries.get(id)
    if (entry) entry.used = ++this.clock
  }

  remove(id: string): void { this.entries.delete(id) }

  stats(activeId: string | null): HtmlCacheStats {
    const retainedHtmlBytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    const activeHtmlBytes = this.entries.get(activeId ?? '')?.bytes ?? 0
    return { budgetBytes: this.limit, retainedHtmlBytes, activeHtmlBytes,
      backgroundHtmlBytes: retainedHtmlBytes - activeHtmlBytes,
      overBudgetBytes: Math.max(0, retainedHtmlBytes - this.limit) }
  }

  victims(activeId: string | null): string[] {
    let bytes = this.stats(activeId).retainedHtmlBytes
    const victims: string[] = []
    const candidates = [...this.entries].filter(([id]) => id !== activeId).sort((a, b) => a[1].used - b[1].used)
    for (const [id, entry] of candidates) {
      if (bytes <= this.limit) break
      victims.push(id)
      bytes -= entry.bytes
    }
    return victims
  }
}
