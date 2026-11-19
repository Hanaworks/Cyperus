import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockBridge, mockReset } from '@/core/ipc/mockBridge'

describe('mock document identities', () => {
  beforeEach(mockReset)
  afterEach(mockReset)

  it('preserves a live document when an earlier document closes and another opens', async () => {
    const a = await mockBridge.openDocument('fixtures/tabs/a.md')
    const b = await mockBridge.openDocument('fixtures/tabs/B.md')
    const bBytes = await mockBridge.readDocument(b.docId)

    await mockBridge.closeDocument(a.docId)
    const c = await mockBridge.openDocument('fixtures/tabs/c.md')

    expect(c.docId).not.toBe(b.docId)
    expect(c.docId).not.toBe(a.docId)
    expect(await mockBridge.readDocument(b.docId)).toEqual(bBytes)
    expect((await mockBridge.readDocumentMeta(b.docId)).path).toBe('fixtures/tabs/B.md')
    expect((await mockBridge.openDocument('fixtures/tabs/B.md')).docId).toBe(b.docId)
    await mockBridge.closeDocument(c.docId)
    expect(await mockBridge.readDocument(b.docId)).toEqual(bBytes)
  })

  it('resets the document identity sequence with isolated mock state', async () => {
    const first = await mockBridge.openDocument('fixtures/tabs/a.md')
    await mockBridge.openDocument('fixtures/tabs/B.md')
    mockReset()
    const fresh = await mockBridge.openDocument('fixtures/tabs/c.md')
    expect(fresh.docId).toBe(first.docId)
    expect((await mockBridge.readDocumentMeta(fresh.docId)).path).toBe('fixtures/tabs/c.md')
  })
})
