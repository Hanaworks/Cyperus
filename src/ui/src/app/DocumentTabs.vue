<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SessionTab } from '../core/documents/session'

const props = defineProps<{ tabs: SessionTab[]; activeId: string | null }>()
const emit = defineEmits<{
  activate: [id: string]; close: [id: string]; open: []
  reorder: [id: string, targetIndex: number]
  closeOthers: [id: string]; closeRight: [id: string]; closeAll: []
}>()
const tablist = ref<HTMLElement | null>(null)
const overflowButton = ref<HTMLButtonElement | null>(null)
const popup = ref<HTMLElement | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)
const hasOverflow = ref(false)
const filter = ref('')
const menu = ref<{ kind: 'context' | 'overflow'; id: string; x: number; y: number } | null>(null)
const draggedId = ref<string | null>(null)
const insertionIndex = ref<number | null>(null)
let returnFocus: HTMLElement | null = null
let resizeObserver: ResizeObserver | undefined

const filteredTabs = computed(() => {
  const query = filter.value.trim().toLocaleLowerCase()
  return props.tabs.filter((tab) => `${tab.name}\n${tab.path}`.toLocaleLowerCase().includes(query))
})
const contextActions = computed(() => {
  const id = menu.value?.id
  const index = props.tabs.findIndex((tab) => tab.id === id)
  return [
    { key: 'close', label: '关闭', disabled: index < 0 },
    { key: 'closeOthers', label: '关闭其他', disabled: !props.tabs.some((tab) => tab.id !== id && tab.id !== props.activeId) },
    { key: 'closeRight', label: '关闭右侧', disabled: index < 0 || index === props.tabs.length - 1 },
    { key: 'closeAll', label: '关闭全部', disabled: !props.tabs.length },
  ] as const
})

function tabButton(id: string): HTMLButtonElement | undefined {
  return Array.from(tablist.value?.querySelectorAll<HTMLButtonElement>('[data-tab-id]') ?? [])
    .find((button) => button.dataset.tabId === id)
}

function focusActive(): void {
  if (props.activeId) tabButton(props.activeId)?.focus()
}

defineExpose({ focusActive })

async function navigate(event: KeyboardEvent, id: string): Promise<void> {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault()
    event.stopPropagation()
    const rect = tabButton(id)?.getBoundingClientRect()
    await showContext(id, rect?.left ?? 0, rect?.bottom ?? 0)
    return
  }
  const index = props.tabs.findIndex((tab) => tab.id === id)
  let target = index
  switch (event.key) {
    case 'ArrowLeft': target = (index - 1 + props.tabs.length) % props.tabs.length; break
    case 'ArrowRight': target = (index + 1) % props.tabs.length; break
    case 'Home': target = 0; break
    case 'End': target = props.tabs.length - 1; break
    case 'Delete': event.preventDefault(); emit('close', id); return
    default: return
  }
  const tab = props.tabs[target]
  if (!tab) return
  event.preventDefault()
  emit('activate', tab.id)
  await nextTick()
  tabButton(tab.id)?.focus()
}

function dismiss(restoreFocus = false): void {
  if (!menu.value) return
  menu.value = null
  if (restoreFocus) returnFocus?.focus()
}

async function positionMenu(): Promise<void> {
  await nextTick()
  if (!menu.value || !popup.value) return
  const rect = popup.value.getBoundingClientRect()
  menu.value.x = Math.max(4, Math.min(menu.value.x, window.innerWidth - rect.width - 4))
  menu.value.y = Math.max(4, Math.min(menu.value.y, window.innerHeight - rect.height - 4))
}

async function showContext(id: string, x: number, y: number): Promise<void> {
  returnFocus = tabButton(id) ?? null
  menu.value = { kind: 'context', id, x, y }
  await nextTick()
  popup.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  void positionMenu()
}

function contextMenu(event: MouseEvent, id: string): void {
  event.preventDefault()
  event.stopPropagation()
  const rect = tabButton(id)?.getBoundingClientRect()
  void showContext(id, event.clientX || rect?.left || 0, event.clientY || rect?.bottom || 0)
}

async function showOverflow(): Promise<void> {
  if (menu.value?.kind === 'overflow') { dismiss(true); return }
  filter.value = ''
  returnFocus = overflowButton.value
  const rect = overflowButton.value?.getBoundingClientRect()
  menu.value = { kind: 'overflow', id: '', x: Math.max(4, (rect?.right ?? 0) - 300), y: rect?.bottom ?? 0 }
  await nextTick()
  filterInput.value?.focus()
  void positionMenu()
}

async function activateFromMenu(id: string): Promise<void> {
  dismiss()
  emit('activate', id)
  await nextTick()
  tabButton(id)?.focus()
}

async function runContext(key: typeof contextActions.value[number]['key']): Promise<void> {
  const id = menu.value?.id
  if (!id || contextActions.value.find((action) => action.key === key)?.disabled) return
  dismiss()
  if (key === 'closeAll') emit('closeAll')
  else if (key === 'close') emit('close', id)
  else if (key === 'closeOthers') emit('closeOthers', id)
  else emit('closeRight', id)
  await nextTick()
  focusActive()
}

function menuKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); dismiss(true); return }
  if (event.key === 'Tab') { dismiss(); return }
  const items = Array.from(popup.value?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])
  const input = event.target === filterInput.value
  if (input && !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  let target: HTMLButtonElement | undefined
  if (event.key === 'ArrowDown') target = items[(index + 1) % items.length]
  else if (event.key === 'ArrowUp') target = index < 0 ? items.at(-1) : items[(index - 1 + items.length) % items.length]
  else if (event.key === 'Home') target = items[0]
  else if (event.key === 'End') target = items.at(-1)
  else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    ;(input ? items[0] : items[index])?.click()
    return
  } else return
  event.preventDefault()
  target?.focus()
}

function focusMenuItem(event: MouseEvent): void {
  const target = event.currentTarget as HTMLButtonElement
  if (!target.disabled) target.focus()
}

function outside(event: Event): void {
  const target = event.target as Node | null
  if (!menu.value || popup.value?.contains(target) || overflowButton.value?.contains(target)) return
  dismiss()
}

function measureOverflow(): void {
  if (!tablist.value) return
  // Include the trigger's space so its appearance cannot make overflow permanent.
  const available = tablist.value.clientWidth + (overflowButton.value?.offsetWidth ?? 0)
  hasOverflow.value = props.tabs.length > 0 && tablist.value.scrollWidth > available + 1
  if (!hasOverflow.value && menu.value?.kind === 'overflow') {
    dismiss()
    focusActive()
  }
}

function observeTabs(): void {
  resizeObserver?.disconnect()
  if (!tablist.value) return
  resizeObserver?.observe(tablist.value)
  for (const child of tablist.value.children) resizeObserver?.observe(child)
  measureOverflow()
}

function dragStart(event: DragEvent, id: string): void {
  dismiss()
  draggedId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-markdown-tab-id', id)
  }
}

function clearDrag(): void { draggedId.value = null; insertionIndex.value = null }

function dragOver(event: DragEvent): void {
  if (!draggedId.value || !props.tabs.some((tab) => tab.id === draggedId.value)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const elements = Array.from(tablist.value?.querySelectorAll<HTMLElement>('[data-session-id]') ?? [])
  const index = elements.findIndex((element) => {
    const rect = element.getBoundingClientRect()
    return event.clientX < rect.left + rect.width / 2
  })
  insertionIndex.value = index < 0 ? props.tabs.length : index
  const rect = tablist.value?.getBoundingClientRect()
  if (tablist.value && rect && rect.width > 0) {
    if (event.clientX < rect.left + 24) tablist.value.scrollLeft -= 24
    else if (event.clientX > rect.right - 24) tablist.value.scrollLeft += 24
  }
}

function drop(event: DragEvent): void {
  const id = draggedId.value
  if (!id) return
  dragOver(event)
  const source = props.tabs.findIndex((tab) => tab.id === id)
  const insertion = insertionIndex.value
  clearDrag()
  if (source < 0 || insertion === null) return
  const target = insertion - (source < insertion ? 1 : 0)
  if (target !== source) emit('reorder', id, target)
}

function dragLeave(event: DragEvent): void {
  if (!tablist.value?.contains(event.relatedTarget as Node | null)) insertionIndex.value = null
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(measureOverflow)
  observeTabs()
  window.addEventListener('resize', measureOverflow)
  document.addEventListener('pointerdown', outside)
  document.addEventListener('focusin', outside)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', measureOverflow)
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('focusin', outside)
})

watch(() => props.tabs.map((tab) => [tab.id, tab.name]), async () => {
  if (menu.value?.kind === 'context' && !props.tabs.some((tab) => tab.id === menu.value?.id)) dismiss()
  if (draggedId.value && !props.tabs.some((tab) => tab.id === draggedId.value)) clearDrag()
  await nextTick()
  observeTabs()
})

watch(() => props.activeId, async (id) => {
  if (!id) return
  await nextTick()
  tabButton(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
</script>

<template>
  <div class="document-tabs">
    <div ref="tablist" class="tab-list" role="tablist" aria-label="已打开文档"
      @dragover="dragOver" @drop="drop" @dragleave="dragLeave">
      <!-- biome-ignore lint/a11y/noStaticElementInteractions: The child tab button provides keyboard access; this wrapper delegates drag and context events. -->
      <div v-for="(tab, index) in tabs" :key="tab.id" class="tab-container" :data-session-id="tab.id"
        :class="{ active: tab.id === activeId, 'insert-before': insertionIndex === index,
          'insert-after': index === tabs.length - 1 && insertionIndex === tabs.length }" role="presentation"
        draggable="true" @dragstart="dragStart($event, tab.id)" @dragend="clearDrag"
        @contextmenu="contextMenu($event, tab.id)">
        <button type="button" class="document-tab" role="tab" :data-tab-id="tab.id"
          :aria-label="tab.name" :aria-selected="tab.id === activeId" :title="tab.path || tab.name"
          :tabindex="tab.id === activeId || (!activeId && index === 0) ? 0 : -1"
          @click="emit('activate', tab.id)" @keydown="navigate($event, tab.id)"
          @mousedown.middle.prevent @auxclick.middle.prevent="emit('close', tab.id)">
          <svg v-if="tab.status === 'loading'" class="tab-icon loading" viewBox="0 0 16 16"
            fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <path d="M14 8a6 6 0 1 1-6-6" />
          </svg>
          <svg v-else-if="tab.status === 'error'" class="tab-icon error" viewBox="0 0 16 16"
            fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <circle cx="8" cy="8" r="6" /><path d="M8 4v5m0 2v1" />
          </svg>
          <svg v-else class="tab-icon" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4M5 11V8l2 2 2-2v3" />
          </svg>
          <span class="tab-name">{{ tab.name }}</span>
        </button>
        <button type="button" class="close-tab" :aria-label="`关闭 ${tab.name}`"
          :title="`关闭 ${tab.name}`" :tabindex="tab.id === activeId ? 0 : -1"
          @click="emit('close', tab.id)" @mousedown.middle.prevent @auxclick.middle.prevent="emit('close', tab.id)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
            stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
      </div>
      <span v-if="!tabs.length" class="empty-tabs">尚未打开文档</span>
    </div>
    <button v-if="hasOverflow" ref="overflowButton" type="button" class="tab-overflow"
      aria-label="全部标签页" :title="`全部标签页 (${tabs.length})`" aria-haspopup="dialog"
      :aria-expanded="menu?.kind === 'overflow'" @click="showOverflow" @keydown.down.prevent="showOverflow">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      <span>{{ tabs.length }}</span>
    </button>
    <button type="button" class="open-tab" aria-label="打开文件" title="打开文件" @click="emit('open')">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
        stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
    </button>
    <Teleport to="body">
      <!-- biome-ignore lint/a11y/noStaticElementInteractions: Vue sets the interactive menu/dialog role dynamically; keyboard handling is shared by both. -->
      <div v-if="menu" ref="popup" class="tab-popup" :class="{ 'overflow-popup': menu.kind === 'overflow' }"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" :role="menu.kind === 'context' ? 'menu' : 'dialog'"
        :aria-label="menu.kind === 'context' ? '标签页操作' : '已打开文档列表'" @keydown.stop="menuKey">
        <template v-if="menu.kind === 'context'">
          <button v-for="action in contextActions" :key="action.key" type="button" role="menuitem"
            class="menu-item" :aria-label="action.label" :disabled="action.disabled" tabindex="-1"
            @click="runContext(action.key)" @mousemove="focusMenuItem">{{ action.label }}</button>
        </template>
        <template v-else>
          <input ref="filterInput" v-model="filter" class="tab-filter" type="search" aria-label="筛选标签页" placeholder="筛选标签页" />
          <div class="overflow-items" role="menu" aria-label="标签页">
            <button v-for="tab in filteredTabs" :key="tab.id" type="button" role="menuitemradio"
              class="menu-item overflow-item" :aria-checked="tab.id === activeId" :title="tab.path || tab.name"
              tabindex="-1" @click="activateFromMenu(tab.id)" @mousemove="focusMenuItem">
              <span class="selection-marker" aria-hidden="true">{{ tab.id === activeId ? '✓' : '' }}</span>
              <span class="overflow-name">{{ tab.name }}<small>{{ tab.path }}</small></span>
            </button>
            <p v-if="!filteredTabs.length" class="no-tabs">没有匹配的标签页</p>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.document-tabs {
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  height: var(--app-tabs-h, 35px);
  border-bottom: 1px solid var(--app-border);
  background: var(--app-sidebar-bg);
  font-size: 13px;
}
.tab-list { display: flex; flex: 1; min-width: 0; padding: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.tab-container {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  min-width: 120px;
  max-width: 240px;
  border: 0;
  border-right: 1px solid var(--app-border);
  border-top: 1px solid transparent;
  border-radius: 0;
  color: color-mix(in srgb, var(--app-fg) 80%, var(--app-fg-muted));
}
.tab-container:hover { background: var(--app-hover, var(--app-bg)); }
.tab-container.active { border-top-color: var(--app-accent); color: var(--app-fg); background: var(--app-canvas-bg); }
.tab-container.active::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 1px; background: var(--app-canvas-bg); content: ''; }
.tab-container.insert-before::before, .tab-container.insert-after::before { position: absolute; z-index: 1; top: 0; bottom: 0; left: 0; width: 2px; background: var(--app-accent); content: ''; pointer-events: none; }
.tab-container.insert-after::before { right: 0; left: auto; }
.document-tab {
  display: flex;
  flex: 1;
  align-items: center;
  align-self: stretch;
  gap: 7px;
  min-width: 0;
  padding: 0 6px 0 10px;
  border: 0;
  border-radius: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.tab-name { min-width: 0; max-width: 170px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tab-icon { flex: 0 0 16px; width: 16px; height: 16px; color: var(--app-fg-muted); }
.tab-container.active .tab-icon { color: var(--app-accent-strong); }
.tab-container .tab-icon.error { color: var(--app-error, var(--app-accent)); }
.tab-icon.loading { animation: tab-spin 1s linear infinite; }
.close-tab, .open-tab {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 3px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.close-tab { margin-right: 6px; opacity: 0; }
.tab-container.active .close-tab, .tab-container:hover .close-tab, .tab-container:focus-within .close-tab { opacity: 1; }
.close-tab svg, .open-tab svg { width: 16px; height: 16px; }
.open-tab { align-self: center; width: 22px; height: 22px; margin: 0 6px; color: var(--app-fg-muted); }
.close-tab:hover, .open-tab:hover { color: var(--app-fg); background: var(--app-hover, var(--app-bg-elevated)); }
.document-tab:focus-visible { outline: 1px solid var(--app-accent); outline-offset: -1px; }
.close-tab:focus-visible, .open-tab:focus-visible { outline: 1px solid var(--app-accent); outline-offset: 0; }
.empty-tabs { align-self: center; padding: 0 12px; color: var(--app-fg-muted); font-size: 12px; }
.tab-overflow { display: flex; flex: 0 0 32px; align-items: center; justify-content: center; gap: 1px; width: 32px; padding: 0; border: 0; color: var(--app-fg-muted); background: transparent; font: inherit; font-size: 10px; cursor: pointer; }
.tab-overflow svg { flex: 0 0 12px; width: 12px; height: 12px; }
.tab-overflow:hover { color: var(--app-fg); background: var(--app-hover); }
.tab-overflow:focus-visible { outline: 1px solid var(--app-accent); outline-offset: -1px; }
.tab-popup { position: fixed; z-index: 80; min-width: 160px; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); overflow-y: auto; padding: 4px 0; color: var(--app-fg); background: var(--app-sidebar-bg); border: 1px solid var(--app-border); box-shadow: 0 2px 4px #0005; font-family: inherit; font-size: 13px; }
.menu-item { display: flex; align-items: center; width: 100%; min-height: 28px; padding: 4px 12px; border: 0; color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer; }
.menu-item:hover:not(:disabled), .menu-item:focus { background: var(--app-hover); outline: 1px solid var(--app-accent); outline-offset: -1px; }
.menu-item:disabled { color: var(--app-fg-muted); opacity: .5; cursor: default; }
.overflow-popup { width: 300px; }
.tab-filter { display: block; width: calc(100% - 16px); margin: 4px 8px 8px; padding: 5px 7px; border: 1px solid var(--app-border); color: var(--app-fg); background: var(--app-bg); font: inherit; }
.tab-filter:focus { outline: 1px solid var(--app-accent); }
.overflow-items { max-height: min(360px, 60vh); overflow-y: auto; }
.selection-marker { flex: 0 0 18px; color: var(--app-accent); }
.overflow-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.overflow-name small { display: block; overflow: hidden; color: var(--app-fg-muted); text-overflow: ellipsis; font-size: 11px; }
.no-tabs { padding: 0 12px; color: var(--app-fg-muted); }
@keyframes tab-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tab-icon.loading { animation: none; } }
@media (pointer: coarse) { .close-tab { opacity: 1; } }
</style>
