import { describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '@/core/documents/session'
import type { DocMeta } from '@/core/ipc/contract'
import type { ParseResult } from '@/core/render/contract'
import { SegmentStore } from '@/core/render/segmentStore'
import { MemorySegmentBackend } from '../helpers/segmentStorage'

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture state')
  return value
}
function result(html: string, generation: number): ParseResult {
  return { ok: true, jobId: generation, generation, html, toc: [], blocks: [], mermaidCount: 0,
    unknownLangs: [], hasRawHtml: false, htmlBytes: 1, parseMs: 0 }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}
function setup(htmlBudgetBytes = 36, html = '<p>hello</p>') {
  const files = new Map<string, { text: string; version: number }>()
  const live = new Set<string>()
  const meta = (path: string): DocMeta => {
    const file = required(files.get(path))
    return { docId: path, path, name: path, dir: '', size: new TextEncoder().encode(file.text).length,
      mtimeMs: file.version, encoding: 'utf-8', hadBom: false, version: file.version, tooLarge: false }
  }
  const io = {
    openDocument: vi.fn(async (path: string) => {
      if (!files.has(path)) files.set(path, { text: html, version: 1 })
      live.add(path)
      return meta(path)
    }),
    readDocumentMeta: vi.fn(async (path: string) => meta(path)),
    readDocument: vi.fn(async (path: string) => new TextEncoder().encode(required(files.get(path)).text)),
    closeDocument: vi.fn(async (path: string) => { live.delete(path) }),
  }
  const parse = vi.fn(async (text: string, generation: number) => result(text, generation))
  const cancelParse = vi.fn()
  const backend = new MemorySegmentBackend()
  const segmentStore = new SegmentStore(backend)
  const session = new DocumentSession(io, parse, () => {}, { htmlBudgetBytes, cancelParse, segmentStore })
  return { session, files, live, io, parse, cancelParse, backend, segmentStore }
}

describe('document HTML budget', () => {
  it('applies the default 48 MiB budget to actual retained HTML across 50 documents', async () => {
    const { io, parse } = setup(1, 'x'.repeat(1024 * 1024))
    const session = new DocumentSession(io, parse, () => {})
    await session.openMany(Array.from({ length: 50 }, (_, index) => `default-${index}`))
    expect(session.tabs).toHaveLength(50)
    expect(session.tabs.filter((tab) => tab.result)).toHaveLength(48)
    expect(session.tabs[1]?.result).toBeNull()
    expect(session.tabs[2]?.result).toBeNull()
    expect(session.cacheStats).toMatchObject({ budgetBytes: 50331648, retainedHtmlBytes: 50331648,
      activeHtmlBytes: 1048576, backgroundHtmlBytes: 49283072, overBudgetBytes: 0 })
    await session.closeAll()
    expect(session.cacheStats.retainedHtmlBytes).toBe(0)
  })

  it('accounts for every segmented HTML string even when the full HTML field is empty', async () => {
    const { session, parse } = setup(24)
    parse.mockImplementation(async (text, generation) => ({ ...result('', generation), segments: [
      { html: text, line: 0, endLine: 2, anchors: ['first'] },
      { html: '<p>中文😀</p>', line: 2, endLine: 4, anchors: ['second'] },
    ] }))
    await session.openMany(['a', 'b'])
    expect(session.active?.result?.html).toBe('')
    expect(session.tabs[1]?.result).toBeNull()
    expect(session.cacheStats).toMatchObject({ retainedHtmlBytes: 0, activeHtmlBytes: 0,
      storedHtmlBytes: 29, backgroundHtmlBytes: 0, overBudgetBytes: 0 })
  })

  it('restores reading anchors through eviction and close/reopen without retaining mutable caller objects', async () => {
    const { session } = setup(12)
    await session.restore([{ path: 'a', scrollTop: 100, search: { query: 'word', current: 1 },
      anchor: { id: 'heading', text: 'Heading', line: 20, ratio: 0.5 } }], 'a')
    const a = required(session.active)
    expect(a.anchor).toEqual({ id: 'heading', text: 'Heading', line: 20, ratio: 0.5 })
    const anchor = { id: 'updated', text: 'Updated', line: 40, ratio: 0.25 }
    session.setReadingAnchor(a.id, anchor)
    anchor.line = 99
    await session.open('b')
    expect(a.result).toBeNull()
    expect(a.anchor?.line).toBe(40)
    await session.close(a.id)
    await session.reopenLastClosed()
    expect(session.active?.anchor).toEqual({ id: 'updated', text: 'Updated', line: 40, ratio: 0.25 })
  })

  it('closes a budgeted batch without rereading each evicted neighbour during teardown', async () => {
    const { session, io } = setup(12)
    await session.openMany(['a', 'b', 'c'])
    const reads = io.readDocument.mock.calls.length
    const metadataReads = io.readDocumentMeta.mock.calls.length
    await session.closeAll()
    expect(io.readDocumentMeta).toHaveBeenCalledTimes(metadataReads)
    expect(io.readDocument).toHaveBeenCalledTimes(reads)
  })

  it('reloads an evicted tab selected through a newly discovered canonical alias', async () => {
    const { session, io } = setup(12)
    await session.open('a')
    const a = required(session.active)
    await session.open('b')
    expect(a.result).toBeNull()
    io.openDocument.mockResolvedValueOnce(required(a.meta))
    expect(await session.open('alias-a')).toBe(true)
    expect(session.activeId).toBe(a.id)
    expect(a.result?.html).toBe('<p>hello</p>')
    expect(session.tabs).toHaveLength(2)
  })

  it('evicts the least recently activated background HTML while retaining lightweight state and host ownership', async () => {
    const { session, live, io, parse } = setup()
    await session.openMany(['a', 'b', 'c'])
    const [a, b, c] = session.tabs
    if (!a || !b || !c) throw new Error('Expected three tabs')
    session.setPosition(b.id, 321)
    session.setSearch(b.id, 'word', 2)
    session.activate(c.id)
    session.activate(a.id)
    await session.open('d')
    expect(b.result).toBeNull()
    expect(a.result?.html).toBe('<p>hello</p>')
    expect(c.result?.html).toBe('<p>hello</p>')
    expect(b.path).toBe('b')
    expect(b.scrollTop).toBe(321)
    expect(b.search).toEqual({ query: 'word', current: 2 })
    expect(live.size).toBe(4)
    expect(session.cacheStats.retainedHtmlBytes).toBe(36)
    const reads = io.readDocument.mock.calls.length
    session.activate(a.id)
    await session.whenReady(a.id)
    expect(io.readDocument).toHaveBeenCalledTimes(reads)
    expect(parse).toHaveBeenCalledTimes(4)
    session.activate(b.id)
    await session.whenReady(b.id)
    expect(b.result?.html).toBe('<p>hello</p>')
    expect(b.scrollTop).toBe(321)
    expect(io.readDocument).toHaveBeenCalledTimes(reads + 1)
    expect(io.openDocument).toHaveBeenCalledTimes(4)
  })

  it('counts UTF-8 HTML bytes independently of parser metadata and removes all background results for an oversized active result', async () => {
    const { session, segmentStore } = setup(12, '<p>x</p>')
    await session.open('small')
    const small = required(session.active)
    const large = await session.openText('<p>中文😀</p>', 'large')
    expect(small.result).toBeNull()
    expect(large.result?.html).toBe('')
    expect(await segmentStore.read(required(large.result?.segments?.[0]))).toBe('<p>中文😀</p>')
    expect(session.cacheStats).toMatchObject({ budgetBytes: 12, retainedHtmlBytes: 0,
      activeHtmlBytes: 0, storedHtmlBytes: 17, backgroundHtmlBytes: 0, overBudgetBytes: 0 })
    await session.openLinked('background', undefined, false)
    expect(session.tabs.at(-1)?.result).toBeNull()
    expect(session.cacheStats.backgroundHtmlBytes).toBe(0)
    session.activate(small.id)
    await session.whenReady(small.id)
    expect(large.result).toBeNull()
    expect(session.cacheStats.overBudgetBytes).toBe(0)
    session.activate(large.id)
    await session.whenReady(large.id)
    expect(await segmentStore.read(required(large.result?.segments?.[0]))).toBe('<p>中文😀</p>')
  })

  it('removes a completed temporary write when its document was closed during storage', async () => {
    const { session, backend, parse } = setup(4)
    const gate = deferred<void>()
    backend.beforePut = () => gate.promise
    const opening = session.open('large')
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    const closed = session.close(session.activeId ?? '')
    gate.resolve()
    await closed
    expect(await opening).toBe(false)
    expect(backend.parts.size).toBe(0)
    expect(session.cacheStats.retainedHtmlBytes).toBe(0)
  })

  it('retains a readable old version when quota prevents storing its expanded refresh', async () => {
    const { session, backend, files } = setup(12)
    await session.open('a')
    backend.failure = new Error('Quota exceeded')
    files.set('a', { text: 'a newer version too large for the cache', version: 2 })
    expect(await session.refresh()).toBe(false)
    expect(session.active?.result?.html).toBe('<p>hello</p>')
    expect(session.active?.error).toContain('Quota exceeded')
    expect(session.cacheStats.retainedHtmlBytes).toBe(12)
    expect(backend.parts.size).toBe(0)
  })

  it('discards an obsolete stored refresh after a newer small version finishes', async () => {
    const { session, backend, files, parse } = setup(12)
    await session.open('a')
    const gate = deferred<void>()
    backend.beforePut = () => gate.promise
    files.set('a', { text: 'obsolete expanded output', version: 2 })
    const obsolete = session.refresh()
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2))
    files.set('a', { text: 'latest', version: 3 })
    expect(await session.refresh()).toBe(true)
    gate.resolve()
    expect(await obsolete).toBe(false)
    expect(session.active?.result?.html).toBe('latest')
    expect(backend.parts.size).toBe(0)
    expect(session.cacheStats.storedHtmlBytes).toBe(0)
  })

  it.each([10, 30, 100])('keeps %i tabs within the budget through reactivation, updates and close', async (count) => {
    const { session, files, parse, live } = setup(3 * 1024 * 1024, 'x'.repeat(512 * 1024))
    await session.openMany(Array.from({ length: count }, (_, i) => `file-${i}`))
    expect(session.tabs).toHaveLength(count)
    expect(session.tabs.filter((tab) => tab.result)).toHaveLength(6)
    expect(session.active?.path).toBe('file-0')
    expect(session.cacheStats.retainedHtmlBytes).toBe(3 * 1024 * 1024)
    const evicted = required(session.tabs[1])
    expect(evicted.result).toBeNull()
    session.setPosition(evicted.id, 900)
    session.setSearch(evicted.id, 'saved', 1)
    files.set(evicted.path, { text: 'saved updated version', version: 2 })
    session.changed(evicted.path, 2)
    expect(parse).toHaveBeenCalledTimes(count)
    session.activate(evicted.id)
    await session.whenReady(evicted.id)
    expect(evicted.result?.html).toBe('saved updated version')
    expect(evicted.meta?.version).toBe(2)
    expect(evicted.scrollTop).toBe(900)
    expect(evicted.search).toEqual({ query: 'saved', current: 1 })
    expect(session.cacheStats.retainedHtmlBytes).toBeLessThanOrEqual(3 * 1024 * 1024)
    await session.closeAll()
    expect(session.cacheStats.retainedHtmlBytes).toBe(0)
    expect(live.size).toBe(0)
  })

  it('does not let a pending refresh refill evicted HTML or overwrite a newer version', async () => {
    const { session, parse, files, cancelParse } = setup(12)
    await session.open('a')
    const a = required(session.active)
    const gate = deferred<ParseResult>()
    parse.mockImplementationOnce(() => gate.promise)
    files.set('a', { text: 'outdated', version: 2 })
    const oldRefresh = session.refresh(a.id)
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2))
    await session.open('b')
    expect(a.result).toBeNull()
    expect(cancelParse).toHaveBeenCalledWith(a.id)
    files.set('a', { text: 'latest', version: 3 })
    session.changed('a', 3)
    session.activate(a.id)
    await session.whenReady(a.id)
    gate.resolve(result('outdated', 2))
    expect(await oldRefresh).toBe(false)
    expect(a.result?.html).toBe('latest')
    expect(session.cacheStats.retainedHtmlBytes).toBe(6)
  })

  it('discards a closed evicted reload and releases its HTML even through held tab references', async () => {
    const { session, parse, live, cancelParse } = setup(12)
    await session.open('a')
    const a = required(session.active)
    await session.open('b')
    const gate = deferred<ParseResult>()
    parse.mockImplementationOnce(() => gate.promise)
    session.activate(a.id)
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(3))
    const loading = session.whenReady(a.id)
    await session.close(a.id)
    gate.resolve(result('late', 3))
    await loading
    expect(a.result).toBeNull()
    expect(session.active?.path).toBe('b')
    expect(live.has('a')).toBe(false)
    expect(cancelParse).toHaveBeenCalledWith(a.id)
    const b = required(session.active)
    await session.closeAll()
    expect(b.result).toBeNull()
    expect(session.cacheStats.retainedHtmlBytes).toBe(0)
  })
})
