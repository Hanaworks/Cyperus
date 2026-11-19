import { expect, it, vi } from 'vitest'
import { DocumentOpener } from '@/core/documents/opener'
import type { DocMeta } from '@/core/ipc/contract'

const doc = (id: string): DocMeta => ({ docId: id, name: id, path: id, dir: '', size: 1, mtimeMs: 0, encoding: 'utf-8', hadBom: false, version: 1, tooLarge: false })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes }); return { promise, resolve } }

it('慢的旧打开不能覆盖后请求文档，且旧句柄会关闭', async () => {
  const first = deferred<DocMeta>()
  const io = { openDocument: vi.fn((path: string) => path === 'A' ? first.promise : Promise.resolve(doc(path))),
    readDocument: vi.fn(async () => new Uint8Array([1])), closeDocument: vi.fn(async () => undefined) }
  const commit = vi.fn(async (_document: DocMeta) => undefined)
  const opener = new DocumentOpener(io, commit, () => undefined)
  const a = opener.open('A')
  await vi.waitFor(() => expect(io.openDocument).toHaveBeenCalledWith('A'))
  const b = opener.open('B')
  first.resolve(doc('A'))
  expect(await a).toBe(false)
  expect(await b).toBe(true)
  expect(commit).toHaveBeenCalledTimes(1)
  expect(commit.mock.calls[0]?.[0].docId).toBe('B')
  expect(io.closeDocument).toHaveBeenCalledWith('A')
})

it('读取未结束时关闭，不会重新显示文档或遗留句柄', async () => {
  const read = deferred<Uint8Array>()
  const io = { openDocument: vi.fn(async () => doc('A')), readDocument: vi.fn(() => read.promise), closeDocument: vi.fn(async () => undefined) }
  const commit = vi.fn(async () => undefined)
  const clear = vi.fn()
  const opener = new DocumentOpener(io, commit, clear)
  const opening = opener.open('A')
  await vi.waitFor(() => expect(io.readDocument).toHaveBeenCalled())
  const closing = opener.close()
  expect(clear).toHaveBeenCalledTimes(2)
  read.resolve(new Uint8Array([1]))
  expect(await opening).toBe(false)
  await closing
  expect(commit).not.toHaveBeenCalled()
  expect(io.closeDocument).toHaveBeenCalledWith('A')
})

it('失效打开的晚到异常不会污染后续有效文档', async () => {
  let reject!: (error: Error) => void
  const failure = new Promise<DocMeta>((_resolve, no) => { reject = no })
  const io = { openDocument: vi.fn((path: string) => path === 'A' ? failure : Promise.resolve(doc(path))),
    readDocument: vi.fn(async () => new Uint8Array([1])), closeDocument: vi.fn(async () => undefined) }
  const commit = vi.fn(async (_document: DocMeta) => undefined)
  const opener = new DocumentOpener(io, commit, () => undefined)
  const a = opener.open('A')
  await vi.waitFor(() => expect(io.openDocument).toHaveBeenCalledWith('A'))
  const b = opener.open('B')
  reject(new Error('旧文件访问失败'))
  expect(await a).toBe(false)
  expect(await b).toBe(true)
})
