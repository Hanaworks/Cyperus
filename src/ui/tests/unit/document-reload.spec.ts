import { describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '@/core/documents/session'
import type { DocMeta } from '@/core/ipc/contract'
import type { ParseResult } from '@/core/render/contract'

function parsed(text: string, generation: number): ParseResult {
  return { ok: true, jobId: generation, generation, html: text, toc: [], blocks: [], mermaidCount: 0,
    unknownLangs: [], hasRawHtml: false, htmlBytes: text.length, parseMs: 0 }
}
function setup() {
  const files = new Map(['a.md', 'b.md', 'c.md'].map((path) => [path, { text: path, version: 1, gone: false }]))
  const meta = (path: string): DocMeta => {
    const file = files.get(path)
    if (!file || file.gone) throw new Error('文件不存在')
    return { docId: path, path, name: path, dir: '', size: file.text.length, mtimeMs: file.version,
      encoding: 'utf-8', hadBom: false, version: file.version, tooLarge: false }
  }
  const io = { openDocument: vi.fn(async (path: string) => meta(path)), readDocumentMeta: vi.fn(async (id: string) => meta(id)),
    readDocument: vi.fn(async (id: string) => { meta(id); return new TextEncoder().encode(files.get(id)?.text) }),
    closeDocument: vi.fn(async () => {}) }
  const parse = vi.fn(async (text: string, generation: number) => parsed(text, generation))
  const session = new DocumentSession(io, parse, () => {})
  return { files, io, parse, session }
}
describe('document refresh and navigation', () => {
  it.each([
    { encoding: 'utf-16le', bytes: [0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65], hadBom: true },
    { encoding: 'utf-16be', bytes: [0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87], hadBom: true },
    { encoding: 'gb18030', bytes: [0xd6, 0xd0, 0xce, 0xc4], hadBom: false },
  ])('retries the initial read if a save changes UTF-8 to $encoding before its bytes arrive', async ({ encoding, bytes, hadBom }) => {
    const initial: DocMeta = { docId: 'changing', path: 'changing.md', name: 'changing.md', dir: '',
      encoding: 'utf-8', hadBom: false, size: 3, version: 1, mtimeMs: 1, tooLarge: false }
    const updated = { ...initial, encoding, hadBom, size: bytes.length, version: 2, mtimeMs: 2 }
    let current = initial
    const io = {
      openDocument: vi.fn(async () => initial),
      readDocumentMeta: vi.fn(async () => current),
      readDocument: vi.fn(async () => { current = updated; return new Uint8Array(bytes) }),
      closeDocument: vi.fn(async () => {}),
    }
    const parse = vi.fn(async (text: string, generation: number) => parsed(text, generation))
    const session = new DocumentSession(io, parse, () => {})
    expect(await session.open('changing.md')).toBe(true)
    expect(session.active?.result?.html).toBe('中文')
    expect(session.active?.meta).toMatchObject({ encoding, hadBom, version: 2 })
    expect(io.readDocument).toHaveBeenCalledTimes(2)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(io.closeDocument).not.toHaveBeenCalled()
  })

  it('rejects a read spanning an encoding-only metadata change even before watcher version/stat updates', async () => {
    const initial: DocMeta = { docId: 'changing', path: 'changing.md', name: 'changing.md', dir: '',
      encoding: 'utf-8', hadBom: false, size: 4, version: 1, mtimeMs: 1, tooLarge: false }
    let current = initial
    let reads = 0
    const io = {
      openDocument: vi.fn(async () => initial),
      readDocumentMeta: vi.fn(async () => current),
      readDocument: vi.fn(async () => {
        reads += 1
        current = { ...initial, encoding: 'utf-16le' }
        return reads === 1 ? new TextEncoder().encode('old!') : new Uint8Array([0x2d, 0x4e, 0x87, 0x65])
      }),
      closeDocument: vi.fn(async () => {}),
    }
    const session = new DocumentSession(io, async (text, generation) => parsed(text, generation), () => {})
    expect(await session.open('changing.md')).toBe(true)
    expect(session.active?.result?.html).toBe('中文')
    expect(io.readDocument).toHaveBeenCalledTimes(2)
    expect(io.closeDocument).not.toHaveBeenCalled()
  })

  it('cancels remaining startup restoration after close all or an explicit open', async () => {
    for (const action of ['close', 'open']) {
      const { session, parse } = setup()
      let finish!: (value: ParseResult) => void
      parse.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      const restoring = session.restore(['a.md', 'b.md'].map((path) => ({ path, scrollTop: 0, search: { query: '', current: 0 } })), 'a.md')
      await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
      if (action === 'close') await session.closeAll()
      else await session.open('c.md')
      finish(parsed('a.md', 1))
      await restoring
      expect(session.tabs.some((tab) => tab.path === 'b.md')).toBe(false)
      expect(session.active?.path ?? '').toBe(action === 'close' ? '' : 'c.md')
    }
  })
  it('keeps a linked tab when an external save supersedes its initial parse', async () => {
    const { session, files, parse, io } = setup()
    await session.open('a.md')
    let finish!: (value: ParseResult) => void
    parse.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const opening = session.openLinked('b.md', 'heading', true)
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2))
    files.set('b.md', { text: 'new b', version: 2, gone: false })
    session.changed('b.md', 2)
    await session.whenReady(session.activeId ?? '')
    finish(parsed('old b', 1))
    expect(await opening).toBe(true)
    expect(session.active?.result?.html).toBe('new b')
    expect(session.active?.pendingAnchor).toBe('heading')
    expect(io.closeDocument).not.toHaveBeenCalled()
  })
  it('retains a restoring tab marked stale during its initial parse', async () => {
    const { session, files, parse } = setup()
    let finish!: (value: ParseResult) => void
    parse.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const restoring = session.restore([{ path: 'b.md', scrollTop: 100, search: { query: '', current: 0 } }], 'b.md')
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    files.set('b.md', { text: 'saved during restore', version: 2, gone: false })
    session.changed('b.md', 2)
    finish(parsed('old b', 1))
    expect(await restoring).toEqual([])
    await session.whenReady(session.activeId ?? '')
    expect(session.active?.result?.html).toBe('saved during restore')
    expect(session.active?.scrollTop).toBe(100)
  })
  it('refreshes a stale neighbour selected by closing the active tab', async () => {
    const { session, files } = setup()
    await session.openMany(['a.md', 'b.md'])
    const a = session.tabs[0]
    const b = session.tabs[1]
    if (!a || !b) throw new Error('missing tabs')
    files.set('b.md', { text: 'latest neighbour', version: 2, gone: false })
    session.changed('b.md', 2)
    await session.close(a.id)
    await session.whenReady(b.id)
    expect(session.activeId).toBe(b.id)
    expect(b.result?.html).toBe('latest neighbour')
  })
  it('restores order and state, skips missing files and selects a valid fallback', async () => {
    const { session } = setup()
    const failures = await session.restore([
      { path: 'missing.md', scrollTop: 0, search: { query: '', current: 0 } },
      { path: 'b.md', scrollTop: 234, search: { query: 'b', current: 1 } },
      { path: 'a.md', scrollTop: 99, search: { query: '', current: 0 } },
    ], 'missing.md')
    expect(failures).toHaveLength(1)
    expect(session.tabs.map((tab) => tab.path)).toEqual(['b.md', 'a.md'])
    expect(session.active?.scrollTop).toBe(234)
    expect(session.active?.search.query).toBe('b')
  })
  it('defers background updates until activation, preserving reading/search state', async () => {
    const { session, files, parse } = setup()
    await session.openMany(['a.md', 'b.md'])
    const b = session.tabs[1]
    if (!b) throw new Error('missing tab')
    session.setPosition(b.id, 500); session.setSearch(b.id, 'word', 2)
    files.set('b.md', { text: 'word word latest', version: 2, gone: false })
    session.changed('b.md', 2)
    expect(b.stale).toBe(true)
    expect(parse).toHaveBeenCalledTimes(2)
    session.activate(b.id)
    await session.whenReady(b.id)
    expect(b.result?.html).toBe('word word latest')
    expect(b.scrollTop).toBe(500)
    expect(b.search).toEqual({ query: 'word', current: 2 })
    expect(b.stale).toBe(false)
  })
  it('retains the last readable result on deletion and resumes when the file returns', async () => {
    const { session, files, io } = setup()
    await session.open('a.md')
    const tab = session.active
    if (!tab) throw new Error('missing tab')
    files.set('a.md', { text: '', version: 2, gone: true })
    session.changed('a.md', 2, true)
    expect(tab.result?.html).toBe('a.md')
    expect(tab.error).toContain('删除')
    expect(io.closeDocument).not.toHaveBeenCalled()
    files.set('a.md', { text: 'returned', version: 3, gone: false })
    session.changed('a.md', 3)
    await session.whenReady(tab.id)
    expect(tab.result?.html).toBe('returned')
    expect(tab.error).toBe('')
  })
  it('ignores stale parse completion after a newer change or close', async () => {
    const { session, files, parse } = setup()
    await session.open('a.md')
    const tab = session.active
    if (!tab) throw new Error('missing tab')
    let release!: (value: ParseResult) => void
    const slow = new Promise<ParseResult>((resolve) => { release = resolve })
    parse.mockImplementationOnce(() => slow)
    files.set('a.md', { text: 'old update', version: 2, gone: false })
    session.changed('a.md', 2)
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(2))
    files.set('a.md', { text: 'new update', version: 3, gone: false })
    session.changed('a.md', 3)
    await session.whenReady(tab.id)
    release(parsed('old update', 1))
    await Promise.resolve()
    expect(tab.result?.html).toBe('new update')
    await session.close(tab.id)
    session.changed('a.md', 4)
    expect(session.tabs).toHaveLength(0)
  })
  it('opens background links with deferred anchors, deduplicates and removes failed placeholders', async () => {
    const { session } = setup()
    await session.open('a.md')
    const a = session.activeId
    expect(await session.openLinked('b.md', 'heading', false)).toBe(true)
    expect(session.activeId).toBe(a)
    expect(session.tabs[1]?.pendingAnchor).toBe('heading')
    await session.openLinked('b.md', 'next', true)
    expect(session.tabs).toHaveLength(2)
    expect(session.active?.pendingAnchor).toBe('next')
    const b = session.activeId
    await expect(session.openLinked('missing.md', undefined, true)).rejects.toThrow('不存在')
    expect(session.activeId).toBe(b)
    expect(session.tabs).toHaveLength(2)
  })
  it('reorders and closes groups without losing the active document', async () => {
    const { session } = setup()
    await session.openMany(['a.md', 'b.md', 'c.md'])
    const [a, b, c] = session.tabs
    if (!a || !b || !c) throw new Error('missing tabs')
    session.reorder(c.id, 0)
    expect(session.tabs.map((tab) => tab.name)).toEqual(['c.md', 'a.md', 'b.md'])
    expect(session.activeId).toBe(a.id)
    await session.closeRight(a.id)
    expect(session.tabs.map((tab) => tab.id)).toEqual([c.id, a.id])
    await session.closeOthers(c.id)
    expect(session.activeId).toBe(c.id)
    expect(session.tabs.map((tab) => tab.id)).toEqual([c.id, a.id])
    expect(b).toBeDefined()
  })
})
