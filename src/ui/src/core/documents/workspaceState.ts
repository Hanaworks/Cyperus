import type { AppTheme, MarkdownTheme } from '../theme/apply'

export interface ReadingAnchor { id?: string; text: string; line: number; ratio: number }
export interface SavedTab { path: string; scrollTop: number; search: { query: string; current: number }; anchor?: ReadingAnchor }
export interface WorkspaceState {
  schemaVersion: 1
  appTheme: AppTheme
  markdownTheme: MarkdownTheme
  sidebarWidth: number
  fontSize: number
  panel: 'files' | 'search' | 'outline' | null
  rootPath: string
  tabs: SavedTab[]
  activePath: string
  recentFiles: string[]
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const path = (value: unknown) => typeof value === 'string' && value.length <= 32768 && !Array.from(value).some((char) => char.charCodeAt(0) < 32) ? value : ''
const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback

export function normalizeReadingAnchor(input: unknown): ReadingAnchor | undefined {
  const value = record(input)
  if (typeof value.text !== 'string') return undefined
  const id = path(value.id).slice(0, 1024)
  return { ...(id ? { id } : {}), text: value.text.slice(0, 256),
    line: Math.floor(number(value.line, 0, 0, 1e9)), ratio: number(value.ratio, 0, 0, 1) }
}

export function normalizeWorkspaceState(input: unknown): WorkspaceState {
  const source = record(input)
  const data = source.schemaVersion === 1 ? source : {}
  const tabs: SavedTab[] = []
  const seen = new Set<string>()
  for (const value of (Array.isArray(data.tabs) ? data.tabs : []).slice(0, 100)) {
    const item = record(value)
    const location = path(item.path)
    if (!location || seen.has(location)) continue
    seen.add(location)
    const search = record(item.search)
    const anchor = normalizeReadingAnchor(item.anchor)
    tabs.push({ path: location, scrollTop: number(item.scrollTop, 0, 0, 1e9),
      search: { query: typeof search.query === 'string' ? search.query.slice(0, 10000) : '', current: Math.floor(number(search.current, 0, 0, 1e7)) },
      ...(anchor ? { anchor } : {}) })
  }
  return { schemaVersion: 1, appTheme: data.appTheme === 'dark' ? 'dark' : 'light',
    markdownTheme: data.markdownTheme === 'dark' || data.markdownTheme === 'paper' ? data.markdownTheme : 'light',
    sidebarWidth: number(data.sidebarWidth, 240, 180, 480), fontSize: number(data.fontSize, 15, 12, 24),
    panel: data.panel === null || data.panel === 'search' || data.panel === 'outline' ? data.panel : 'files',
    rootPath: path(data.rootPath), tabs, activePath: path(data.activePath),
    recentFiles: [...new Set((Array.isArray(data.recentFiles) ? data.recentFiles : []).map(path).filter(Boolean))].slice(0, 20) }
}

/** Debounce UI changes and serialize host writes so an older save cannot win. */
export class WorkspaceWriter {
  private pending: WorkspaceState | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<void> = Promise.resolve()
  constructor(private save: (state: WorkspaceState) => Promise<void>, private report: (error: unknown) => void) {}
  schedule(state: WorkspaceState): void {
    this.pending = state
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, 200)
  }
  flush(): Promise<void> {
    clearTimeout(this.timer)
    const state = this.pending
    this.pending = undefined
    if (state) this.queue = this.queue.then(() => this.save(state)).catch(this.report)
    return this.queue
  }
  dispose(): void { clearTimeout(this.timer) }
}
