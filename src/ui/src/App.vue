<script setup lang="ts">
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import ActivityBar from './app/ActivityBar.vue'
import DocumentTabs from './app/DocumentTabs.vue'
import ExplorerPanel from './app/ExplorerPanel.vue'
import SearchPanel from './app/SearchPanel.vue'
import Sidebar from './app/Sidebar.vue'
import WorkbenchStatusbar from './app/WorkbenchStatusbar.vue'
import WorkbenchTitlebar from './app/WorkbenchTitlebar.vue'
import type { M0Hooks, OpenMetrics } from './bench/protocol'
import { IncomingFiles } from './core/documents/incomingFiles'
import { DocumentSession, type SessionTab } from './core/documents/session'
import { normalizeWorkspaceState, type ReadingAnchor, type WorkspaceState, WorkspaceWriter } from './core/documents/workspaceState'
import type { AppErrorPayload, DocChangedPayload, DocGonePayload, EnvInfo, OpenFilesPayload } from './core/ipc'
import { bridge, isMock } from './core/ipc'
import { onHostEvent } from './core/ipc/events'
import { mockAvailableFixtures } from './core/ipc/mockBridge'
import { stateBridge } from './core/ipc/stateBridge'
import { type FolderRoot, workspaceBridge } from './core/ipc/workspaceBridge'
import { ParserClient } from './core/render/client'
import { disposeSegmentStore } from './core/render/segmentStore'
import type { AppTheme, MarkdownTheme } from './core/theme/apply'
import { applyAppTheme } from './core/theme/apply'
import ReaderView from './reader/ReaderView.vue'
import type { SearchSummary } from './reader/search'

type Panel = 'files' | 'search' | 'outline'
const env = ref<EnvInfo | null>(null)
const tabs = shallowRef<SessionTab[]>([])
const canReopen = ref(false)
const active = shallowRef<SessionTab | null>(null)
const root = shallowRef<FolderRoot | null>(null)
const result = computed(() => active.value?.result ?? null)
const error = ref('')
const appTheme = ref<AppTheme>('light')
const markdownTheme = ref<MarkdownTheme>('light')
const panel = ref<Panel | null>('files')
const sidebarWidth = ref(240)
const fontSize = ref(15)
const linkTarget = ref('')
const recentFiles = ref<string[]>([])
const activeId = ref('')
const query = computed({
  get: () => active.value?.search.query ?? '',
  set: (value: string) => { if (active.value) session.setSearch(active.value.id, value) },
})
const matches = ref<SearchSummary>({ count: 0, current: 0 })
const selectedFixture = ref('basic.md')
const fixtures = isMock ? mockAvailableFixtures() : []
const fileInput = ref<HTMLInputElement | null>(null)
const reader = ref<InstanceType<typeof ReaderView> | null>(null)
const searchPanel = ref<InstanceType<typeof SearchPanel> | null>(null)
const documentTabs = ref<InstanceType<typeof DocumentTabs> | null>(null)
const welcomeOpen = ref<HTMLButtonElement | null>(null)
const statusbar = ref<InstanceType<typeof WorkbenchStatusbar> | null>(null)
const sidebarMaximum = ref(Math.max(180, Math.min(480, window.innerWidth - 340)))
const breadcrumbParts = computed(() => {
  const current = active.value
  if (!current) return []
  const path = current.path.replace(/\\/g, '/')
  const folder = root.value?.path.replace(/\\/g, '/').replace(/\/$/, '')
  if (folder && path.toLowerCase().startsWith(folder.toLowerCase() + '/')) {
    return [root.value?.name ?? '', ...path.slice(folder.length + 1).split('/')]
  }
  const directory = current.meta?.dir.replace(/\\/g, '/').split('/').at(-1)
  return directory ? [directory, current.name] : [current.name]
})
let parser: ParserClient | undefined
let parseCount = 0
let folderGeneration = 0
let unlistenDrop: (() => void) | undefined
let endResize: (() => void) | undefined
const unlistenHost: (() => void)[] = []
let stopClose: (() => void) | undefined
let persistEnabled = false
let disposed = false

const session = new DocumentSession(bridge, async (text, generation, docId) => {
  parser ??= new ParserClient()
  const parsed = await parser.parse(text, generation, docId)
  parseCount += 1
  return parsed
}, () => {
  tabs.value = [...session.tabs]
  active.value = session.active ? { ...session.active } : null
  canReopen.value = session.canReopen
  saveSoon()
}, { cancelParse: (id) => parser?.cancel(id) })
const writer = new WorkspaceWriter(stateBridge.save, (cause) => { error.value = `无法保存阅读状态：${message(cause)}` })
const incoming = new IncomingFiles(openPaths, (cause) => { error.value = message(cause) })
function snapshot(): WorkspaceState {
  return normalizeWorkspaceState({ schemaVersion: 1, appTheme: appTheme.value, markdownTheme: markdownTheme.value,
    sidebarWidth: sidebarWidth.value, fontSize: fontSize.value, panel: panel.value, rootPath: root.value?.path ?? '',
    tabs: session.tabs.filter((tab) => tab.path).map((tab) => ({ path: tab.path, scrollTop: tab.scrollTop, search: { ...tab.search }, anchor: tab.anchor })),
    activePath: session.active?.path ?? '', recentFiles: recentFiles.value })
}
function saveSoon(): void { if (persistEnabled && !disposed) writer.schedule(snapshot()) }
watch([appTheme, markdownTheme, panel, sidebarWidth, fontSize, root, recentFiles], saveSoon)
watch(() => active.value?.status === 'ready' ? active.value.path : '', (path) => {
  if (path) recentFiles.value = [path, ...recentFiles.value.filter((item) => item !== path)].slice(0, 20)
})
watch(appTheme, applyAppTheme, { immediate: true })
watch(() => active.value?.id, () => { activeId.value = ''; linkTarget.value = ''; matches.value = { count: 0, current: 0 } })

function message(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'message' in cause) return String(cause.message)
  return String(cause)
}
function assetUrl(path: string): string {
  return isMock ? '/__fixtures/' + path.replace(/^\.\//, '').split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/') : convertFileSrc(path)
}
function rememberPosition(): void {
  const position = reader.value?.getPosition()
  if (active.value?.status === 'ready' && position?.sessionId === active.value.id) {
    session.setPosition(active.value.id, position.scrollTop)
    session.setReadingAnchor(active.value.id, position.anchor)
  }
}
function onMatches(summary: SearchSummary, sessionId: string, searchQuery: string): void {
  if (active.value?.status !== 'ready' || sessionId !== active.value.id || searchQuery !== query.value || panel.value !== 'search') return
  matches.value = summary
  if (summary.pending) return
  session.setSearch(sessionId, searchQuery, summary.current)
}
function onPosition(top: number, sessionId: string): void {
  if (active.value?.status === 'ready' && sessionId === active.value.id) session.setPosition(sessionId, top)
}
function onAnchor(anchor: ReadingAnchor | undefined, sessionId: string): void {
  if (active.value?.status === 'ready' && sessionId === active.value.id) session.setReadingAnchor(sessionId, anchor)
}
async function painted(): Promise<void> {
  await nextTick()
  await reader.value?.whenReady()
}
async function onReaderReady(): Promise<void> {
  const tab = session.active
  if (!tab || tab.pendingAnchor === undefined) return
  reader.value?.navigate(tab.pendingAnchor)
  session.consumeAnchor(tab.id)
}
async function followLink(path: string, anchor: string | undefined, select: boolean): Promise<void> {
  rememberPosition()
  error.value = ''
  try { await session.openLinked(path, anchor, select); await painted(); await onReaderReady() }
  catch (cause) { error.value = message(cause) }
}
async function refresh(): Promise<void> {
  rememberPosition()
  error.value = ''
  await session.refresh()
  await painted()
}
async function closeGroup(kind: 'others' | 'right', id: string): Promise<void> {
  rememberPosition()
  try { if (kind === 'others') await session.closeOthers(id); else await session.closeRight(id) }
  catch (cause) { error.value = message(cause) }
}
async function openPath(path: string): Promise<boolean> {
  rememberPosition()
  error.value = ''
  try { const opened = await session.open(path); await painted(); return opened }
  catch (cause) { error.value = message(cause); return false }
}
async function openPaths(paths: string[]): Promise<void> {
  if (!paths.length) return
  rememberPosition()
  error.value = ''
  try { await session.openMany(paths); await painted() }
  catch (cause) { error.value = message(cause) }
}
function activate(id: string): void {
  if (id === active.value?.id) return
  rememberPosition()
  error.value = ''
  session.activate(id)
}
async function closeTab(id: string): Promise<void> {
  const focused = document.activeElement
  const restoreFocus = id === session.activeId || (focused instanceof Element && focused.closest('[data-session-id]')?.getAttribute('data-session-id') === id)
  rememberPosition()
  const closing = session.close(id)
  // Restore after the removed controls leave the DOM, without waiting on host I/O.
  if (restoreFocus) void nextTick().then(() => {
    if (session.activeId) documentTabs.value?.focusActive?.()
    else welcomeOpen.value?.focus()
  })
  try { await closing } catch (cause) { error.value = message(cause) }
}
function dismissError(): void {
  if (error.value) error.value = ''
  else if (active.value?.error) void closeTab(active.value.id)
}
async function close(): Promise<void> { rememberPosition(); await session.closeAll(); await painted(); welcomeOpen.value?.focus() }
async function reopenClosed(): Promise<void> {
  rememberPosition()
  error.value = ''
  try { await session.reopenLastClosed(); await painted() }
  catch (cause) { error.value = message(cause) }
}
async function openText(text: string, name: string): Promise<OpenMetrics> {
  const start = performance.now()
  const tab = await session.openText(text, name)
  await painted()
  const parsed = tab.result
  if (!parsed) throw new Error(tab.error || '文档解析未完成')
  performance.mark('reader:first-paint')
  return { parseMs: parsed.parseMs, htmlBytes: parsed.htmlBytes, mermaidCount: parsed.mermaidCount,
    hasRawHtml: parsed.hasRawHtml, firstPaintMs: performance.now() - start,
    fullRenderMs: parsed.segments?.length ? null : performance.now() - start }
}
async function chooseFile(): Promise<void> {
  if (isMock) { fileInput.value?.click(); return }
  try { await openPaths(await workspaceBridge.selectFiles()) } catch (cause) { error.value = message(cause) }
}
async function chooseFolder(): Promise<void> {
  const generation = ++folderGeneration
  try {
    const path = await workspaceBridge.selectFolder()
    if (!path || generation !== folderGeneration) return
    const folder = await workspaceBridge.openFolder(path)
    if (generation !== folderGeneration) { await workspaceBridge.closeFolder(folder.rootId); return }
    const previous = root.value
    root.value = folder
    panel.value = 'files'
    error.value = ''
    if (previous) await workspaceBridge.closeFolder(previous.rootId)
  } catch (cause) { if (generation === folderGeneration) error.value = message(cause) }
}
async function restoreWorkspace(startup: string[]): Promise<void> {
  let state = normalizeWorkspaceState(null)
  try { state = normalizeWorkspaceState(await stateBridge.load()) }
  catch (cause) { error.value = `读取设置失败，已使用默认设置：${message(cause)}` }
  appTheme.value = state.appTheme
  markdownTheme.value = state.markdownTheme
  fontSize.value = state.fontSize
  setSidebarWidth(state.sidebarWidth)
  panel.value = state.panel
  recentFiles.value = state.recentFiles
  if (startup.length) await openPaths(startup)
  else {
    if (state.rootPath) {
      try { root.value = await workspaceBridge.openFolder(state.rootPath) }
      catch { error.value = '上次浏览的文件夹不可用，请重新选择。' }
    }
    const failures = await session.restore(state.tabs, state.activePath)
    if (failures.length) error.value = `部分文档未能恢复：${failures.join('；')}`
    await painted()
  }
  persistEnabled = true
  saveSoon()
}
function beforeUnload(): void {
  if (!persistEnabled) return
  rememberPosition()
  if (isMock) void stateBridge.save(snapshot())
  else { saveSoon(); void writer.flush() }
}
function onWindowFocus(): void {
  if (!persistEnabled || !session.active?.meta) return
  const id = session.active.id
  const docId = session.active.meta.docId
  void bridge.readDocumentMeta(docId).then((meta) => {
    if (disposed) return
    if (meta.version > (session.active?.id === id ? session.active.meta?.version ?? 0 : 0)) session.changed(docId, meta.version)
  }).catch(() => { if (session.activeId === id) void refresh() })
}
async function readPickedFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  let firstId: string | undefined
  let lastId: string | undefined
  for (const file of files) {
    try {
      await openText(await file.text(), file.name)
      lastId = session.activeId ?? undefined
      firstId ??= lastId
    } catch (cause) { error.value = message(cause) }
  }
  if (firstId && session.activeId === lastId) activate(firstId)
  input.value = ''
}
async function selectPanel(selected: Panel): Promise<void> {
  panel.value = panel.value === selected ? null : selected
  if (panel.value === 'search') { await nextTick(); searchPanel.value?.focus() }
}
async function focusSearch(): Promise<void> {
  panel.value = 'search'
  await nextTick()
  searchPanel.value?.focus()
}
function revealPanel(selected: Panel): void {
  if (selected === 'search') void focusSearch()
  else panel.value = selected
}
function setSidebarWidth(width: number): void {
  sidebarMaximum.value = Math.max(180, Math.min(480, window.innerWidth - 340))
  sidebarWidth.value = Math.max(180, Math.min(sidebarMaximum.value, width))
}
function onWindowResize(): void { setSidebarWidth(sidebarWidth.value) }
function resizeSidebar(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  endResize?.()
  const start = event.clientX
  const width = sidebarWidth.value
  const move = (moveEvent: PointerEvent) => { setSidebarWidth(width + moveEvent.clientX - start) }
  const finish = () => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', finish)
    document.removeEventListener('pointercancel', finish)
    document.documentElement.classList.remove('resizing-sidebar')
    endResize = undefined
  }
  document.documentElement.classList.add('resizing-sidebar')
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', finish, { once: true })
  document.addEventListener('pointercancel', finish, { once: true })
  endResize = finish
}
function resizeByKey(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  setSidebarWidth(sidebarWidth.value + (event.key === 'ArrowLeft' ? -16 : 16))
}
function cycleTab(direction: number): void {
  const index = tabs.value.findIndex((tab) => tab.id === active.value?.id)
  const target = tabs.value[(index + direction + tabs.value.length) % tabs.value.length]
  if (target) activate(target.id)
}
function onShortcut(event: KeyboardEvent): void {
  if (event.key === 'F5') { event.preventDefault(); void refresh(); return }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  const commands: Record<string, () => void> = {
    o: () => { void chooseFile() }, 'shift+o': () => { void chooseFolder() },
    w: () => { if (active.value) void closeTab(active.value.id) },
    'shift+t': () => { void reopenClosed() },
    f: () => { void focusSearch() },
    b: () => { panel.value = panel.value ? null : 'files' },
    'shift+e': () => { panel.value = 'files' },
    tab: () => cycleTab(1), 'shift+tab': () => cycleTab(-1),
    pagedown: () => cycleTab(1), pageup: () => cycleTab(-1),
  }
  const command = commands[(event.shiftKey ? 'shift+' : '') + key]
  if (command) { event.preventDefault(); command(); return }
  if (/^[1-9]$/.test(key) && !event.shiftKey) {
    event.preventDefault()
    const target = tabs.value[key === '9' ? tabs.value.length - 1 : Number(key) - 1]
    if (target) activate(target.id)
  }
}

const hooks: M0Hooks = {
  async openText(text, name) { await close(); return openText(text, name) },
  close, renderAll: async () => { await painted(); return await reader.value?.renderAll()
    ?? { visitedSegments: 0, totalSegments: 0, graphs: { done: 0, error: 0, pending: 0 }, cancelled: false } },
  stats: () => ({ parseCount, parseMs: result.value?.parseMs ?? 0, cache: session.cacheStats, segments: result.value?.segments?.length ?? 0 }),
}

// Only called in the explicitly enabled native report mode; no production UI hooks.
async function verifyWorkspace(fixtureRoot: string): Promise<Record<string, unknown>> {
  await close()
  const folder = await workspaceBridge.openFolder(fixtureRoot)
  const previous = root.value
  root.value = folder
  if (previous) await workspaceBridge.closeFolder(previous.rootId)
  const listing = await workspaceBridge.listDirectory(folder.rootId, folder.path)
  const directory = listing.entries.find((entry) => entry.name === 'tabs' && entry.kind === 'directory')
  const basic = listing.entries.find((entry) => entry.name === 'basic.md')
  if (!directory || !basic) throw new Error('文件树缺少预期样本')
  const children = await workspaceBridge.listDirectory(folder.rootId, directory.path)
  const other = children.entries.find((entry) => entry.name === 'a.md')
  if (!other) throw new Error('子目录未能读取')
  await openPaths([basic.path, other.path])
  const first = session.tabs.find((tab) => tab.path === basic.path)
  const second = session.tabs.find((tab) => tab.path === other.path)
  if (!first || !second || session.tabs.length !== 2 || session.activeId !== first.id) throw new Error('多文件标签状态错误')
  const count = parseCount
  const scrollElement = document.querySelector<HTMLElement>('.reader-scroll')
  if (scrollElement) scrollElement.scrollTop = 700
  rememberPosition()
  const position = first.scrollTop
  activate(second.id)
  await painted()
  activate(first.id)
  await painted()
  const restored = reader.value?.getScrollTop() ?? -1
  await openPath(basic.path)
  const cacheDidNotParse = count === parseCount
  const deduplicated = session.tabs.length === 2
  panel.value = 'search'
  query.value = 'CommonMark'
  await nextTick()
  const searchCount = matches.value.count
  activate(second.id)
  await painted()
  const secondSearchInitiallyEmpty = query.value === ''
  query.value = '文档'
  await nextTick()
  activate(first.id)
  await painted()
  const independentSearch = secondSearchInitiallyEmpty && query.value === 'CommonMark'
    && matches.value.current === 1 && second.search.query === '文档'
  if (scrollElement) scrollElement.scrollTop = 700
  rememberPosition()
  await closeTab(first.id)
  await painted()
  await reopenClosed()
  const reopenedPosition = reader.value?.getScrollTop() ?? -1
  const reopenedState = session.active?.path === basic.path && session.tabs[0]?.path === basic.path
    && query.value === 'CommonMark' && matches.value.current === 1 && Math.abs(reopenedPosition - 700) <= 1
  query.value = ''
  panel.value = 'files'
  let outsideRejected = false
  try { await workspaceBridge.listDirectory(folder.rootId, folder.path + '/../') }
  catch { outsideRejected = true }
  const observed = { root: folder.path, rootEntries: listing.entries.length, childEntries: children.entries.length,
    tabs: session.tabs.length, cacheDidNotParse, deduplicated, searchCount, position, restored, outsideRejected,
    independentSearch, reopenedState, reopenedPosition }
  if (!cacheDidNotParse || !deduplicated || !outsideRejected || searchCount <= 0 || Math.abs(restored - position) > 1 || position <= 0
    || !independentSearch || !reopenedState) throw new Error('工作台功能复验失败: ' + JSON.stringify(observed))
  const { verifyReaderHost } = await import('./bench/readerHostProbe')
  return { ...observed, readerHost: await verifyReaderHost(fixtureRoot, session, openPath) }
}
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('keydown', onShortcut)
  performance.mark('app:start')
  if (import.meta.env.DEV || import.meta.env.VITE_M0_BENCH === '1') window.__M0__ = hooks
  try {
    for (const stop of await Promise.all([
      onHostEvent<DocChangedPayload>('doc:changed', (payload) => { rememberPosition(); session.changed(payload.docId, payload.version, payload.kind === 'remove') }),
      onHostEvent<DocGonePayload>('doc:gone', (payload) => { rememberPosition(); session.changed(payload.docId, payload.version, true) }),
      onHostEvent<AppErrorPayload>('app:error', (payload) => { error.value = payload.message }),
      onHostEvent<OpenFilesPayload>('app:open-files', (payload) => { incoming.receive(payload.paths) }),
    ])) { if (disposed) stop(); else unlistenHost.push(stop) }
    env.value = await bridge.getEnvInfo()
    if (!isMock) {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      unlistenDrop = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') void openPaths(event.payload.paths.filter((path) => /\.(md|markdown|mdown|mkd)$/i.test(path)))
      })
      const config = await invoke<{ fixtureRoot: string; reportPath: string } | null>('get_m0_config')
      if (config) {
        const { runNativeProbe } = await import('./bench/nativeProbe')
        await runNativeProbe(config, hooks, openPath, () => verifyWorkspace(config.fixtureRoot))
      } else {
        await restoreWorkspace(await bridge.getStartupPaths())
        const currentWindow = getCurrentWebviewWindow()
        let closing = false
        let savingClose = false
        stopClose = await currentWindow.onCloseRequested(async (event) => {
          if (closing) return
          event.preventDefault()
          if (savingClose) return
          savingClose = true
          rememberPosition(); saveSoon(); await writer.flush()
          persistEnabled = false
          await session.closeAll().catch(() => undefined)
          await disposeSegmentStore().catch(() => undefined)
          closing = true
          await currentWindow.close()
        })
      }
    } else await restoreWorkspace(await bridge.getStartupPaths())
    await incoming.start()
    if (!isMock) {
      const config = await invoke<import('./bench/m1Probe').M1Config | null>('get_m1_config')
      if (config) {
        const { runM1Probe } = await import('./bench/m1Probe')
        await runM1Probe(config, { session, snapshot, open: openPath, activate, painted,
          renderAll: hooks.renderAll,
          stats: hooks.stats,
          stageCloseState: async () => { appTheme.value = 'light'; await nextTick() },
          flush: async () => { rememberPosition(); saveSoon(); await writer.flush() },
          seed: async (paths, folder) => {
            await openPaths(paths)
            const previous = root.value
            root.value = await workspaceBridge.openFolder(folder)
            if (previous) await workspaceBridge.closeFolder(previous.rootId)
            appTheme.value = 'dark'; markdownTheme.value = 'paper'; fontSize.value = 17
            setSidebarWidth(277); panel.value = 'search'; query.value = 'Markdown'
            await painted()
            const scroller = document.querySelector<HTMLElement>('.reader-scroll')
            if (scroller) scroller.scrollTop = 420
            rememberPosition()
          },
        })
      }
    }
  } catch (cause) { error.value = message(cause) }
})
onBeforeUnmount(() => {
  beforeUnload()
  disposed = true
  incoming.dispose()
  writer.dispose()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('focus', onWindowFocus)
  folderGeneration += 1
  document.removeEventListener('keydown', onShortcut)
  endResize?.()
  unlistenDrop?.()
  stopClose?.()
  for (const stop of unlistenHost) stop()
  void session.closeAll().finally(disposeSegmentStore).catch(() => undefined)
  if (root.value) void workspaceBridge.closeFolder(root.value.rootId).catch(() => undefined)
  parser?.dispose()
  delete window.__M0__
})
</script>

<template>
  <div class="app-shell">
    <WorkbenchTitlebar :title="active ? `${active.name} — Cyperus` : 'Cyperus'"
      :panel="panel" :has-document="!!active" :tab-count="tabs.length" :can-reopen="canReopen" :recent-files="recentFiles"
      @open-files="chooseFile" @open-folder="chooseFolder" @close-active="active && closeTab(active.id)" @close-all="close"
      @reopen-closed="reopenClosed"
      @open-recent="openPath" @refresh="refresh" @font-size="fontSize = Math.max(12, Math.min(24, $event === 0 ? 15 : fontSize + $event))"
      @select-panel="revealPanel" @toggle-sidebar="panel = panel ? null : 'files'" @show-environment="statusbar?.showEnvironment?.()" @error="error = $event" />
    <input ref="fileInput" type="file" accept=".md,.markdown,.mdown,.mkd" multiple hidden @change="readPickedFiles">
    <main class="workspace">
      <ActivityBar :active="panel" @select="selectPanel" />
      <div v-show="panel" class="workbench-sidebar" data-testid="workbench-sidebar" :style="{ width: sidebarWidth + 'px' }">
        <ExplorerPanel v-show="panel === 'files'" :root="root" :active-path="active?.path ?? ''" :bridge="workspaceBridge"
          :tabs="tabs" :active-id="active?.id ?? null" @open="openPath" @choose-folder="chooseFolder" @activate="activate" @close="closeTab" />
        <SearchPanel v-show="panel === 'search'" ref="searchPanel" v-model:query="query" :count="matches.count" :current="matches.current" :pending="matches.pending ?? false" :has-document="!!result" @next="reader?.moveMatch(1)" @previous="reader?.moveMatch(-1)" @return-to-reader="reader?.focus?.()" />
        <Sidebar v-show="panel === 'outline'" :entries="result?.toc ?? []" :active-id="activeId" :has-document="!!result" @navigate="reader?.navigate($event)" />
      </div>
      <hr v-show="panel" class="sidebar-resizer" aria-label="调整侧栏宽度" aria-orientation="vertical"
        :aria-valuenow="sidebarWidth" :aria-valuemin="180" :aria-valuemax="sidebarMaximum" tabindex="0" @pointerdown="resizeSidebar" @keydown="resizeByKey" />
      <section class="reading-area" aria-label="文档阅读区">
        <DocumentTabs ref="documentTabs" :tabs="tabs" :active-id="active?.id ?? null" @activate="activate" @close="closeTab" @open="chooseFile"
          @reorder="(id, index) => session.reorder(id, index)" @close-others="closeGroup('others', $event)" @close-right="closeGroup('right', $event)" @close-all="close" />
        <div v-if="error || active?.error" class="error-banner" role="alert"><span><strong v-if="!error">{{ active?.name }}：</strong>{{ error || active?.error }}</span><button type="button" @click="dismissError">{{ error ? '关闭提示' : '关闭文档' }}</button></div>
        <div class="reader-pane">
          <div v-if="!active" class="welcome">
            <h1>Cyperus</h1><p class="welcome-subtitle">本地文档，直接阅读。</p>
            <div class="welcome-columns">
              <section><h2>开始</h2><div class="welcome-actions">
                <button ref="welcomeOpen" type="button" aria-label="打开 Markdown 文件" @click="chooseFile"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" /></svg>打开文件…</button>
                <button type="button" aria-label="打开文件夹" @click="chooseFolder"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><path d="M1.5 12.5v-9h5l1.5 2h6.5v7z" /></svg>打开文件夹…</button>
              </div></section>
              <section><h2>快捷操作</h2><div class="welcome-shortcuts"><span>打开文件 <kbd>Ctrl+O</kbd></span><span>搜索正文 <kbd>Ctrl+F</kbd></span><span>切换侧栏 <kbd>Ctrl+B</kbd></span></div></section>
            </div>
          </div>
          <ReaderView v-show="result" ref="reader" :result="result" :doc-id="active?.meta?.docId ?? null" :bridge="bridge"
            :markdown-theme="markdownTheme" :asset-url="assetUrl" :initial-scroll-top="active?.scrollTop ?? 0" :search-query="panel === 'search' ? query : ''"
            :session-id="active?.id ?? ''" :search-current="active?.search.current ?? 0" :font-size="fontSize" :initial-anchor="active?.anchor"
            @active="activeId = $event" @error="error = $event" @matches="onMatches" @position="onPosition" @anchor="onAnchor" @hover="linkTarget = $event" @link="followLink" @ready="onReaderReady" />
          <div v-if="active?.status === 'error' && !result" class="document-unavailable"><p>无法打开 {{ active.name }}</p><span>请检查文件是否存在，或切换到其他标签继续阅读。</span><div><button type="button" @click="active?.path && openPath(active.path)">重试</button><button type="button" @click="active && closeTab(active.id)">关闭此文档</button></div></div>
        </div>
      </section>
    </main>
    <WorkbenchStatusbar ref="statusbar" v-model:app-theme="appTheme" v-model:markdown-theme="markdownTheme"
      :folder-name="root?.name ?? ''" :folder-path="root?.path ?? ''" :document-label="breadcrumbParts.join(' › ')"
      :document-path="active?.path || active?.name || ''" :document-name="active?.name ?? ''" :encoding="active?.meta?.encoding ?? ''"
      :heading-count="result ? result.toc.length : null" :tab-count="tabs.length" :env="env"
      :link-target="linkTarget" :loading-name="active?.status === 'loading' || active?.refreshing ? active.name : ''">
      <div v-if="isMock" class="fixturebar">
        <select v-model="selectedFixture" data-testid="fixture-select" aria-label="示例文档"><option v-for="fixture in fixtures" :key="fixture" :value="fixture">{{ fixture }}</option></select>
        <button data-testid="open-fixture" type="button" @click="openPath(selectedFixture)">打开示例</button>
      </div>
    </WorkbenchStatusbar>
  </div>
</template>
