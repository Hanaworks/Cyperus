<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { SessionTab } from '../core/documents/session'
import type { FolderEntry, FolderRoot, WorkspaceBridge } from '../core/ipc/workspaceBridge'

const props = withDefaults(defineProps<{
  root: FolderRoot | null
  activePath: string
  bridge: WorkspaceBridge
  tabs?: SessionTab[]
  activeId?: string | null
}>(), { tabs: () => [], activeId: null })
const emit = defineEmits<{ open: [path: string]; chooseFolder: []; activate: [id: string]; close: [id: string] }>()

interface DirectoryState {
  entries: FolderEntry[]
  expanded: boolean
  loading: boolean
  loaded: boolean
  error: string
  truncated: boolean
}
interface EntryRow {
  type: 'entry'
  entry: FolderEntry
  level: number
  parentPath: string
  position: number
  size: number
}
interface NoticeRow {
  type: 'loading' | 'error' | 'empty' | 'truncated'
  path: string
  level: number
  message: string
}
type TreeRow = EntryRow | NoticeRow

const directories = reactive(new Map<string, DirectoryState>())
const tree = ref<HTMLElement | null>(null)
const focusedPath = ref('')
const editorsExpanded = ref(true)
const rootExpanded = ref(true)
let generation = 0

function directory(path: string): DirectoryState {
  let state = directories.get(path)
  if (!state) {
    directories.set(path, { entries: [], expanded: false, loading: false, loaded: false, error: '', truncated: false })
    state = directories.get(path)
  }
  if (!state) throw new Error('目录状态不可用')
  return state
}

async function loadDirectory(path: string, force = false): Promise<void> {
  const root = props.root
  if (!root) return
  const state = directory(path)
  if (state.loading || (state.loaded && !force)) return
  const current = generation
  state.loading = true
  state.error = ''
  try {
    const listing = await props.bridge.listDirectory(root.rootId, path)
    if (current !== generation) return
    state.entries = listing.entries
    state.truncated = listing.truncated
    state.loaded = true
  } catch (cause) {
    if (current !== generation) return
    state.error = typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string'
      ? cause.message : String(cause)
  } finally {
    if (current === generation) state.loading = false
  }
}

watch(() => [props.root?.rootId, props.root?.path, props.bridge] as const, () => {
  generation += 1
  directories.clear()
  focusedPath.value = ''
  if (!props.root) return
  directory(props.root.path).expanded = true
  void loadDirectory(props.root.path)
}, { immediate: true })

onBeforeUnmount(() => { generation += 1 })

const rows = computed<TreeRow[]>(() => {
  const result: TreeRow[] = []
  function append(path: string, level: number): void {
    const state = directories.get(path)
    if (!state) return
    for (const [index, entry] of state.entries.entries()) {
      result.push({ type: 'entry', entry, level, parentPath: path, position: index + 1, size: state.entries.length })
      if (entry.kind === 'directory' && directories.get(entry.path)?.expanded) append(entry.path, level + 1)
    }
    if (state.loading) result.push({ type: 'loading', path, level, message: '正在读取…' })
    else if (state.error) result.push({ type: 'error', path, level, message: state.error })
    else if (state.loaded && !state.entries.length) result.push({ type: 'empty', path, level, message: '文件夹为空' })
    if (state.truncated) result.push({ type: 'truncated', path, level, message: '条目较多，部分内容未显示' })
  }
  if (props.root) append(props.root.path, 1)
  return result
})

const interactiveRows = computed(() => rows.value.filter((row): row is EntryRow => row.type === 'entry' && row.entry.kind !== 'file'))
const rovingPath = computed(() => {
  if (interactiveRows.value.some((row) => row.entry.path === focusedPath.value)) return focusedPath.value
  const active = interactiveRows.value.find((row) => isActive(row.entry.path))
  if (active) return active.entry.path
  return interactiveRows.value[0]?.entry.path ?? ''
})
const refreshing = computed(() => !!props.root && !!directories.get(props.root.path)?.loading)

function isActive(path: string): boolean {
  return path.replace(/\\/g, '/') === props.activePath.replace(/\\/g, '/')
}

function toggle(entry: FolderEntry): void {
  if (entry.kind === 'markdown') { emit('open', entry.path); return }
  if (entry.kind !== 'directory') return
  const state = directory(entry.path)
  state.expanded = !state.expanded
  if (state.expanded) void loadDirectory(entry.path)
}

function entryLabel(entry: FolderEntry): string {
  if (entry.kind === 'directory') return `${directories.get(entry.path)?.expanded ? '折叠' : '展开'} ${entry.name}`
  if (entry.kind === 'markdown') return `打开 ${entry.name}`
  return `${entry.name}，不支持预览`
}

async function refresh(): Promise<void> {
  const root = props.root
  if (!root) return
  const expanded = Array.from(directories.entries()).filter(([path, state]) => path !== root.path && state.expanded)
  await loadDirectory(root.path, true)
  if (props.root?.rootId !== root.rootId) return
  await Promise.all(expanded.map(([path]) => loadDirectory(path, true)))
}

async function focusEntry(path: string): Promise<void> {
  focusedPath.value = path
  await nextTick()
  Array.from(tree.value?.querySelectorAll<HTMLButtonElement>('[data-entry-path]') ?? [])
    .find((button) => button.dataset.entryPath === path)?.focus()
}

function onTreeKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement
  const path = target.closest<HTMLButtonElement>('[data-entry-path]')?.dataset.entryPath
  const index = interactiveRows.value.findIndex((row) => row.entry.path === path)
  const row = interactiveRows.value[index]
  if (!row) return
  let next: EntryRow | undefined
  switch (event.key) {
    case 'ArrowDown': next = interactiveRows.value[Math.min(index + 1, interactiveRows.value.length - 1)]; break
    case 'ArrowUp': next = interactiveRows.value[Math.max(index - 1, 0)]; break
    case 'Home': next = interactiveRows.value[0]; break
    case 'End': next = interactiveRows.value.at(-1); break
    case 'ArrowRight':
      if (row.entry.kind !== 'directory') return
      if (!directories.get(row.entry.path)?.expanded) toggle(row.entry)
      else if (interactiveRows.value[index + 1]?.parentPath === row.entry.path) next = interactiveRows.value[index + 1]
      break
    case 'ArrowLeft':
      if (row.entry.kind === 'directory' && directories.get(row.entry.path)?.expanded) toggle(row.entry)
      else next = interactiveRows.value.find((item) => item.entry.path === row.parentPath)
      break
    default: return
  }
  event.preventDefault()
  if (next) void focusEntry(next.entry.path)
}
</script>

<template>
  <section class="explorer-panel" aria-label="文件">
    <header class="explorer-header">
      <h2>资源管理器</h2>
      <button type="button" class="icon-button" :aria-label="root ? '更换文件夹' : '打开文件夹'"
        :title="root ? '更换文件夹' : '打开文件夹'" @click="emit('chooseFolder')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
          stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12.5v-9h5l1.5 2h6.5v7zM8 8v4M6 10h4" /></svg>
      </button>
      <button type="button" class="icon-button" aria-label="刷新文件树" title="刷新文件树"
        :disabled="!root || refreshing" @click="refresh">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M13 6a5 5 0 1 0 .2 3M13 2v4H9" />
        </svg>
      </button>
    </header>
    <div class="explorer-sections">
    <button type="button" class="section-heading" aria-label="打开的编辑器" :aria-expanded="editorsExpanded"
      aria-controls="open-editors-list" @click="editorsExpanded = !editorsExpanded">
      <svg class="disclosure" :class="{ expanded: editorsExpanded }" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 4 4 4-4 4" />
      </svg>
      <span>打开的编辑器</span>
    </button>
    <section v-show="editorsExpanded" id="open-editors-list" class="open-editors" aria-label="打开的编辑器列表">
      <div v-for="tab in tabs" :key="tab.id" class="open-editor" :class="{ active: tab.id === activeId }" :data-session-id="tab.id">
        <button type="button" class="editor-close" :aria-label="`从列表关闭 ${tab.name}`" :title="`关闭 ${tab.name}`"
          @click="emit('close', tab.id)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
            stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
        <button type="button" class="editor-switch" :aria-label="`切换 ${tab.name}`" :title="tab.path || tab.name"
          :aria-current="tab.id === activeId ? 'page' : undefined" @click="emit('activate', tab.id)">
          <svg class="entry-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
            stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4M5 11V8l2 2 2-2v3" /></svg>
          <span class="entry-name">{{ tab.name }}</span>
        </button>
      </div>
      <p v-if="!tabs.length" class="empty-editors">尚未打开文档</p>
    </section>
    <template v-if="root">
      <button type="button" class="section-heading root-name" :title="root.path" :aria-label="`目录 ${root.name}`"
        :aria-expanded="rootExpanded" aria-controls="workspace-file-tree" @click="rootExpanded = !rootExpanded">
        <svg class="disclosure" :class="{ expanded: rootExpanded }" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
        <span>{{ root.name }}</span>
      </button>
      <div v-show="rootExpanded" id="workspace-file-tree" ref="tree" class="file-tree" role="tree" aria-label="文件浏览器" @keydown="onTreeKeydown">
        <template v-for="row in rows" :key="row.type === 'entry' ? `entry:${row.entry.path}` : `${row.type}:${row.path}`">
          <button v-if="row.type === 'entry'" type="button" role="treeitem" class="tree-entry"
            :class="{ active: row.entry.kind === 'markdown' && isActive(row.entry.path), unsupported: row.entry.kind === 'file' }"
            :style="{ paddingLeft: `${(row.level - 1) * 16 + 8}px` }"
            :aria-label="entryLabel(row.entry)" :aria-level="row.level" :aria-posinset="row.position" :aria-setsize="row.size"
            :aria-expanded="row.entry.kind === 'directory' ? !!directories.get(row.entry.path)?.expanded : undefined"
            :aria-selected="row.entry.kind === 'markdown' ? isActive(row.entry.path) : undefined"
            :aria-current="row.entry.kind === 'markdown' && isActive(row.entry.path) ? 'page' : undefined"
            :disabled="row.entry.kind === 'file'" :tabindex="row.entry.path === rovingPath ? 0 : -1"
            :data-entry-path="row.entry.path" :title="row.entry.kind === 'file' ? `${row.entry.path}（不支持预览）` : row.entry.path"
            @focus="focusedPath = row.entry.path" @click="toggle(row.entry)">
            <svg class="disclosure" :class="{ expanded: directories.get(row.entry.path)?.expanded, hidden: row.entry.kind !== 'directory' }"
              viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
            <svg v-if="row.entry.kind === 'directory'" class="entry-icon folder-icon" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
              <path d="M1.5 12.5v-9h5l1.5 2h6.5v7z" />
            </svg>
            <svg v-else class="entry-icon" :class="{ 'markdown-icon': row.entry.kind === 'markdown' }"
              viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" />
              <path v-if="row.entry.kind === 'markdown'" d="M5 11V8l2 2 2-2v3" />
            </svg>
            <span class="entry-name">{{ row.entry.name }}</span>
          </button>
          <div v-else class="tree-notice" :class="{ 'tree-error': row.type === 'error' }"
            :style="{ paddingLeft: `${(row.level - 1) * 16 + 28}px` }" :role="row.type === 'error' ? 'alert' : 'status'">
            <span>{{ row.message }}</span>
            <button v-if="row.type === 'error'" type="button" class="retry-button"
              :aria-label="`重试读取 ${row.path}`" @click="loadDirectory(row.path, true)">重试</button>
          </div>
        </template>
      </div>
    </template>
    <div v-else class="empty-explorer">
      <p>尚未打开文件夹</p>
      <p class="empty-hint">打开文件夹，浏览其中的 Markdown 文档。</p>
      <button type="button" class="choose-folder" @click="emit('chooseFolder')">打开文件夹</button>
    </div>
    </div>
  </section>
</template>

<style scoped>
.explorer-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; font-size: 13px; }
.explorer-header { display: flex; flex: 0 0 var(--app-tabs-h); align-items: center; gap: 2px; padding: 0 8px 0 20px; }
.explorer-header h2 { flex: 1; min-width: 0; margin: 0; color: var(--app-fg); font-size: 12px; font-weight: 400; }
.explorer-sections { flex: 1; min-height: 0; overflow: auto; }
.icon-button { display: grid; flex: 0 0 auto; place-items: center; width: 22px; height: 22px; padding: 3px; border: 0; border-radius: 3px; color: var(--app-fg-muted); background: transparent; cursor: pointer; }
.icon-button svg { width: 16px; height: 16px; }
.icon-button:hover:enabled { color: var(--app-fg); background: var(--app-hover, var(--app-bg)); }
.icon-button:disabled { opacity: .4; cursor: default; }
.icon-button:focus-visible, .choose-folder:focus-visible, .retry-button:focus-visible, .section-heading:focus-visible, .editor-switch:focus-visible, .editor-close:focus-visible { outline: 1px solid var(--app-accent); outline-offset: -1px; }
.section-heading { display: flex; flex: 0 0 var(--app-sidebar-row-h); align-items: center; gap: 4px; width: 100%; min-width: 0; height: var(--app-sidebar-row-h); padding: 0 8px; border: 0; border-top: 1px solid var(--app-border-soft); border-radius: 0; color: var(--app-fg); background: var(--app-sidebar-bg); font: inherit; font-size: 12px; font-weight: 600; text-align: left; cursor: pointer; }
.section-heading:hover { background: var(--app-hover); }
.section-heading span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.open-editors { flex: 0 0 auto; }
.open-editor { display: flex; align-items: center; height: var(--app-sidebar-row-h); padding: 0 8px 0 4px; }
.open-editor:hover { background: var(--app-hover); }
.open-editor.active { background: var(--app-selection); }
.editor-close { display: grid; flex: 0 0 20px; place-items: center; width: 20px; height: 20px; margin-right: 4px; padding: 2px; border: 0; border-radius: 2px; opacity: 0; color: var(--app-fg); background: transparent; cursor: pointer; }
.editor-close svg { width: 16px; height: 16px; }
.open-editor:hover .editor-close, .open-editor.active .editor-close, .open-editor:focus-within .editor-close { opacity: 1; }
.editor-close:hover { background: var(--app-hover); }
.editor-switch { display: flex; flex: 1; align-items: center; gap: 4px; min-width: 0; height: var(--app-sidebar-row-h); padding: 0; border: 0; color: var(--app-fg); background: transparent; font: inherit; text-align: left; cursor: pointer; }
.empty-editors { margin: 0; padding: 0 20px; color: var(--app-fg-muted); font-size: 12px; line-height: var(--app-sidebar-row-h); }
.file-tree { flex: 0 0 auto; padding: 0 0 8px; }
.tree-entry { display: flex; align-items: center; gap: 4px; width: 100%; height: var(--app-sidebar-row-h); min-height: var(--app-sidebar-row-h); padding-top: 0; padding-right: 8px; padding-bottom: 0; border: 0; border-radius: 0; color: var(--app-fg); background: transparent; font: inherit; line-height: var(--app-sidebar-row-h); text-align: left; cursor: pointer; }
.tree-entry:hover:enabled { background: var(--app-hover, var(--app-bg)); }
.tree-entry.active { color: var(--app-fg); background: var(--app-selection); }
.tree-entry:focus-visible { outline: 1px solid var(--app-accent); outline-offset: -1px; }
.tree-entry.unsupported { color: var(--app-fg-muted); opacity: .55; cursor: default; }
.disclosure { flex: 0 0 16px; width: 16px; height: 16px; color: var(--app-fg-muted); }
.disclosure.expanded { transform: rotate(90deg); }
.disclosure.hidden { visibility: hidden; }
.entry-icon { flex: 0 0 16px; width: 16px; height: 16px; color: var(--app-fg-muted); }
.open-editor.active .entry-icon, .tree-entry.active .entry-icon { color: var(--app-accent-strong); }
.entry-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-notice { padding: 0 8px 0 28px; color: var(--app-fg-muted); font-size: 12px; line-height: var(--app-sidebar-row-h); overflow-wrap: anywhere; }
.tree-error { color: var(--app-error, var(--app-fg-muted)); }
.retry-button { margin: 0 0 0 6px; padding: 0 3px; border: 0; border-radius: 2px; color: var(--app-accent); background: transparent; font: inherit; cursor: pointer; }
.retry-button:hover { text-decoration: underline; }
.empty-explorer { padding: 8px 20px 16px; font-size: 13px; line-height: 22px; }
.empty-explorer p { margin: 6px 0 10px; }
.empty-hint { color: var(--app-fg-muted); }
.choose-folder { width: 100%; min-height: 28px; padding: 2px 8px; border: 1px solid var(--app-input-border); border-radius: 3px; color: var(--app-fg); background: var(--app-input-bg); font: inherit; cursor: pointer; }
.choose-folder:hover { border-color: var(--app-accent); }
</style>
