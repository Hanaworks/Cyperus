// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Component, createApp, nextTick } from 'vue'
import DocumentTabs from '../../src/app/DocumentTabs.vue'
import ExplorerPanel from '../../src/app/ExplorerPanel.vue'
import SearchPanel from '../../src/app/SearchPanel.vue'
import Sidebar from '../../src/app/Sidebar.vue'
import type { SessionTab } from '../../src/core/documents/session'
import { createMockWorkspaceBridge } from '../../src/core/ipc/workspaceBridge'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
})

function mount(component: Component, props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(component, props)
  const instance = app.mount(host)
  cleanups.push(() => app.unmount())
  return { host, instance }
}

function search(extra: Record<string, unknown> = {}) {
  const mounted = mount(SearchPanel, { query: '正文关键词', count: 3, current: 1, hasDocument: true, ...extra })
  const input = mounted.host.querySelector('input')
  if (!input) throw new Error('Missing document search input')
  return { ...mounted, input }
}

function tab(id: string): SessionTab {
  return { id, meta: null, name: `${id}.md`, path: `D:/docs/${id}.md`, result: null, status: 'ready', error: '', scrollTop: 0, search: { query: '', current: 0 } }
}

describe('navigation details', () => {
  it('announces full-document search progress without reporting zero matches', () => {
    const { host } = search({ count: 0, current: 0, pending: true })
    expect(host.querySelector('[data-testid="search-summary"]')?.textContent).toContain('正在搜索')
    expect(host.textContent).not.toContain('没有找到匹配')
    expect(host.querySelector<HTMLButtonElement>('[aria-label="下一个匹配"]')?.disabled).toBe(true)
  })
  it('selects the retained search query each time search receives focus', () => {
    const { instance, input } = search()
    const panel = instance as unknown as { focus(): void }
    input.setSelectionRange(2, 2)
    panel.focus()
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5])
    input.setSelectionRange(3, 3)
    panel.focus()
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5])
  })

  it('returns Escape focus to the reader without clearing the search query', () => {
    const reader = document.createElement('article')
    reader.tabIndex = -1
    document.body.append(reader)
    const update = vi.fn()
    const { input } = search({ onReturnToReader: () => reader.focus(), 'onUpdate:query': update })
    input.focus()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(document.activeElement).toBe(reader)
    expect(event.defaultPrevented).toBe(true)
    expect(input.value).toBe('正文关键词')
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves result navigation and leaves composing Enter and Escape to the input method', () => {
    const next = vi.fn()
    const previous = vi.fn()
    const returnToReader = vi.fn()
    const { input } = search({ onNext: next, onPrevious: previous, onReturnToReader: returnToReader })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
    expect(next).toHaveBeenCalledOnce()
    expect(previous).toHaveBeenCalledOnce()
    expect(returnToReader).not.toHaveBeenCalled()
  })

  it('explains that the outline needs an open document', () => {
    const { host } = mount(Sidebar, { entries: [], activeId: '', hasDocument: false })
    expect(host.textContent).toContain('打开文档后显示大纲')
    expect(host.querySelectorAll('nav button')).toHaveLength(0)
  })

  it('distinguishes a document with no headings, including callers using the existing props', () => {
    const { host } = mount(Sidebar, { entries: [], activeId: '' })
    expect(host.textContent).toContain('此文档没有标题')
    expect(host.querySelectorAll('nav button')).toHaveLength(0)
  })

  it('focuses the current active tab without selecting another document', async () => {
    const activate = vi.fn()
    const { host, instance } = mount(DocumentTabs, { tabs: [tab('first'), tab('second')], activeId: 'second', onActivate: activate })
    const tabs = instance as unknown as { focusActive(): void }
    expect(tabs.focusActive).toBeTypeOf('function')
    tabs.focusActive()
    await nextTick()
    expect(document.activeElement).toBe(host.querySelector('[data-tab-id="second"]'))
    expect(activate).not.toHaveBeenCalled()
  })

  it('keeps exposed tab focus safe when the last document has been closed', () => {
    const { instance } = mount(DocumentTabs, { tabs: [], activeId: null })
    const tabs = instance as unknown as { focusActive(): void }
    expect(tabs.focusActive).toBeTypeOf('function')
    expect(() => tabs.focusActive()).not.toThrow()
  })

  it('identifies the document owning each tab and editor close control', () => {
    const bridge = createMockWorkspaceBridge([])
    const tabs = [tab('first'), tab('second')]
    const tabstrip = mount(DocumentTabs, { tabs, activeId: 'first' })
    const explorer = mount(ExplorerPanel, { tabs, activeId: 'first', root: null, activePath: '', bridge })
    expect(tabstrip.host.querySelector('[aria-label="关闭 second.md"]')?.closest('[data-session-id]')?.getAttribute('data-session-id')).toBe('second')
    expect(explorer.host.querySelector('[aria-label="从列表关闭 second.md"]')?.closest('[data-session-id]')?.getAttribute('data-session-id')).toBe('second')
  })
})
