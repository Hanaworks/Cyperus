import { describe, expect, it } from 'vitest'
import { IncomingFiles } from '@/core/documents/incomingFiles'

describe('incoming files', () => {
  it('waits for session restoration and opens queued launches in order', async () => {
    const opened: string[][] = []
    const incoming = new IncomingFiles(async (paths) => { opened.push(paths) }, () => {})
    incoming.receive(['a.md'])
    incoming.receive(['b.md', 'b.md', 'notes.txt', '--hidden.md'])
    await Promise.resolve()
    expect(opened).toEqual([])
    await incoming.start()
    expect(opened).toEqual([['a.md'], ['b.md']])
  })
  it('serializes launches arriving while an earlier document is opening', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const opened: string[] = []
    const incoming = new IncomingFiles(async (paths) => {
      opened.push(`${paths[0]}:start`)
      if (paths[0] === 'a.md') await gate
      opened.push(`${paths[0]}:done`)
    }, () => {})
    await incoming.start()
    incoming.receive(['a.md'])
    incoming.receive(['b.md'])
    await Promise.resolve()
    expect(opened).toEqual(['a.md:start'])
    release()
    await incoming.flush()
    expect(opened).toEqual(['a.md:start', 'a.md:done', 'b.md:start', 'b.md:done'])
  })
  it('reports a failed launch without losing the next, and ignores malformed payloads', async () => {
    const opened: string[] = []
    const errors: unknown[] = []
    const incoming = new IncomingFiles(async (paths) => {
      if (paths[0] === 'missing.md') throw new Error('missing')
      opened.push(...paths)
    }, (error) => errors.push(error))
    incoming.receive(null)
    incoming.receive([123, 'bad\0.md', 'missing.md'])
    incoming.receive(['valid.markdown'])
    await incoming.start()
    expect(errors).toHaveLength(1)
    expect(opened).toEqual(['valid.markdown'])
  })
  it('does not open queued documents after disposal', async () => {
    const opened: string[][] = []
    const incoming = new IncomingFiles(async (paths) => { opened.push(paths) }, () => {})
    incoming.receive(['a.md'])
    incoming.dispose()
    await incoming.start()
    incoming.receive(['b.md'])
    await incoming.flush()
    expect(opened).toEqual([])
  })
})
