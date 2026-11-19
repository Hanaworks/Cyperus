import { describe, expect, it } from 'vitest'
import { serializedHtmlBytes } from '@/core/documents/budget'
import type { ParseResult } from '@/core/render/contract'
import { SegmentStore } from '@/core/render/segmentStore'
import { MemorySegmentBackend } from '../helpers/segmentStorage'

function parsed(): ParseResult {
  return { ok: true, jobId: 1, generation: 1, html: '', htmlBytes: 17, sourceBytes: 10,
    segments: [{ html: '<p>中文😀</p>', line: 1, endLine: 3, anchors: ['heading'] }],
    toc: [], blocks: [], mermaidCount: 0, unknownLangs: [], hasRawHtml: false, parseMs: 1 }
}

describe('derived HTML segment storage', () => {
  it('settles pending writes on disposal and makes repeated teardown safe', async () => {
    const backend = new MemorySegmentBackend()
    const store = new SegmentStore(backend)
    let finish!: () => void
    backend.beforePut = () => new Promise<void>((resolve) => { finish = resolve })
    const writing = store.spill(parsed())
    const disposed = store.dispose()
    finish()
    await expect(writing).rejects.toThrow('关闭')
    await disposed
    expect(backend.parts.size).toBe(0)
    await expect(store.dispose()).resolves.toBeUndefined()
    await expect(store.spill(parsed())).rejects.toThrow('关闭')
  })
  it('removes every serialized HTML reference after durable write while preserving readable segment metadata', async () => {
    const backend = new MemorySegmentBackend()
    const store = new SegmentStore(backend)
    const source = parsed()
    const originalSegment = source.segments?.[0]
    const stored = await store.spill(source)
    const segment = stored.segments?.[0]
    if (!segment) throw new Error('Expected stored segment')
    expect(serializedHtmlBytes(stored)).toBe(0)
    expect(source.html).toBe('')
    expect(originalSegment?.html).toBe('')
    expect(segment).toMatchObject({ html: '', htmlLength: 11, htmlBytes: 17, line: 1, endLine: 3, anchors: ['heading'] })
    expect(await store.read(segment)).toBe('<p>中文😀</p>')
    expect(segment.html).toBe('')
    await store.release(stored)
    expect(backend.parts.size).toBe(0)
    await expect(store.read(segment)).rejects.toThrow()
  })

  it('handles expanded nonsegmented HTML as one indivisible segment without truncating its markup', async () => {
    const store = new SegmentStore(new MemorySegmentBackend())
    const source = parsed()
    delete source.segments
    source.html = '<table><tbody><tr><td>whole</td></tr></tbody></table>'
    const stored = await store.spill(source)
    expect(stored.html).toBe('')
    expect(stored.segments).toHaveLength(1)
    const segment = stored.segments?.[0]
    if (!segment) throw new Error('Expected stored segment')
    expect(segment.oversized).toBe(true)
    expect(await store.read(segment)).toBe('<table><tbody><tr><td>whole</td></tr></tbody></table>')
    await store.dispose()
    await expect(store.read(segment)).rejects.toThrow()
  })

  it('does not clear source HTML or publish descriptors when storage rejects the write', async () => {
    const backend = new MemorySegmentBackend()
    const store = new SegmentStore(backend)
    const source = parsed()
    backend.failure = new Error('Quota exceeded')
    await expect(store.spill(source)).rejects.toThrow('Quota exceeded')
    expect(source.segments?.[0]?.html).toBe('<p>中文😀</p>')
    expect(source.segments?.[0]?.storageKey).toBeUndefined()
    expect(backend.parts.size).toBe(0)
  })
})
