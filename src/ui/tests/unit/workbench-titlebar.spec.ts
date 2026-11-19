// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import WorkbenchTitlebar from '../../src/app/WorkbenchTitlebar.vue'

const native = vi.hoisted(() => ({
  available: true,
  minimize: vi.fn(async () => undefined),
  toggleMaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  watchMaximized: vi.fn(() => vi.fn()),
}))
vi.mock('../../src/core/ipc/windowBridge', () => ({ windowBridge: native }))

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); document.body.replaceChildren(); vi.clearAllMocks() })
function mount(extra: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(WorkbenchTitlebar, { title: 'workspace', panel: 'files', hasDocument: true, tabCount: 2, ...extra }) })
  const instance = app.mount(host)
  cleanups.push(() => app.unmount())
  return { host, instance }
}
function control(host: HTMLElement, selector: string) {
  const found = host.querySelector<HTMLButtonElement>(selector)
  if (!found) throw new Error(`Missing control: ${selector}`)
  return found
}
async function click(host: HTMLElement, selector: string) { control(host, selector).click(); await nextTick() }
async function key(target: Element, value: string) { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })); await nextTick() }

describe('workbench titlebar', () => {
  it('moves keyboard navigation to the item under the moving mouse', async () => {
    const { host } = mount()
    await click(host, '[data-testid="menu-file"]')
    const last = control(host, '[role="menuitem"][aria-label="关闭全部"]')
    last.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    await nextTick()
    expect(document.activeElement).toBe(last)
    await key(last, 'ArrowDown')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('打开文件…')
    const disabled = control(host, '[role="menuitem"][aria-label="恢复关闭的文档"]')
    disabled.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('打开文件…')
  })

  it('offers reopen only when a closed path is available and dispatches the real command', async () => {
    const reopen = vi.fn()
    const { host } = mount({ canReopen: true, onReopenClosed: reopen })
    await click(host, '[data-testid="menu-file"]')
    const item = control(host, '[role="menuitem"][aria-label="恢复关闭的文档"]')
    expect(item.disabled).toBe(false)
    expect(item.textContent).toContain('Ctrl+Shift+T')
    item.click()
    await nextTick()
    expect(reopen).toHaveBeenCalledOnce()
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })

  it('shares the titlebar with menus while keeping interactive controls out of drag targets', () => {
    const { host } = mount({ title: '设计说明.md — Markdown 预览' })
    const titlebar = host.querySelector('header.workbench-titlebar')
    const menubar = host.querySelector('[role="menubar"][aria-label="应用菜单"]')
    const title = host.querySelector('[data-testid="window-title"]')
    expect(title?.textContent).toBe('设计说明.md — Markdown 预览')
    expect(titlebar?.contains(title)).toBe(true)
    expect(title?.closest('button, input, [role="button"]')).toBeNull()
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true)
    expect(title?.hasAttribute('data-tauri-drag-region')).toBe(true)
    expect(titlebar?.contains(menubar)).toBe(true)
    expect(menubar?.hasAttribute('data-tauri-drag-region')).toBe(false)
    expect(host.querySelectorAll('[role="menuitem"][data-tauri-drag-region], .window-controls button[data-tauri-drag-region]')).toHaveLength(0)
    expect(titlebar?.querySelectorAll('.window-controls button')).toHaveLength(3)
    expect(host.querySelector('[data-testid="command-center"], input')).toBeNull()
  })

  it('opens real file commands with keyboard navigation and returns focus on Escape', async () => {
    const open = vi.fn()
    const { host } = mount({ onOpenFolder: open })
    const trigger = control(host, '[data-testid="menu-file"]')
    await click(host, '[data-testid="menu-file"]')
    expect(document.activeElement?.textContent).toContain('打开文件…')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('打开文件…')
    await key(document.activeElement as Element, 'ArrowDown')
    expect(document.activeElement?.textContent).toContain('打开文件夹…')
    ;(document.activeElement as HTMLButtonElement).click()
    await nextTick()
    expect(open).toHaveBeenCalledOnce()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await click(host, '[data-testid="menu-file"]')
    await key(document.activeElement as Element, 'Escape')
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes menus on outside click and opens adjacent menus using arrow keys', async () => {
    const { host } = mount()
    await click(host, '[data-testid="menu-file"]')
    await key(document.activeElement as Element, 'ArrowRight')
    expect(control(host, '[data-testid="menu-view"]').getAttribute('aria-expanded')).toBe('true')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(control(host, '[data-testid="menu-view"]').getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps body search in the view menu and leaves appearance controls out of the top chrome', async () => {
    const selectPanel = vi.fn()
    const { host } = mount({ onSelectPanel: selectPanel })
    await click(host, '[data-testid="menu-view"]')
    const commands = [...host.querySelectorAll('[role="menu"] [role="menuitem"]')]
    expect(commands.map((item) => item.getAttribute('aria-label'))).toEqual(['文件', '搜索', '大纲', '侧栏', '刷新当前文档', '增大正文字号', '减小正文字号', '重置正文字号'])
    expect(host.querySelector('select, [aria-label="外观设置"]')).toBeNull()
    await click(host, '[role="menuitem"][aria-label="搜索"]')
    expect(selectPanel).toHaveBeenCalledWith('search')
    expect(control(host, '[data-testid="menu-view"]').getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the newly clicked control focused when dismissing a menu from outside', async () => {
    const { host } = mount()
    const outside = document.createElement('button')
    document.body.append(outside)
    await click(host, '[data-testid="menu-file"]')
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    outside.focus()
    await nextTick()
    expect(control(host, '[data-testid="menu-file"]').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(outside)
  })

  it('hands environment diagnostics to the statusbar after restoring the help trigger focus', async () => {
    let focusAtHandoff: Element | null = null
    const showEnvironment = vi.fn(() => { focusAtHandoff = document.activeElement })
    const { host } = mount({ onShowEnvironment: showEnvironment })
    const trigger = control(host, '[data-testid="menu-help"]')
    await click(host, '[data-testid="menu-help"]')
    await click(host, '[role="menuitem"][aria-label="环境信息"]')
    expect(showEnvironment).toHaveBeenCalledOnce()
    expect(focusAtHandoff).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('[role="dialog"][aria-label="环境信息"]')).toBeNull()
  })

  it('reports window action failures and removes its native subscription on unmount', async () => {
    const report = vi.fn()
    native.minimize.mockRejectedValueOnce(new Error('窗口操作失败'))
    const { host } = mount({ onError: report })
    await click(host, '[aria-label="最小化"]')
    await Promise.resolve()
    expect(report).toHaveBeenCalledWith('窗口操作失败')
    const stop = native.watchMaximized.mock.results.at(-1)?.value
    cleanups.pop()?.()
    expect(stop).toHaveBeenCalledOnce()
  })
})
