<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { windowBridge } from '../core/ipc/windowBridge'

type Panel = 'files' | 'search' | 'outline'
type Menu = 'file' | 'view' | 'help'
interface MenuItem { label: string; action: () => void; shortcut?: string; disabled?: boolean; checked?: boolean; separator?: boolean }
const props = defineProps<{
  title: string; panel: Panel | null; hasDocument: boolean; tabCount: number; canReopen?: boolean; recentFiles?: string[]
}>()
const emit = defineEmits<{
  openFiles: []; openFolder: []; closeActive: []; closeAll: []; reopenClosed: []; selectPanel: [panel: Panel]
  toggleSidebar: []; showEnvironment: []; error: [message: string]; refresh: []; openRecent: [path: string]; fontSize: [delta: number]
}>()
const root = ref<HTMLElement | null>(null)
const popup = ref<Menu | null>(null)
const focusedMenu = ref<Menu>('file')
const maximized = ref(false)
const menus: { id: Menu; label: string }[] = [{ id: 'file', label: '文件' }, { id: 'view', label: '查看' }, { id: 'help', label: '帮助' }]
let returnFocus: HTMLElement | null = null
let stopWindowState: (() => void) | undefined

const commands = computed<Record<Menu, MenuItem[]>>(() => ({
  file: [
    { label: '打开文件…', shortcut: 'Ctrl+O', action: () => emit('openFiles') },
    { label: '打开文件夹…', shortcut: 'Ctrl+Shift+O', action: () => emit('openFolder') },
    { label: '恢复关闭的文档', shortcut: 'Ctrl+Shift+T', disabled: !props.canReopen, action: () => emit('reopenClosed') },
    ...(props.recentFiles ?? []).slice(0, 8).map((path, index) => ({ label: `最近：${path}`, separator: index === 0, action: () => emit('openRecent', path) })),
    { label: '关闭文档', shortcut: 'Ctrl+W', disabled: !props.hasDocument, separator: true, action: () => emit('closeActive') },
    { label: '关闭全部', disabled: props.tabCount === 0, action: () => emit('closeAll') },
  ],
  view: [
    { label: '文件', checked: props.panel === 'files', action: () => emit('selectPanel', 'files') },
    { label: '搜索', checked: props.panel === 'search', shortcut: 'Ctrl+F', action: () => emit('selectPanel', 'search') },
    { label: '大纲', checked: props.panel === 'outline', action: () => emit('selectPanel', 'outline') },
    { label: '侧栏', shortcut: 'Ctrl+B', separator: true, action: () => emit('toggleSidebar') },
    { label: '刷新当前文档', shortcut: 'F5', separator: true, disabled: !props.hasDocument, action: () => emit('refresh') },
    { label: '增大正文字号', action: () => emit('fontSize', 1) },
    { label: '减小正文字号', action: () => emit('fontSize', -1) },
    { label: '重置正文字号', action: () => emit('fontSize', 0) },
  ],
  help: [{ label: '环境信息', action: showEnvironment }],
}))

function report(cause: unknown): void {
  emit('error', cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : String(cause))
}
async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> {
  try { await windowBridge[action]() } catch (cause) { report(cause) }
}
function trigger(menu: Menu): HTMLButtonElement | null {
  return root.value?.querySelector<HTMLButtonElement>(`[data-testid="menu-${menu}"]`) ?? null
}
function closePopup(restore = true): void {
  if (!popup.value) return
  popup.value = null
  if (restore) void nextTick().then(() => returnFocus?.focus())
}
function focusPopup(last = false): void {
  void nextTick().then(() => {
    const items = root.value?.querySelectorAll<HTMLElement>('[data-workbench-popup]:not([style*="display: none"]) [role="menuitem"]:not(:disabled)')
    items?.[last ? items.length - 1 : 0]?.focus()
  })
}
function openMenu(menu: Menu, last = false): void {
  popup.value = menu
  focusedMenu.value = menu
  returnFocus = trigger(menu)
  focusPopup(last)
}
function toggleMenu(menu: Menu): void {
  if (popup.value === menu) closePopup()
  else openMenu(menu)
}
function showEnvironment(): void {
  void nextTick().then(() => emit('showEnvironment'))
}
function run(item: MenuItem): void {
  if (item.disabled) return
  closePopup()
  item.action()
}
function focusItem(event: MouseEvent): void {
  const item = event.currentTarget as HTMLButtonElement
  if (!item.disabled && document.activeElement !== item) item.focus({ preventScroll: true })
}
function moveMenu(current: Menu, direction: number, open: boolean): void {
  const index = menus.findIndex((menu) => menu.id === current)
  const next = menus[(index + direction + menus.length) % menus.length]
  if (!next) return
  focusedMenu.value = next.id
  if (open) openMenu(next.id)
  else trigger(next.id)?.focus()
}
function triggerKeys(event: KeyboardEvent, menu: Menu): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(menu, event.key === 'ArrowUp') }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveMenu(menu, event.key === 'ArrowLeft' ? -1 : 1, false) }
  else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const target = menus[event.key === 'Home' ? 0 : menus.length - 1]
    if (target) { focusedMenu.value = target.id; trigger(target.id)?.focus() }
  }
}
function menuKeys(event: KeyboardEvent, menu: Menu): void {
  const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  let next: number | undefined
  if (event.key === 'ArrowDown') next = (index + 1) % items.length
  else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  if (next !== undefined) { event.preventDefault(); items[next]?.focus() }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveMenu(menu, event.key === 'ArrowLeft' ? -1 : 1, true) }
}
function onPointerDown(event: PointerEvent): void {
  if (!popup.value || !(event.target instanceof Element)) return
  if (event.target.closest('[data-workbench-popup], [data-workbench-menu-trigger]')) return
  closePopup(false)
}
function onKeyDown(event: KeyboardEvent): void {
  if (!popup.value) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePopup() }
  else if (event.key === 'Tab') closePopup()
}
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeyDown)
  stopWindowState = windowBridge.watchMaximized((state) => { maximized.value = state }, report)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeyDown)
  stopWindowState?.()
})
</script>

<template>
  <div ref="root" class="workbench-chrome">
    <header class="workbench-titlebar" data-tauri-drag-region>
      <div class="titlebar-start" data-tauri-drag-region>
        <span class="app-icon" aria-hidden="true" data-tauri-drag-region><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="1" /><path d="M5 15V9l3 3 3-3v6m5-6v6m-2-2 2 2 2-2" /></svg></span>
        <div class="workbench-menubar" role="menubar" aria-label="应用菜单">
          <div v-for="menu in menus" :key="menu.id" class="menu-anchor">
            <button type="button" :data-testid="`menu-${menu.id}`" data-workbench-menu-trigger role="menuitem" aria-haspopup="menu"
              :aria-expanded="popup === menu.id" :aria-controls="`workbench-menu-${menu.id}`" :tabindex="focusedMenu === menu.id ? 0 : -1"
              class="menu-trigger" :class="{ 'is-open': popup === menu.id }" @click="toggleMenu(menu.id)" @keydown="triggerKeys($event, menu.id)"
              @mouseenter="popup && openMenu(menu.id)">{{ menu.label }}</button>
            <div v-if="popup === menu.id" :id="`workbench-menu-${menu.id}`" class="command-menu" role="menu" :aria-label="menu.label" data-workbench-popup @keydown="menuKeys($event, menu.id)">
              <template v-for="item in commands[menu.id]" :key="item.label">
                <hr v-if="item.separator" class="menu-separator" />
                <button type="button" role="menuitem" :aria-label="item.label" tabindex="-1" :disabled="item.disabled" @mousemove="focusItem" @click="run(item)">
                  <span class="menu-check" aria-hidden="true">{{ item.checked ? '✓' : '' }}</span><span>{{ item.label }}</span><span v-if="item.shortcut" class="menu-shortcut">{{ item.shortcut }}</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
      <span class="window-title" data-testid="window-title" data-tauri-drag-region>{{ title || 'Cyperus' }}</span>
      <div class="titlebar-end" data-tauri-drag-region>
        <fieldset class="window-controls" aria-label="窗口控制">
          <button type="button" aria-label="最小化" :disabled="!windowBridge.available" :title="windowBridge.available ? '最小化' : '窗口控制仅在桌面应用中可用'" @click="windowAction('minimize')"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" /></svg></button>
          <button type="button" :aria-label="maximized ? '还原' : '最大化'" :disabled="!windowBridge.available" :title="windowBridge.available ? (maximized ? '还原' : '最大化') : '窗口控制仅在桌面应用中可用'" @click="windowAction('toggleMaximize')"><svg viewBox="0 0 12 12" aria-hidden="true"><path v-if="maximized" d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7z" /><path v-else d="M1.5 1.5h9v9h-9z" /></svg></button>
          <button type="button" class="window-close" aria-label="关闭窗口" :disabled="!windowBridge.available" :title="windowBridge.available ? '关闭窗口' : '窗口控制仅在桌面应用中可用'" @click="windowAction('close')"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9" /></svg></button>
        </fieldset>
      </div>
    </header>
  </div>
</template>

<style scoped>
.workbench-chrome { position: relative; z-index: 30; width: 100%; min-width: 0; color: var(--app-fg); background: var(--app-bg-elevated); font-size: 13px; user-select: none; }
.workbench-titlebar { display: grid; grid-template-columns: minmax(170px, 1fr) minmax(0, 2fr) minmax(170px, 1fr); width: 100%; height: var(--app-titlebar-h, 30px); min-height: var(--app-titlebar-h, 30px); box-sizing: border-box; border-bottom: 1px solid var(--app-border); }
.titlebar-start, .titlebar-end { display: flex; align-items: center; min-width: 0; height: 100%; }
.titlebar-end { justify-content: flex-end; }
.app-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 100%; flex: none; color: var(--app-accent); }
.app-icon svg { width: 19px; height: 19px; pointer-events: none; }
.window-title { align-self: center; min-width: 0; padding: 0 8px; overflow: hidden; color: var(--app-fg-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.workbench-menubar { display: flex; flex: none; align-items: stretch; height: 100%; }
.menu-anchor { position: relative; height: 100%; }
.workbench-chrome button { font: inherit; color: inherit; border: 0; box-shadow: none; cursor: pointer; }
.menu-trigger { height: 100%; margin: 0; padding: 0 9px; background: transparent; border-radius: 0; white-space: nowrap; }
.menu-trigger:hover, .menu-trigger.is-open { background: color-mix(in srgb, var(--app-fg) 10%, transparent); }
.window-controls { display: flex; height: 100%; min-width: 0; margin: 0; padding: 0; border: 0; }
.window-controls button { display: grid; place-items: center; width: 46px; height: 100%; padding: 0; border-radius: 0; background: transparent; }
.window-controls button:hover:enabled { background: color-mix(in srgb, var(--app-fg) 10%, transparent); }
.window-controls .window-close:hover:enabled { background: #c42b1c; color: #fff; }
.window-controls button:disabled { cursor: default; opacity: .65; }
.window-controls svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1; }
.command-menu { position: absolute; z-index: 60; top: calc(100% + 1px); left: 0; width: max-content; min-width: 260px; padding: 4px 0; color: var(--app-fg); background: var(--app-sidebar-bg); border: 1px solid var(--app-border); border-radius: 0; box-shadow: 0 2px 4px #0005; }
.command-menu button { display: flex; align-items: center; gap: 6px; width: 100%; height: 26px; padding: 0 12px 0 8px; text-align: left; background: transparent; border-radius: 0; white-space: nowrap; }
.command-menu button:focus:enabled { color: #fff; background: var(--app-menu-selection); outline: none; }
.command-menu button:disabled { opacity: .45; cursor: default; }
.menu-check { width: 14px; flex: none; }
.menu-shortcut { margin-left: auto; padding-left: 28px; font-size: 12px; opacity: .8; }
.menu-separator { height: 0; margin: 4px 10px; border: 0; border-top: 1px solid var(--app-border); }
.workbench-chrome button:focus-visible { outline: 1px solid var(--app-accent); outline-offset: -1px; }
</style>
