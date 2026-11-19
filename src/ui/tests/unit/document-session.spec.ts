import { describe, expect, it, vi } from 'vitest'
import { DocumentSession } from '@/core/documents/session'
import type { DocMeta } from '@/core/ipc/contract'
import type { ParseResult } from '@/core/render/contract'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

function parsed(text: string, generation: number): ParseResult {
  return { ok: true, jobId: generation, generation, html: `<p>${text}</p>`, toc: [], blocks: [],
    mermaidCount: 0, unknownLangs: [], hasRawHtml: false, htmlBytes: text.length + 7, parseMs: 1 }
}

// The host registry is idempotent by canonical path, rather than reference counted.
function host() {
  let sequence = 0
  const aliases = new Map<string, string>()
  const live = new Map<string, DocMeta>()
  const openGates = new Map<string, Promise<void>>()
  const readGates = new Map<string, Promise<Uint8Array>>()
  const failures = new Map<string, unknown>()
  const bytes = new Map<string, Uint8Array>()
  const io = {
    openDocument: vi.fn(async (path: string): Promise<DocMeta> => {
      await openGates.get(path)
      if (failures.has(path)) throw failures.get(path)
      const canonical = aliases.get(path) ?? path
      const existing = [...live.values()].find((meta) => meta.path === canonical)
      if (existing) return existing
      const name = canonical.split(/[\\/]/).at(-1) ?? canonical
      const meta: DocMeta = { docId: `doc-${++sequence}`, path: canonical, name, dir: '', size: 1,
        mtimeMs: 0, encoding: 'utf-8', hadBom: false, version: 1, tooLarge: false }
      live.set(meta.docId, meta)
      return meta
    }),
    readDocument: vi.fn(async (docId: string): Promise<Uint8Array> => {
      const meta = live.get(docId)
      if (!meta) throw new Error('Unknown host handle')
      return readGates.get(meta.path) ?? bytes.get(meta.path) ?? new TextEncoder().encode(meta.name)
    }),
    closeDocument: vi.fn(async (docId: string): Promise<void> => { live.delete(docId) }),
  }
  return { io, aliases, live, openGates, readGates, failures, bytes }
}

function setup() {
  const source = host()
  const parse = vi.fn(async (text: string, generation: number) => parsed(text, generation))
  const onChange = vi.fn()
  const session = new DocumentSession(source.io, parse, onChange)
  return { ...source, parse, onChange, session }
}

describe('DocumentSession', () => {
  it('reopens a closed path in its old slot with fresh content and saved reading/search state', async () => {
    const { session, bytes, live } = setup()
    await session.openMany(['A.md', 'B.md', 'C.md'])
    const b = session.tabs[1]?.id ?? ''
    session.activate(b)
    session.setPosition(b, 720)
    session.setSearch(b, 'word', 2)
    await session.close(b)
    expect(live.size).toBe(2)
    bytes.set('B.md', new TextEncoder().encode('updated word word'))
    expect(session.canReopen).toBe(true)
    expect(await session.reopenLastClosed()).toBe(true)
    expect(session.tabs.map((tab) => tab.path)).toEqual(['A.md', 'B.md', 'C.md'])
    expect(session.active?.id).not.toBe(b)
    expect(session.active?.result?.html).toContain('updated word word')
    expect(session.active?.scrollTop).toBe(720)
    expect(session.active?.search).toEqual({ query: 'word', current: 2 })
    expect(live.size).toBe(3)
    expect(session.canReopen).toBe(false)
  })

  it('retains only the last 15 closed paths in LIFO order, without retaining temporary text', async () => {
    const { session } = setup()
    for (let index = 0; index < 17; index += 1) {
      await session.open(`${index}.md`)
      await session.close(session.activeId ?? '')
    }
    const temporary = await session.openText('temporary', 'temporary.md')
    await session.close(temporary.id)
    const restored: string[] = []
    while (session.canReopen) {
      expect(await session.reopenLastClosed()).toBe(true)
      restored.push(session.active?.path ?? '')
    }
    expect(restored).toEqual(Array.from({ length: 15 }, (_, index) => `${16 - index}.md`))
    expect(await session.reopenLastClosed()).toBe(false)
  })

  it('activates an already reopened path without overwriting its live state or creating duplicates', async () => {
    const { session, parse } = setup()
    await session.open('A.md')
    session.setPosition(session.activeId ?? '', 123)
    await session.close(session.activeId ?? '')
    await session.open('A.md')
    const current = session.activeId ?? ''
    session.setPosition(current, 456)
    session.setSearch(current, 'new query', 3)
    await session.open('B.md')
    expect(await session.reopenLastClosed()).toBe(true)
    expect(session.activeId).toBe(current)
    expect(session.active?.scrollTop).toBe(456)
    expect(session.active?.search).toEqual({ query: 'new query', current: 3 })
    expect(session.tabs).toHaveLength(2)
    expect(parse).toHaveBeenCalledTimes(3)
  })

  it('reports vanished files without keeping an empty tab or disturbing another active document', async () => {
    const { session, failures } = setup()
    await session.openMany(['A.md', 'B.md'])
    const a = session.activeId
    await session.close(session.tabs[1]?.id ?? '')
    failures.set('B.md', { message: '文件已不存在' })
    await expect(session.reopenLastClosed()).rejects.toThrow('文件已不存在')
    expect(session.tabs.map((tab) => tab.path)).toEqual(['A.md'])
    expect(session.activeId).toBe(a)
    expect(session.canReopen).toBe(false)
  })

  it('serializes rapid close/reopen and never revives a restored tab closed while reading', async () => {
    const { session, readGates, io, live } = setup()
    await session.open('A.md')
    const closing = session.close(session.activeId ?? '')
    const reopening = session.reopenLastClosed()
    await closing
    expect(await reopening).toBe(true)
    expect(live.size).toBe(1)
    await session.close(session.activeId ?? '')
    const read = deferred<Uint8Array>()
    readGates.set('A.md', read.promise)
    const slowRestore = session.reopenLastClosed()
    await vi.waitFor(() => expect(io.readDocument).toHaveBeenCalledTimes(3))
    await session.close(session.activeId ?? '')
    read.resolve(new TextEncoder().encode('late content'))
    expect(await slowRestore).toBe(false)
    expect(session.tabs).toHaveLength(0)
    expect(live.size).toBe(0)
  })

  it('deduplicates restored aliases without releasing the retained document handle', async () => {
    const { session, aliases, live } = setup()
    await session.open('A.md')
    await session.close(session.activeId ?? '')
    await session.open('B.md')
    aliases.set('A.md', 'B.md')
    const id = session.activeId
    expect(await session.reopenLastClosed()).toBe(true)
    expect(session.activeId).toBe(id)
    expect(session.tabs).toHaveLength(1)
    expect(live.size).toBe(1)
  })

  it('retains independent search queries and matches without reparsing cached tabs', async () => {
    const { session, parse } = setup()
    await session.open('A.md')
    const a = session.activeId ?? ''
    session.setSearch(a, '中文', 3)
    await session.open('B.md')
    const b = session.activeId ?? ''
    expect(session.active?.search).toEqual({ query: '', current: 0 })
    session.setSearch(b, 'other', 2)
    session.activate(a)
    expect(session.active?.search).toEqual({ query: '中文', current: 3 })
    session.setSearch(a, '')
    expect(session.active?.search).toEqual({ query: '', current: 0 })
    session.activate(b)
    expect(session.active?.search).toEqual({ query: 'other', current: 2 })
    session.setSearch('missing', 'ignored', 4)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('keeps two cached results and independent reading positions when activating tabs', async () => {
    const { session, parse, io, onChange } = setup()
    expect(await session.open('A.md')).toBe(true)
    const a = session.active
    expect(a?.status).toBe('ready')
    const firstResult = a?.result
    session.setPosition(a?.id ?? '', 123)
    await session.open('B.md')
    const b = session.active
    session.setPosition(b?.id ?? '', 456)
    session.activate(a?.id ?? '')
    expect(session.active?.result).toBe(firstResult)
    expect(session.active?.scrollTop).toBe(123)
    session.activate(b?.id ?? '')
    expect(session.active?.scrollTop).toBe(456)
    expect(session.tabs.map((tab) => tab.name)).toEqual(['A.md', 'B.md'])
    expect(parse).toHaveBeenCalledTimes(2)
    expect(io.readDocument).toHaveBeenCalledTimes(2)
    expect(io.closeDocument).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
  })

  it('deduplicates concurrent and cached Windows path casing without extra host opens', async () => {
    const { session, io, parse } = setup()
    const first = session.open('C:\\Notes\\A.md')
    const second = session.open('c:/notes/a.MD')
    expect(session.tabs).toHaveLength(1)
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    await session.open('C:/NOTES/A.MD')
    expect(session.tabs).toHaveLength(1)
    expect(io.openDocument).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('merges concurrent host aliases without closing their shared uncounted handle', async () => {
    const { session, aliases, live, io, parse } = setup()
    aliases.set('relative/A.md', 'C:/Notes/A.md')
    aliases.set('another/A.md', 'C:/Notes/A.md')
    const a = session.open('relative/A.md')
    const alias = session.open('another/A.md')
    expect(await a).toBe(true)
    expect(await alias).toBe(true)
    expect(session.tabs).toHaveLength(1)
    expect(session.active?.path).toBe('C:/Notes/A.md')
    expect(session.active?.meta?.docId).toBe([...live.keys()][0])
    expect(parse).toHaveBeenCalledTimes(1)
    expect(io.closeDocument).not.toHaveBeenCalled()
    await session.closeAll()
    expect(live.size).toBe(0)
    expect(io.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('merges by the host docId even when its reported spelling changes', async () => {
    const { session, io, parse } = setup()
    await session.open('A.md')
    const meta = session.active?.meta
    if (!meta) throw new Error('Expected document metadata')
    io.openDocument.mockResolvedValueOnce({ ...meta, path: 'different-spelling.md' })
    expect(await session.open('alias.md')).toBe(true)
    expect(session.tabs).toHaveLength(1)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(io.closeDocument).not.toHaveBeenCalled()
  })

  it('preserves distinct case-sensitive POSIX documents', async () => {
    const { session } = setup()
    await session.open('/notes/A.md')
    await session.open('/notes/a.md')
    expect(session.tabs).toHaveLength(2)
  })

  it('a slow old read cannot take activation from a newer open or explicit activation', async () => {
    const { session, readGates, parse } = setup()
    const read = deferred<Uint8Array>()
    readGates.set('A.md', read.promise)
    const openingA = session.open('A.md')
    await vi.waitFor(() => expect(session.tabs[0]?.meta).not.toBeNull())
    await session.open('B.md')
    const b = session.active
    read.resolve(new TextEncoder().encode('slow A'))
    expect(await openingA).toBe(true)
    expect(session.active).toBe(b)
    expect(parse).toHaveBeenCalledTimes(2)

    const slowParse = deferred<ParseResult>()
    parse.mockImplementationOnce(() => slowParse.promise)
    const openingC = session.open('C.md')
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(3))
    session.activate(b?.id ?? '')
    slowParse.resolve(parsed('slow C', 3))
    await openingC
    expect(session.active).toBe(b)
  })

  it('opens a batch in order, selects the first, and preserves a later user selection', async () => {
    const { session, io, readGates } = setup()
    await session.openMany(['A.md', 'B.md', 'C.md'])
    expect(session.tabs.map((tab) => tab.path)).toEqual(['A.md', 'B.md', 'C.md'])
    expect(session.active?.path).toBe('A.md')
    expect(io.openDocument.mock.calls.map(([path]) => path)).toEqual(['A.md', 'B.md', 'C.md'])
    const read = deferred<Uint8Array>()
    readGates.set('D.md', read.promise)
    const batch = session.openMany(['D.md', 'E.md'])
    await session.open('F.md')
    read.resolve(new TextEncoder().encode('D'))
    await batch
    expect(session.active?.path).toBe('F.md')
  })

  it('closing an in-flight read releases immediately and never parses or restores its tab', async () => {
    const { session, readGates, io, parse, live } = setup()
    const read = deferred<Uint8Array>()
    readGates.set('A.md', read.promise)
    const opening = session.open('A.md')
    await vi.waitFor(() => expect(io.readDocument).toHaveBeenCalledTimes(1))
    await session.close(session.activeId ?? '')
    expect(session.tabs).toEqual([])
    expect(session.active).toBeNull()
    expect(live.size).toBe(0)
    read.resolve(new TextEncoder().encode('closed'))
    expect(await opening).toBe(false)
    expect(parse).not.toHaveBeenCalled()
    expect(io.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('closeAll waits for a pending host open, releases it, and cancels the rest of its batch', async () => {
    const { session, openGates, io, live, parse } = setup()
    const gate = deferred<void>()
    openGates.set('A.md', gate.promise)
    const batch = session.openMany(['A.md', 'B.md'])
    await vi.waitFor(() => expect(io.openDocument).toHaveBeenCalledTimes(1))
    let closed = false
    const closing = session.closeAll().then(() => { closed = true })
    expect(session.tabs).toEqual([])
    await Promise.resolve()
    expect(closed).toBe(false)
    gate.resolve()
    await closing
    await batch
    expect(live.size).toBe(0)
    expect(session.activeId).toBeNull()
    expect(io.openDocument).toHaveBeenCalledTimes(1)
    expect(parse).not.toHaveBeenCalled()
    expect(io.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('an immediately reopened path survives an older close and gets its own live handle', async () => {
    const { session, io, live } = setup()
    await session.open('A.md')
    const previousId = session.active?.meta?.docId
    const closing = session.close(session.activeId ?? '')
    const reopening = session.open('A.md')
    await closing
    expect(await reopening).toBe(true)
    expect(session.active?.meta?.docId).not.toBe(previousId)
    expect(live.has(session.active?.meta?.docId ?? '')).toBe(true)
    expect(io.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('a queued alias open cannot lose its live handle to a closing owner', async () => {
    const { session, aliases, live } = setup()
    aliases.set('alias.md', 'A.md')
    await session.open('A.md')
    const a = session.activeId ?? ''
    const alias = session.open('alias.md')
    const closing = session.close(a)
    await closing
    expect(await alias).toBe(true)
    expect(session.tabs).toHaveLength(1)
    expect(session.active?.status).toBe('ready')
    expect(live.has(session.active?.meta?.docId ?? '')).toBe(true)
    await session.closeAll()
    expect(live.size).toBe(0)
  })

  it('closes nonactive, active, and final tabs with the nearest surviving tab selected', async () => {
    const { session, live } = setup()
    await session.openMany(['A.md', 'B.md', 'C.md'])
    const [a, b, c] = session.tabs
    await session.close(c?.id ?? '')
    expect(session.active?.name).toBe('A.md')
    await session.close(a?.id ?? '')
    expect(session.active?.id).toBe(b?.id)
    await session.close(b?.id ?? '')
    expect(session.tabs).toEqual([])
    expect(session.activeId).toBeNull()
    expect(live.size).toBe(0)
  })

  it('keeps successful tabs on structured open failures and can retry the failed tab', async () => {
    const { session, failures } = setup()
    await session.open('A.md')
    const a = session.active
    failures.set('B.md', { code: 'E_FILE_ACCESS', message: 'Access denied' })
    expect(await session.open('B.md')).toBe(false)
    expect(session.tabs).toHaveLength(2)
    expect(a?.status).toBe('ready')
    expect(session.active?.status).toBe('error')
    expect(session.active?.error).toContain('Access denied')
    const failedId = session.activeId
    failures.delete('B.md')
    expect(await session.open('B.md')).toBe(true)
    expect(session.activeId).toBe(failedId)
    expect(session.active?.error).toBe('')
    expect(session.tabs).toHaveLength(2)
  })

  it('releases failed reads and parses while retaining other cached documents', async () => {
    const { session, readGates, live, parse } = setup()
    await session.open('A.md')
    const failedRead = deferred<Uint8Array>()
    readGates.set('B.md', failedRead.promise)
    const openingB = session.open('B.md')
    // Encoding failure exercises cleanup after the host already granted a handle.
    failedRead.resolve(new Uint8Array([0xff]))
    expect(await openingB).toBe(false)
    expect(session.active?.status).toBe('error')
    expect(live.size).toBe(1)
    parse.mockRejectedValueOnce(new Error('Parser unavailable'))
    expect(await session.open('C.md')).toBe(false)
    expect(session.active?.error).toContain('Parser unavailable')
    expect(live.size).toBe(1)
    expect(session.tabs[0]?.status).toBe('ready')
  })

  it('retries a failed canonical document when first reopened through a new host alias', async () => {
    const { session, aliases, io, live, parse } = setup()
    aliases.set('alias.md', 'A.md')
    parse.mockRejectedValueOnce(new Error('Initial parse failure'))
    expect(await session.open('A.md')).toBe(false)
    const failed = session.active
    const failedDocId = failed?.meta?.docId
    expect(failed?.status).toBe('error')
    expect(live.size).toBe(0)

    expect(await session.open('alias.md')).toBe(true)
    expect(session.tabs).toHaveLength(1)
    expect(session.activeId).toBe(failed?.id)
    expect(session.active?.path).toBe('A.md')
    expect(session.active?.status).toBe('ready')
    expect(session.active?.error).toBe('')
    expect(session.active?.meta?.docId).not.toBe(failedDocId)
    expect(live.has(session.active?.meta?.docId ?? '')).toBe(true)
    expect(parse).toHaveBeenCalledTimes(2)
    expect(io.readDocument).toHaveBeenCalledTimes(2)
    await session.open('A.md')
    expect(session.tabs).toHaveLength(1)
    expect(parse).toHaveBeenCalledTimes(2)
    await session.closeAll()
    expect(live.size).toBe(0)
    expect(io.closeDocument).toHaveBeenCalledTimes(2)
  })

  it('a late error from a closed parse does not affect the active document', async () => {
    const { session, parse } = setup()
    let reject!: (error: Error) => void
    parse.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no }))
    const opening = session.open('A.md')
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    const closing = session.close(session.activeId ?? '')
    await session.open('B.md')
    await closing
    reject(new Error('Late parser failure'))
    expect(await opening).toBe(false)
    expect(session.active?.name).toBe('B.md')
    expect(session.active?.error).toBe('')
    expect(session.tabs).toHaveLength(1)
  })

  it('openText uses no host, accepts empty text, and has unique parse generations', async () => {
    const { session, io, parse } = setup()
    const empty = await session.openText('', 'empty.md')
    const text = await session.openText('memory text', 'memory.md')
    expect(empty.meta).toBeNull()
    expect(empty.result?.html).toBe('<p></p>')
    expect(text.status).toBe('ready')
    expect(session.active).toBe(text)
    expect(empty.result?.generation).not.toBe(text.result?.generation)
    expect(parse.mock.calls.map(([source]) => source)).toEqual(['', 'memory text'])
    await session.closeAll()
    expect(io.openDocument).not.toHaveBeenCalled()
    expect(io.readDocument).not.toHaveBeenCalled()
    expect(io.closeDocument).not.toHaveBeenCalled()
  })

  it('reports temporary-text parse errors and does not resurrect closed text tabs', async () => {
    const { session, parse } = setup()
    parse.mockRejectedValueOnce(new Error('Bad parse'))
    await expect(session.openText('text', 'broken.md')).rejects.toThrow('Bad parse')
    expect(session.active?.status).toBe('error')
    const pending = deferred<ParseResult>()
    parse.mockImplementationOnce(() => pending.promise)
    const opening = session.openText('slow', 'closed.md')
    const result = expect(opening).rejects.toThrow()
    await session.closeAll()
    pending.resolve(parsed('slow', 2))
    await result
    expect(session.tabs).toEqual([])
  })

  it('ignores unknown activation and invalid positions without corrupting current state', async () => {
    const { session } = setup()
    await session.open('A.md')
    const id = session.activeId ?? ''
    session.setPosition(id, 42)
    session.setPosition(id, Number.NaN)
    session.activate('missing')
    expect(session.activeId).toBe(id)
    expect(session.active?.scrollTop).toBe(42)
    session.setPosition(id, -4)
    expect(session.active?.scrollTop).toBe(0)
    await session.close('missing')
    expect(session.tabs).toHaveLength(1)
  })
})
