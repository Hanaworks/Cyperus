import type { SegmentStorageBackend, StoredPart } from '@/core/render/segmentStore'

/** Explicit test backend. Production always uses IndexedDB, never this map. */
export class MemorySegmentBackend implements SegmentStorageBackend {
  readonly parts = new Map<string, string>()
  failure: Error | undefined
  beforePut: (() => Promise<void>) | undefined
  private closed = false
  async put(parts: readonly StoredPart[]): Promise<void> {
    await this.beforePut?.()
    if (this.failure) throw this.failure
    for (const part of parts) this.parts.set(part.key, part.html)
  }
  async get(key: string): Promise<string> {
    const html = this.parts.get(key)
    if (html === undefined) throw new Error('Missing derived segment')
    return html
  }
  async delete(keys: readonly string[]): Promise<void> {
    if (this.closed) throw new Error('Storage connection closed')
    for (const key of keys) this.parts.delete(key)
  }
  async dispose(): Promise<void> { this.closed = true; this.parts.clear() }
}
