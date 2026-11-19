// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import DocumentTabs from '../../src/app/DocumentTabs.vue'
import type { SessionTab } from '../../src/core/documents/session'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function tab(id: string): SessionTab {
  return { id, name: `${id}.md`, path: `D:/docs/${id}.md`, meta: null, result: null,
    status: 'ready', error: '', scrollTop: 0, search: { query: '', current: -1 } }
}

function mount(ids = ['a', 'b', 'c'], activeId = 'a') {
  const host = document.createElement('div')
  document.body.append(host)
  const state = reactive({ tabs: ids.map(tab), activeId })
  const events = { activate: vi.fn(), close: vi.fn(), reorder: vi.fn(), closeOthers: vi.fn(), closeRight: vi.fn(), closeAll: vi.fn() }
  const app = createApp({ render: () => h(DocumentTabs, { ...state, onActivate: events.activate,
    onClose: events.close, onReorder: events.reorder, onCloseOthers: events.closeOthers,
    onCloseRight: events.closeRight, onCloseAll: events.closeAll }) })
  app.mount(host)
  cleanups.push(() => app.unmount())
  return { host, state, events }
}

function element<T extends HTMLElement = HTMLButtonElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing control: ${selector}`)
  return found
}

async function key(target: Element | null, value: string, extra: KeyboardEventInit = {}) {
  if (!target) throw new Error('Missing keyboard target')
  target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }))
  await nextTick()
}

async function context(id: string) {
  element(`[data-tab-id="${id}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 30 }))
  await nextTick()
}

async function sizeTabs(width: number, contentWidth: number) {
  const list = element('[role="tablist"]')
  Object.defineProperties(list, { clientWidth: { configurable: true, value: width }, scrollWidth: { configurable: true, value: contentWidth } })
  window.dispatchEvent(new Event('resize'))
  await nextTick()
}

function drag(target: Element, type: string, clientX: number, dataTransfer = new DataTransfer()) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { clientX: { value: clientX }, dataTransfer: { value: dataTransfer } })
  target.dispatchEvent(event)
  return event
}

function geometry() {
  document.querySelectorAll<HTMLElement>('[data-session-id]').forEach((item, index) => {
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({ left: index * 100, right: (index + 1) * 100, width: 100, top: 0, bottom: 35, height: 35, x: index * 100, y: 0, toJSON: () => ({}) })
  })
}

describe('document tabs', () => {
  it('reorders to either end without selecting the dragged tab or accepting external drops', async () => {
    const { events } = mount()
    geometry()
    const list = element('[role="tablist"]')
    const first = element('[data-session-id="a"]')
    const last = element('[data-session-id="c"]')
    expect(first.getAttribute('draggable')).toBe('true')
    drag(first, 'dragstart', 10)
    expect(drag(last, 'dragover', 295).defaultPrevented).toBe(true)
    await nextTick()
    expect(last.classList.contains('insert-after')).toBe(true)
    drag(last, 'drop', 295)
    expect(events.reorder).toHaveBeenLastCalledWith('a', 2)
    drag(last, 'dragstart', 295)
    drag(first, 'dragover', 1)
    drag(first, 'drop', 1)
    expect(events.reorder).toHaveBeenLastCalledWith('c', 0)
    expect(events.activate).not.toHaveBeenCalled()
    const external = drag(list, 'drop', 200)
    expect(external.defaultPrevented).toBe(false)
    expect(events.reorder).toHaveBeenCalledTimes(2)
  })

  it('does not reorder for a drop at its own slot and clears a cancelled drag indicator', async () => {
    const { events } = mount()
    geometry()
    const first = element('[data-session-id="a"]')
    drag(first, 'dragstart', 10)
    drag(first, 'dragover', 15)
    drag(first, 'drop', 15)
    expect(events.reorder).not.toHaveBeenCalled()
    drag(first, 'dragstart', 10)
    drag(element('[data-session-id="c"]'), 'dragover', 299)
    await nextTick()
    expect(document.querySelector('.insert-after')).not.toBeNull()
    drag(first, 'dragend', 299)
    await nextTick()
    expect(document.querySelector('.insert-before, .insert-after')).toBeNull()
  })

  it.each([
    ['关闭', 'close', ['b']], ['关闭其他', 'closeOthers', ['b']],
    ['关闭右侧', 'closeRight', ['b']], ['关闭全部', 'closeAll', []],
  ] as const)('dispatches %s for the context tab without changing selection when opening', async (label, eventName, args) => {
    const { events } = mount()
    await context('b')
    expect(events.activate).not.toHaveBeenCalled()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭')
    element(`[role="menuitem"][aria-label="${label}"]`).click()
    await nextTick()
    expect(events[eventName]).toHaveBeenCalledExactlyOnceWith(...args)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('disables closing other retained tabs and closing to the right of the final tab', async () => {
    mount(['a', 'b'])
    await context('b')
    expect(element('[role="menuitem"][aria-label="关闭其他"]').disabled).toBe(true)
    expect(element('[role="menuitem"][aria-label="关闭右侧"]').disabled).toBe(true)
    await key(document.activeElement, 'ArrowDown')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭全部')
    await key(document.activeElement, 'Escape')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(element('[data-tab-id="b"]'))
  })

  it('opens context commands with the keyboard and activates them using Enter', async () => {
    const { events } = mount()
    const target = element('[data-tab-id="b"]')
    target.focus()
    await key(target, 'F10', { shiftKey: true })
    await key(document.activeElement, 'End')
    await key(document.activeElement, 'Enter')
    expect(events.closeAll).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('dismisses a menu on outside pointer interaction without stealing focus', async () => {
    mount()
    const outside = document.createElement('button')
    document.body.append(outside)
    await context('b')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    outside.focus()
    await nextTick()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(outside)
  })

  it('shows overflow only when needed, lists all tabs, filters and activates a selection', async () => {
    const { events } = mount()
    await sizeTabs(400, 300)
    expect(document.querySelector('[aria-label="全部标签页"]')).toBeNull()
    await sizeTabs(200, 300)
    element('[aria-label="全部标签页"]').click()
    await nextTick()
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
    expect(element('[role="menuitemradio"][aria-checked="true"]').textContent).toContain('a.md')
    const search = element<HTMLInputElement>('[aria-label="筛选标签页"]')
    search.value = 'B.md'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(1)
    element('[role="menuitemradio"]').click()
    await nextTick()
    expect(events.activate).toHaveBeenCalledExactlyOnceWith('b')
    expect(document.querySelector('[aria-label="筛选标签页"]')).toBeNull()
    expect(document.activeElement).toBe(element('[data-tab-id="b"]'))
  })

  it('allows keyboard access to overflow results and restores its trigger on Escape', async () => {
    const { events } = mount()
    await sizeTabs(200, 300)
    const trigger = element('[aria-label="全部标签页"]')
    trigger.focus()
    await key(trigger, 'ArrowDown')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('筛选标签页')
    await key(document.activeElement, 'ArrowDown')
    await key(document.activeElement, 'End')
    expect(document.activeElement?.textContent).toContain('c.md')
    await key(document.activeElement, 'Enter')
    expect(events.activate).toHaveBeenCalledExactlyOnceWith('c')
    trigger.click()
    await nextTick()
    await key(document.activeElement, 'Escape')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('moves upward from the overflow filter to the last result and handles no matches', async () => {
    const { events } = mount()
    await sizeTabs(200, 300)
    element('[aria-label="全部标签页"]').click()
    await nextTick()
    const search = element<HTMLInputElement>('[aria-label="筛选标签页"]')
    await key(search, 'ArrowUp')
    expect(document.activeElement?.textContent).toContain('c.md')
    search.focus()
    search.value = 'no matching document'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await key(search, 'Enter')
    expect(events.activate).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0)
    await key(search, 'Escape')
    expect(document.querySelector('[aria-label="筛选标签页"]')).toBeNull()
  })

  it('dismisses menus when their target disappears or all tabs fit after resizing', async () => {
    const { state } = mount()
    await context('b')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    state.tabs = state.tabs.filter((item) => item.id !== 'b')
    await nextTick()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await sizeTabs(100, 200)
    element('[aria-label="全部标签页"]').click()
    await nextTick()
    expect(document.querySelector('[aria-label="筛选标签页"]')).not.toBeNull()
    await sizeTabs(400, 200)
    expect(document.querySelector('[aria-label="全部标签页"]')).toBeNull()
    expect(document.querySelector('[aria-label="筛选标签页"]')).toBeNull()
  })

  it('preserves tab navigation, Delete and middle-click close without activating close buttons', async () => {
    const { events } = mount()
    const first = element('[data-tab-id="a"]')
    await key(first, 'End')
    expect(events.activate).toHaveBeenLastCalledWith('c')
    await key(element('[data-tab-id="c"]'), 'Home')
    expect(events.activate).toHaveBeenLastCalledWith('a')
    await key(first, 'ArrowLeft')
    expect(events.activate).toHaveBeenLastCalledWith('c')
    await key(first, 'Delete')
    expect(events.close).toHaveBeenLastCalledWith('a')
    first.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))
    expect(events.close).toHaveBeenCalledTimes(2)
    events.activate.mockClear()
    element('[aria-label="关闭 b.md"]').click()
    expect(events.close).toHaveBeenLastCalledWith('b')
    expect(events.activate).not.toHaveBeenCalled()
  })
})
