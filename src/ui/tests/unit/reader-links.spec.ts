// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mockBridge, mockReset } from '@/core/ipc/mockBridge'
import { bindReaderLinks } from '@/reader/links'

describe('reader link dispatch', () => {
  it('reports target on keyboard focus and hover, then clears on exit', () => {
    const root = document.createElement('article')
    root.innerHTML = '<a href="target.md#section"><strong>link</strong></a>'
    const hover = vi.fn()
    const dispose = bindReaderLinks(root, mockBridge, () => ({ docId: 'doc', sessionId: 'tab' }),
      { local: vi.fn(), anchor: vi.fn(), error: vi.fn(), hover })
    root.querySelector('strong')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(hover).toHaveBeenLastCalledWith('target.md#section')
    root.firstElementChild?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(hover).toHaveBeenLastCalledWith('target.md#section')
    root.firstElementChild?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(hover).toHaveBeenLastCalledWith('')
    dispose()
  })
  it('uses host classification, prevents navigation and honors background modifiers', async () => {
    const root = document.createElement('article')
    root.innerHTML = '<a href="target.md">link</a>'
    const local = vi.fn()
    const io = { ...mockBridge, resolveLink: vi.fn(async () => ({ kind: 'localMd' as const, absPath: '/target.md', anchor: '中文' })) }
    const dispose = bindReaderLinks(root, io, () => ({ docId: 'doc', sessionId: 'tab' }), { local, anchor: vi.fn(), error: vi.fn() })
    for (const event of [new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }),
      new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })]) {
      root.firstElementChild?.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    await vi.waitFor(() => expect(local).toHaveBeenCalledTimes(2))
    expect(local).toHaveBeenCalledWith('/target.md', '中文', false)
    dispose()
  })
  it('resolves fixture-relative paths and decodes once while blocking traversal', async () => {
    mockReset()
    const doc = await mockBridge.openDocument('fixtures/links.md')
    expect(await mockBridge.resolveLink(doc.docId, './tabs/a.md#%E4%B8%AD%E6%96%87')).toEqual({ kind: 'localMd', absPath: 'fixtures/tabs/a.md', anchor: '中文' })
    expect(await mockBridge.resolveLink(doc.docId, '../outside.md')).toMatchObject({ kind: 'blocked', reason: 'outside-scope' })
    expect(await mockBridge.resolveLink(doc.docId, '#bad%')).toMatchObject({ kind: 'blocked' })
    mockReset()
  })
})
