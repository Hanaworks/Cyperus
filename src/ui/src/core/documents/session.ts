import type { IpcBridge } from '../ipc/bridge'
import type { DocMeta } from '../ipc/contract'
import type { ParseResult } from '../render/contract'
import { defaultSegmentStore, type SegmentStore } from '../render/segmentStore'
import { HtmlBudget, type HtmlCacheStats, serializedHtmlBytes } from './budget'
import { normalizeReadingAnchor, type ReadingAnchor, type SavedTab } from './workspaceState'

export interface SessionTab {
  id: string
  meta: DocMeta | null
  name: string
  path: string
  result: ParseResult | null
  status: 'loading' | 'ready' | 'error'
  error: string
  scrollTop: number
  search: { query: string; current: number }
  stale?: boolean
  refreshing?: boolean
  pendingAnchor?: string
  evicted?: boolean
  anchor?: ReadingAnchor
}

type DocumentIO = Pick<IpcBridge, 'openDocument' | 'readDocument' | 'closeDocument'> & Partial<Pick<IpcBridge, 'readDocumentMeta'>>
type Parse = (text: string, generation: number, docId?: string) => Promise<ParseResult>
export interface DocumentSessionOptions {
  htmlBudgetBytes?: number
  cancelParse?: (docId: string) => void
  segmentStore?: SegmentStore
}
interface ClosedTab { path: string; index: number; scrollTop: number; search: SessionTab['search']; anchor?: ReadingAnchor }

interface TabState {
  tab: SessionTab
  aliases: Set<string>
  closed: boolean
  acquired: Promise<TabState | null>
  loaded: Promise<TabState | null>
  revision: number
  pendingVersion: number
  sourceText?: string
}

// Path spelling is only a fast lookup. The host's canonical path/docId remains
// authoritative; do not collapse '..' in front of the host's link-path checks.
function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase() : normalized
}

function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

export class DocumentSession {
  tabs: SessionTab[] = []
  activeId: string | null = null
  private sequence = 0
  private generation = 0
  private batchEpoch = 0
  private restoring = false
  private states = new Map<string, TabState>()
  private paths = new Map<string, TabState>()
  private owners = new Map<string, TabState>()
  private closing = new Map<string, Promise<void>>()
  private hostQueue: Promise<void> = Promise.resolve()
  private recentClosed: ClosedTab[] = []
  private budget: HtmlBudget
  private closingAll = 0
  private storage: SegmentStore | undefined
  private storageFailure = ''

  constructor(private io: DocumentIO, private parse: Parse, private onChange: () => void,
    private options: DocumentSessionOptions = {}) {
    this.budget = new HtmlBudget(options.htmlBudgetBytes)
    this.storage = options.segmentStore
  }

  get cacheStats(): HtmlCacheStats & { readonly storedHtmlBytes: number } {
    const storedHtmlBytes = this.tabs.reduce((total, tab) => total + (tab.result?.segments?.reduce(
      (sum, segment) => sum + (segment.storageKey ? segment.htmlBytes ?? 0 : 0), 0) ?? 0), 0)
    return { ...this.budget.stats(this.activeId), storedHtmlBytes }
  }

  get storageError(): string { return this.storageFailure }

  get active(): SessionTab | null {
    return this.states.get(this.activeId ?? '')?.tab ?? null
  }

  get canReopen(): boolean { return this.recentClosed.length > 0 }

  async reopenLastClosed(): Promise<boolean> {
    const item = this.recentClosed.pop()
    if (!item) return false
    const previousId = this.activeId
    const existing = this.paths.get(pathKey(item.path))
    const loading = this.openPath(item.path, true, item)
    const pending = this.paths.get(pathKey(item.path))
    this.onChange()
    if (await this.latestPath(item.path, loading)) return true
    if (!pending || pending.closed || pending.tab.status !== 'error') return false
    const error = pending.tab.error
    if (!existing) {
      const restoreSelection = this.activeId === pending.tab.id
      await this.close(pending.tab.id)
      if (restoreSelection && previousId) this.activate(previousId)
    }
    throw new Error(error)
  }

  async open(path: string): Promise<boolean> {
    this.cancelRestore()
    return (await this.latestPath(path, this.openPath(path, true))) !== null
  }

  async openLinked(path: string, anchor?: string, select = true): Promise<boolean> {
    this.cancelRestore()
    const previous = this.activeId
    const existing = this.paths.get(pathKey(path))
    const loading = this.openPath(path, select)
    const placeholder = this.paths.get(pathKey(path))
    const loaded = await this.latestPath(path, loading)
    if (loaded) {
      if (anchor !== undefined) { loaded.tab.pendingAnchor = anchor; this.onChange() }
      return true
    }
    if (!placeholder || placeholder.closed) return false
    const error = placeholder.tab.error || '无法打开链接文档'
    if (!existing) {
      const restore = this.activeId === placeholder.tab.id
      await this.close(placeholder.tab.id)
      if (restore && previous) this.activate(previous)
    }
    throw new Error(error)
  }

  private async latestPath(path: string, request: Promise<TabState | null>): Promise<TabState | null> {
    let pending = request
    for (;;) {
      const loaded = await pending
      if (loaded) return loaded
      const live = this.paths.get(pathKey(path))
      if (!live || live.closed) return null
      if (live.loaded === pending) return live.tab.status === 'error' ? null : live
      pending = live.loaded
    }
  }

  consumeAnchor(id: string): void {
    const state = this.states.get(id)
    if (state) { delete state.tab.pendingAnchor; this.onChange() }
  }

  whenReady(id: string): Promise<unknown> { return this.states.get(id)?.loaded ?? Promise.resolve() }

  changed(docId: string, version: number, removed = false): void {
    const state = this.owners.get(docId)
    if (!state || !Number.isFinite(version) || version <= Math.max(state.pendingVersion, state.tab.meta?.version ?? 0)) return
    state.pendingVersion = version
    state.revision += 1
    state.tab.stale = true
    state.tab.refreshing = false
    if (removed) {
      state.tab.error = '文件已删除或移动，保留上次内容；文件恢复后将自动更新。'
      state.tab.status = state.tab.result ? 'ready' : 'error'
    } else if (this.activeId === state.tab.id) void this.refresh(state.tab.id)
    this.onChange()
  }

  async refresh(id = this.activeId): Promise<boolean> {
    const state = id ? this.states.get(id) : undefined
    if (!state) return false
    if (!state.tab.path) {
      if (state.sourceText === undefined) return false
      const revision = ++state.revision
      state.tab.refreshing = true
      state.loaded = this.parseText(state, state.sourceText, revision)
      this.onChange()
      return (await state.loaded) !== null
    }
    if (!state.tab.meta || !this.owners.has(state.tab.meta.docId)) return (await this.openPath(state.tab.path, false)) !== null
    const revision = ++state.revision
    state.tab.refreshing = true
    state.tab.error = ''
    state.loaded = this.reload(state, revision)
    this.onChange()
    return (await state.loaded) !== null
  }

  private async reload(state: TabState, revision: number): Promise<TabState | null> {
    const current = () => !state.closed && state.revision === revision
    try {
      const initialMeta = state.tab.meta
      if (!initialMeta) return null
      const { meta, text } = await this.readStable(initialMeta, state.pendingVersion)
      if (!current()) return null
      let result = await this.parse(text, ++this.generation, state.tab.id)
      if (!current()) return null
      result = await this.prepareResult(result)
      if (!current()) { await this.releaseStored(result); return null }
      state.tab.meta = meta
      state.tab.status = 'ready'
      state.tab.stale = false
      state.tab.error = ''
      this.retain(state, result)
      return state
    } catch (error) {
      if (current()) {
        state.tab.error = `无法刷新：${message(error)}${state.tab.result ? '（保留上次内容）' : ''}`
        state.tab.status = state.tab.result ? 'ready' : 'error'
        state.tab.stale = true
      }
      return null
    } finally {
      if (current()) { state.tab.refreshing = false; this.onChange() }
    }
  }

  private async readStable(initial: DocMeta, minimumVersion: number): Promise<{ meta: DocMeta; text: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.io.readDocumentMeta?.(initial.docId) ?? initial
      const bytes = await this.io.readDocument(initial.docId)
      const after = await this.io.readDocumentMeta?.(initial.docId) ?? before
      if (before.version !== after.version || before.size !== after.size || before.mtimeMs !== after.mtimeMs
        || before.encoding !== after.encoding || before.hadBom !== after.hadBom || after.version < minimumVersion) continue
      const text = new TextDecoder(after.encoding === 'utf-8-bom' ? 'utf-8' : after.encoding, { fatal: true }).decode(bytes)
      return { meta: after, text }
    }
    throw new Error('文件仍在保存，请稍后刷新。')
  }

  reorder(id: string, targetIndex: number): void {
    const tab = this.states.get(id)?.tab
    if (!tab || !Number.isFinite(targetIndex)) return
    this.tabs = this.tabs.filter((item) => item !== tab)
    this.tabs.splice(Math.max(0, Math.min(this.tabs.length, Math.floor(targetIndex))), 0, tab)
    this.onChange()
  }

  async closeOthers(id: string): Promise<void> {
    if (!this.states.has(id)) return
    const previous = this.activeId
    this.activate(id)
    await Promise.all(this.tabs.filter((tab) => tab.id !== id && tab.id !== previous).map((tab) => this.close(tab.id)))
  }

  async closeRight(id: string): Promise<void> {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    await Promise.all(this.tabs.slice(index + 1).map((tab) => this.close(tab.id)))
  }

  async restore(saved: SavedTab[], activePath: string): Promise<string[]> {
    const epoch = ++this.batchEpoch
    this.restoring = true
    const errors: string[] = []
    for (const [index, item] of saved.entries()) {
      if (epoch !== this.batchEpoch) return errors
      const loaded = await this.openPath(item.path, false, { ...item, index })
      if (epoch !== this.batchEpoch) return errors
      if (!loaded) {
        const failed = this.paths.get(pathKey(item.path))
        if (failed && !failed.closed && failed.tab.status === 'error') { errors.push(`${failed.tab.name}：${failed.tab.error}`); await this.close(failed.tab.id) }
      }
    }
    this.restoring = false
    const active = this.paths.get(pathKey(activePath)) ?? this.states.get(this.tabs[0]?.id ?? '')
    if (active) this.activate(active.tab.id)
    return errors
  }

  private cancelRestore(): void {
    if (this.restoring) { this.restoring = false; this.batchEpoch += 1 }
  }

  async openMany(paths: string[]): Promise<void> {
    this.cancelRestore()
    const epoch = this.batchEpoch
    for (const [index, path] of paths.entries()) {
      if (epoch !== this.batchEpoch) break
      await this.openPath(path, index === 0)
    }
  }

  async openText(text: string, name: string): Promise<SessionTab> {
    this.cancelRestore()
    const state = this.create(name, '')
    state.sourceText = text
    this.activate(state.tab.id)
    state.loaded = this.parseText(state, text)
    const loaded = await state.loaded
    if (!loaded) throw new Error(state.tab.error || '文档已关闭')
    return loaded.tab
  }

  activate(id: string): void {
    this.cancelRestore()
    if (!this.states.has(id) || this.activeId === id) return
    this.activeId = id
    this.budget.touch(id)
    const state = this.states.get(id)
    if (state && (state.tab.stale || state.tab.evicted) && !state.tab.refreshing) void this.refresh(id)
    this.enforceBudget()
    this.onChange()
  }

  close(id: string): Promise<void> {
    const pending = this.closing.get(id)
    if (pending) return pending
    const state = this.states.get(id)
    if (!state) return Promise.resolve()
    if (state.tab.path && state.tab.status !== 'error') {
      this.recentClosed.push({ path: state.tab.path, index: this.tabs.findIndex((tab) => tab.id === id),
        scrollTop: state.tab.scrollTop, search: { ...state.tab.search },
        ...(state.tab.anchor ? { anchor: { ...state.tab.anchor } } : {}) })
      if (this.recentClosed.length > 15) this.recentClosed.shift()
    }
    state.closed = true
    const cleanup = this.remove(state)
    // Opening/closing registry commands are serialized. Reads and parses remain
    // concurrent, so a closed slow read cannot hold up another document.
    const operation = this.host(async () => { await this.release(state); await cleanup })
    this.closing.set(id, operation)
    const forget = () => { this.closing.delete(id) }
    void operation.then(forget, forget)
    return operation
  }

  async closeAll(): Promise<void> {
    this.restoring = false
    this.batchEpoch += 1
    this.closingAll += 1
    try {
      const pending = [...this.closing.values()]
      for (const id of [...this.states.keys()]) pending.push(this.close(id))
      const results = await Promise.allSettled(pending)
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    } finally { this.closingAll -= 1 }
  }

  setReadingAnchor(id: string, anchor: ReadingAnchor | undefined): void {
    const state = this.states.get(id)
    if (!state) return
    const next = normalizeReadingAnchor(anchor)
    const previous = state.tab.anchor
    if (previous?.id === next?.id && previous?.text === next?.text && previous?.line === next?.line && previous?.ratio === next?.ratio) return
    if (next) state.tab.anchor = next
    else delete state.tab.anchor
    this.onChange()
  }

  setPosition(id: string, scrollTop: number): void {
    const state = this.states.get(id)
    if (!state || !Number.isFinite(scrollTop)) return
    const next = Math.max(0, scrollTop)
    if (state.tab.scrollTop === next) return
    state.tab.scrollTop = next
    this.onChange()
  }

  setSearch(id: string, query: string, current = 0): void {
    const state = this.states.get(id)
    if (!state) return
    const index = query && Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0
    if (state.tab.search.query === query && state.tab.search.current === index) return
    state.tab.search = { query, current: index }
    this.onChange()
  }

  private create(name: string, path: string): TabState {
    const tab: SessionTab = { id: `session-${++this.sequence}`, meta: null, name, path,
      result: null, status: 'loading', error: '', scrollTop: 0, search: { query: '', current: 0 } }
    const state: TabState = { tab, aliases: new Set(), closed: false,
      acquired: Promise.resolve(null), loaded: Promise.resolve(null), revision: 0, pendingVersion: 0 }
    this.states.set(tab.id, state)
    this.tabs = [...this.tabs, tab]
    return state
  }

  private alias(state: TabState, path: string): void {
    const key = pathKey(path)
    state.aliases.add(key)
    this.paths.set(key, state)
  }

  private openPath(path: string, select: boolean, restored?: ClosedTab): Promise<TabState | null> {
    let state = this.paths.get(pathKey(path))
    if (state && state.tab.status !== 'error') {
      if (select) this.activate(state.tab.id)
      return state.loaded
    }
    if (state) {
      state.tab.status = 'loading'
      state.tab.error = ''
      void this.releaseStored(state.tab.result)
      state.tab.result = null
      this.budget.remove(state.tab.id)
      state.tab.meta = null
    } else {
      state = this.create(path.split(/[\\/]/).at(-1) || path, path)
      if (restored) {
        const tab = state.tab
        tab.scrollTop = restored.scrollTop
        tab.search = { ...restored.search }
        if (restored.anchor) tab.anchor = { ...restored.anchor }
        this.tabs = this.tabs.filter((item) => item !== tab)
        this.tabs.splice(Math.min(restored.index, this.tabs.length), 0, tab)
      }
      this.alias(state, path)
    }
    const current = state
    // Queue acquisition before notifying the UI: a reentrant close callback must
    // still release a handle returned later by this already-started open.
    current.acquired = this.host(() => this.acquire(current, path))
    current.loaded = this.load(current)
    if (select) this.activate(current.tab.id)
    this.onChange()
    return current.loaded
  }

  private host<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.hostQueue.then(operation)
    this.hostQueue = task.then(() => undefined, () => undefined)
    return task
  }

  // Called only within hostQueue. The host registry has no reference count:
  // duplicate opens of the same docId must never close the retained tab's handle.
  private async acquire(state: TabState, path: string): Promise<TabState | null> {
    const meta = await this.io.openDocument(path)
    const existing = this.owners.get(meta.docId) ?? this.paths.get(pathKey(meta.path))
    if (state.closed) {
      if (!this.owners.has(meta.docId)) await this.io.closeDocument(meta.docId)
      return null
    }
    if (existing && existing !== state && !existing.closed && existing.tab.meta) {
      if (existing.tab.status === 'error') {
        // Failed tabs retain metadata for their label, but no reusable result or
        // host ownership. A newly discovered alias must perform a real retry.
        existing.tab.meta = meta
        existing.tab.name = meta.name
        existing.tab.path = meta.path
        existing.tab.status = 'loading'
        existing.tab.error = ''
        this.owners.set(meta.docId, existing)
        existing.acquired = Promise.resolve(existing)
        existing.loaded = this.load(existing)
      }
      for (const alias of state.aliases) this.alias(existing, alias)
      this.alias(existing, meta.path)
      // Replacing a selected alias placeholder preserves the selection without
      // stealing activation from a newer open or an explicit activate().
      if (this.activeId === state.tab.id) this.activate(existing.tab.id)
      state.closed = true
      void this.remove(state)
      if (meta.docId !== existing.tab.meta.docId && !this.owners.has(meta.docId)) {
        await this.io.closeDocument(meta.docId)
      }
      return existing
    }
    state.tab.meta = meta
    state.tab.name = meta.name
    state.tab.path = meta.path
    this.alias(state, meta.path)
    this.owners.set(meta.docId, state)
    this.onChange()
    return state
  }

  private async load(state: TabState): Promise<TabState | null> {
    const revision = state.revision
    try {
      const acquired = await state.acquired
      if (!acquired) return null
      if (acquired !== state) return acquired.loaded
      const meta = state.tab.meta
      if (state.closed || !meta) return null
      const stable = await this.readStable(meta, state.pendingVersion)
      if (state.closed || state.revision !== revision) return null
      state.tab.meta = stable.meta
      return await this.parseText(state, stable.text, revision)
    } catch (error) {
      if (state.revision !== revision) return null
      return this.fail(state, error)
    }
  }

  private async parseText(state: TabState, text: string, revision = state.revision): Promise<TabState | null> {
    try {
      let result = await this.parse(text, ++this.generation, state.tab.id)
      if (state.closed || state.revision !== revision) return null
      result = await this.prepareResult(result)
      if (state.closed || state.revision !== revision) { await this.releaseStored(result); return null }
      state.tab.status = 'ready'
      state.tab.refreshing = false
      this.retain(state, result)
      this.onChange()
      return state
    } catch (error) {
      if (state.revision !== revision) return null
      return this.fail(state, error)
    }
  }

  private async fail(state: TabState, error: unknown): Promise<null> {
    if (state.closed) return null
    // Release first so an immediate retry cannot accidentally reuse a handle
    // whose old failure cleanup is still queued.
    try { await this.host(() => this.release(state)) }
    catch (closeError) { error = `${message(error)}；${message(closeError)}` }
    if (state.closed) return null
    state.tab.status = 'error'
    state.tab.error = message(error)
    void this.releaseStored(state.tab.result)
    state.tab.result = null
    this.budget.remove(state.tab.id)
    this.onChange()
    return null
  }

  private async release(state: TabState): Promise<void> {
    const docId = state.tab.meta?.docId
    if (!docId || this.owners.get(docId) !== state) return
    await this.io.closeDocument(docId)
    if (this.owners.get(docId) === state) this.owners.delete(docId)
  }

  private remove(state: TabState): Promise<void> {
    state.revision += 1
    const cleanup = this.releaseStored(state.tab.result)
    state.tab.result = null
    delete state.sourceText
    this.budget.remove(state.tab.id)
    this.options.cancelParse?.(state.tab.id)
    const index = this.tabs.findIndex((tab) => tab.id === state.tab.id)
    this.states.delete(state.tab.id)
    for (const alias of state.aliases) {
      if (this.paths.get(alias) === state) this.paths.delete(alias)
    }
    this.tabs = this.tabs.filter((tab) => tab.id !== state.tab.id)
    if (this.activeId === state.tab.id) {
      this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? null
      this.budget.touch(this.activeId ?? '')
      if (!this.closingAll && (this.active?.stale || this.active?.evicted) && !this.active.refreshing) void this.refresh()
    }
    this.enforceBudget()
    this.onChange()
    return cleanup
  }

  private retain(state: TabState, result: ParseResult): void {
    void this.releaseStored(state.tab.result)
    state.tab.result = result
    state.tab.evicted = false
    this.budget.record(state.tab.id, result)
    this.enforceBudget()
  }

  private enforceBudget(): void {
    const storedActive = this.active?.result?.segments?.some((segment) => segment.storageKey)
    const victims = new Set(this.budget.victims(this.activeId))
    for (const tab of this.tabs) {
      if (tab.id !== this.activeId && tab.result && (storedActive || tab.result.segments?.some((segment) => segment.storageKey))) victims.add(tab.id)
    }
    for (const id of victims) {
      this.budget.remove(id)
      const state = this.states.get(id)
      if (!state) continue
      state.revision += 1
      void this.releaseStored(state.tab.result)
      state.tab.result = null
      state.tab.evicted = true
      state.tab.refreshing = false
      state.loaded = Promise.resolve(state)
      this.options.cancelParse?.(id)
    }
  }

  private prepareResult(result: ParseResult): Promise<ParseResult> {
    if (serializedHtmlBytes(result) <= this.budget.limit) return Promise.resolve(result)
    this.storage ??= defaultSegmentStore()
    return this.storage.spill(result)
  }

  private releaseStored(result: ParseResult | null): Promise<void> {
    if (!result?.segments?.some((segment) => segment.storageKey) || !this.storage) return Promise.resolve()
    const cleanup = this.storage.release(result)
    // Eviction is synchronous; observe asynchronous cleanup failures even if no
    // close caller is awaiting them. The diagnostic remains available to the UI.
    void cleanup.catch((error: unknown) => {
      this.storageFailure = `无法清理长文档临时内容：${message(error)}`
      this.onChange()
    })
    return cleanup
  }
}
