import { describe, expect, it, vi } from 'vitest'
import { normalizeWorkspaceState, WorkspaceWriter } from '@/core/documents/workspaceState'

describe('workspace state', () => {
  it('retains a bounded semantic anchor and rejects malformed positions', () => {
    const state = normalizeWorkspaceState({ schemaVersion: 1, tabs: [
      { path: 'a.md', anchor: { id: '章节', text: '正文', line: 20, ratio: 0.4, html: 'never-save' } },
      { path: 'b.md', anchor: { text: 'x'.repeat(300), line: -10, ratio: 5 } },
      { path: 'c.md', anchor: { text: 123, line: NaN, ratio: Infinity } },
    ] })
    expect(state.tabs[0]?.anchor).toEqual({ id: '章节', text: '正文', line: 20, ratio: 0.4 })
    expect(state.tabs[1]?.anchor).toEqual({ text: 'x'.repeat(256), line: 0, ratio: 1 })
    expect(state.tabs[2]?.anchor).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('never-save')
  })
  it('validates saved input, limits values and drops duplicate or temporary documents', () => {
    const state = normalizeWorkspaceState({ schemaVersion: 1, appTheme: 'dark', markdownTheme: 'paper',
      sidebarWidth: 900, fontSize: 48, panel: 'invalid', activePath: 'a.md', rootPath: 'docs',
      tabs: [{ path: 'a.md', scrollTop: 123, search: { query: 'word', current: 2 } }, { path: 'a.md' },
        { path: '', html: '<script>' }, { path: 'b.md', scrollTop: -1 }], recentFiles: ['a.md', 'a.md', null] })
    expect(state.appTheme).toBe('dark')
    expect(state.markdownTheme).toBe('paper')
    expect(state.sidebarWidth).toBe(480)
    expect(state.fontSize).toBe(24)
    expect(state.tabs.map((tab) => tab.path)).toEqual(['a.md', 'b.md'])
    expect(state.tabs[0]?.search).toEqual({ query: 'word', current: 2 })
    expect(state.tabs[1]?.scrollTop).toBe(0)
    expect(state.recentFiles).toEqual(['a.md'])
    expect(JSON.stringify(state)).not.toContain('script')
  })
  it('falls back on corrupt/future schemas without importing their paths', () => {
    for (const invalid of [null, [], 'bad', { schemaVersion: 50, tabs: [{ path: 'untrusted.md' }] }]) {
      const state = normalizeWorkspaceState(invalid)
      expect(state.tabs).toEqual([])
      expect(state.appTheme).toBe('light')
      expect(state.markdownTheme).toBe('light')
    }
  })
  it('serializes saves and flushes the newest snapshot even during a slow write', async () => {
    let unblock!: () => void
    const gate = new Promise<void>((resolve) => { unblock = resolve })
    const writes: string[] = []
    const save = vi.fn(async (state: ReturnType<typeof normalizeWorkspaceState>) => {
      writes.push(state.appTheme)
      if (writes.length === 1) await gate
    })
    const writer = new WorkspaceWriter(save, () => {})
    writer.schedule(normalizeWorkspaceState(null))
    const first = writer.flush()
    await Promise.resolve()
    writer.schedule(normalizeWorkspaceState({ schemaVersion: 1, appTheme: 'dark' }))
    const last = writer.flush()
    unblock()
    await Promise.all([first, last])
    expect(writes).toEqual(['light', 'dark'])
    writer.dispose()
  })
})
