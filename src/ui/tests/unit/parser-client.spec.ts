import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParserClient } from '@/core/render/client'
import type { ParseRequest, ParseResponse } from '@/core/render/contract'

class WorkerDouble {
  static instance: WorkerDouble
  onmessage: ((event: MessageEvent<ParseResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  messages: ParseRequest[] = []
  terminated = false
  constructor() { WorkerDouble.instance = this }
  postMessage(request: ParseRequest) { this.messages.push(request) }
  terminate() { this.terminated = true }
  complete(index: number, failure = false) {
    const request = this.messages[index]
    if (!request) throw new Error('Expected queued worker request')
    const common = { jobId: request.jobId, generation: request.generation, parseMs: 0 }
    this.onmessage?.({ data: failure ? { ...common, ok: false, message: 'bad input' } : {
      ...common, ok: true, html: request.text, htmlBytes: request.text.length, toc: [], blocks: [],
      mermaidCount: 0, unknownLangs: [], hasRawHtml: false,
    } } as MessageEvent<ParseResponse>)
  }
}
function setup() {
  vi.stubGlobal('Worker', WorkerDouble)
  const client = new ParserClient()
  return { client, worker: WorkerDouble.instance }
}
afterEach(() => vi.unstubAllGlobals())

describe('single parser scheduling', () => {
  it('posts only one job at a time and keeps separate document requests', async () => {
    const { client, worker } = setup()
    const first = client.parse('first', 1, 'a')
    const second = client.parse('second', 2, 'b')
    expect(worker.messages.map((job) => job.docId)).toEqual(['a'])
    worker.complete(0)
    expect((await first).html).toBe('first')
    expect(worker.messages.map((job) => job.docId)).toEqual(['a', 'b'])
    worker.complete(1)
    expect((await second).html).toBe('second')
    client.dispose()
  })

  it('replaces queued work for the same document without parsing obsolete text', async () => {
    const { client, worker } = setup()
    const first = client.parse('busy', 1, 'a')
    const obsolete = client.parse('old', 2, 'b')
    const replaced = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })
    const latest = client.parse('new', 3, 'b')
    await replaced
    worker.complete(0)
    await first
    expect(worker.messages.map((job) => job.text)).toEqual(['busy', 'new'])
    worker.complete(1)
    expect((await latest).generation).toBe(3)
    client.dispose()
  })

  it('drops superseded in-flight output while retaining its serial slot until completion', async () => {
    const { client, worker } = setup()
    const first = client.parse('old', 1, 'a')
    const discarded = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const next = client.parse('new', 2, 'a')
    await discarded
    expect(worker.messages).toHaveLength(1)
    worker.complete(0)
    expect(worker.messages).toHaveLength(2)
    worker.complete(1)
    expect((await next).html).toBe('new')
    client.dispose()
  })

  it('cancels closed document jobs, settles disposal and rejects future calls without hanging', async () => {
    const { client, worker } = setup()
    const current = client.parse('running', 1, 'a')
    const queued = client.parse('closed', 2, 'b')
    client.cancel('b')
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    client.dispose()
    await expect(current).rejects.toThrow('关闭')
    await expect(client.parse('after disposal', 3, 'c')).rejects.toThrow('关闭')
    worker.complete(0)
    expect(worker.messages).toHaveLength(1)
    expect(worker.terminated).toBe(true)
  })

  it('continues after a per-document parse failure, but settles all jobs on a worker crash', async () => {
    const { client, worker } = setup()
    const failed = client.parse('invalid', 1, 'a')
    const pending = client.parse('pending', 2, 'b')
    worker.complete(0, true)
    await expect(failed).rejects.toThrow('bad input')
    expect(worker.messages).toHaveLength(2)
    worker.onerror?.({ message: 'worker crashed' } as ErrorEvent)
    await expect(pending).rejects.toThrow('worker crashed')
    await expect(client.parse('later', 3)).rejects.toThrow('worker crashed')
    expect(worker.terminated).toBe(true)
  })

  it('observes rejected jobs internally without hiding the rejection from callers', async () => {
    const { client } = setup()
    const ignored = client.parse('running', 1, 'a')
    void client.parse('pending', 2, 'b')
    void client.parse('replacement', 3, 'b')
    client.dispose()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(ignored).rejects.toThrow('关闭')
    // Vitest also fails this test run on any unhandled rejection.
  })
})
