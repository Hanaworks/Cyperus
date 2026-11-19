import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { DocumentSession } from '../core/documents/session'
import type { WorkspaceState } from '../core/documents/workspaceState'
import type { RenderCompletion } from '../reader/renderCompletion'
import type { M0Hooks } from './protocol'

export interface M1Config { fixtureRoot: string; reportPath: string; profilePath: string; scenario: Record<string, unknown> | null }
export interface M1Controls {
  session: DocumentSession
  seed(paths: string[], root: string): Promise<void>
  snapshot(): WorkspaceState
  flush(): Promise<void>
  open(path: string): Promise<boolean>
  activate(id: string): void
  painted(): Promise<void>
  renderAll(): Promise<RenderCompletion>
  stageCloseState(): Promise<void>
  stats: M0Hooks['stats']
}
const key = (path: string) => path.replace(/\\/g, '/').toLowerCase()
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
async function waitFor(check: () => boolean, description: string, timeout = 15000): Promise<void> {
  const deadline = performance.now() + timeout
  while (!check()) {
    if (performance.now() >= deadline) throw new Error(`等待超时：${description}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }
}

async function seedProbe(config: M1Config, controls: M1Controls, report: Record<string, unknown>): Promise<void> {
  const scenario = config.scenario ?? {}
  const session = controls.session
  const publish = () => invoke('write_m1_report', { report })
  const paths = strings(scenario.files)
  if (paths.length !== 2) throw new Error('Seed requires two files')
  report.encodings = await verifyEncodings(scenario.encodings, controls)
  await controls.seed(paths, config.fixtureRoot)
  await invoke('m1_set_window_state', { state: { x: 20, y: 20, width: 800, height: 600, maximized: scenario.maximized === true } })
  report.stage = 'awaiting-forward'
  await publish()
  const forwarded = String(scenario.forwardPath)
  await waitFor(() => session.tabs.some((tab) => key(tab.path) === key(forwarded) && tab.status === 'ready'), '第二实例文件转发')
  if (session.tabs.length !== 3) throw new Error('Second instance duplicated or lost tabs')
  const first = session.tabs.find((tab) => key(tab.path) === key(paths[0] ?? ''))
  if (!first) throw new Error('First tab lost')
  controls.activate(first.id)
  await controls.painted()
  await controls.flush()
  report.workspace = controls.snapshot()
  report.desktop = await invoke('get_desktop_state')
  report.forwarded = true
  // Leave one last setting unsaved by the probe; the normal close handler must flush it.
  await controls.stageCloseState()
  report.workspace = controls.snapshot()
}

async function verifyEncodings(input: unknown, controls: M1Controls): Promise<string[]> {
  const verified: string[] = []
  if (!Array.isArray(input)) return verified
  for (const entry of input as { path: string; heading: string; label: string }[]) {
    if (!await controls.open(entry.path)) throw new Error(`Encoding fixture failed: ${entry.label}`)
    const tab = controls.session.active
    if (!tab?.result?.html.includes(entry.heading) || tab.meta?.encoding !== entry.label) throw new Error(`Encoding text mismatch: ${entry.label}`)
    verified.push(entry.label)
    await controls.session.close(tab.id)
  }
  return verified
}

async function restoreProbe(config: M1Config, controls: M1Controls, report: Record<string, unknown>): Promise<void> {
  const scenario = config.scenario ?? {}
  const session = controls.session
  const publish = () => invoke('write_m1_report', { report })
  await controls.painted()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const actual = controls.snapshot()
  const expected = scenario.workspace as WorkspaceState | undefined
  if (!expected) throw new Error('Missing expected saved workspace')
  for (const field of ['appTheme', 'markdownTheme', 'fontSize', 'sidebarWidth', 'panel'] as const) {
    if (actual[field] !== expected[field]) throw new Error(`Setting not restored: ${field}`)
  }
  if (key(actual.rootPath) !== key(expected.rootPath) || key(actual.activePath) !== key(expected.activePath)) throw new Error('Folder/active path not restored')
  if (JSON.stringify(actual.tabs.map((tab) => key(tab.path))) !== JSON.stringify(expected.tabs.map((tab) => key(tab.path)))) throw new Error('Tab order not restored')
  const active = actual.tabs.find((tab) => key(tab.path) === key(actual.activePath))
  const previous = expected.tabs.find((tab) => key(tab.path) === key(expected.activePath))
  if (!active || !previous || active.search.query !== previous.search.query || Math.abs(active.scrollTop - previous.scrollTop) > 24) throw new Error('Reading/search state not restored')
  const viewportTop = document.querySelector<HTMLElement>('.reader-scroll')?.scrollTop
  if (viewportTop === undefined || Math.abs(viewportTop - previous.scrollTop) > 24) throw new Error(`Visible reading position not restored: ${viewportTop} vs ${previous.scrollTop}`)
  report.viewportScrollTop = viewportTop
  const desktop = await invoke<{ current: Record<string, unknown>; restored: unknown }>('get_desktop_state')
  report.desktop = desktop
  const expectedWindow = scenario.window as Record<string, unknown> | undefined
  if (!desktop.restored || !expectedWindow) throw new Error('Window restore not observed')
  for (const field of ['width', 'height', 'x', 'y', 'maximized']) {
    if (desktop.current[field] !== expectedWindow[field]) throw new Error(`Window state mismatch: ${field}`)
  }
  report.workspace = actual
  report.desktop = desktop
  report.restored = true
  const live = String(scenario.livePath)
  if (!await controls.open(live)) throw new Error('Live document failed')
  report.stage = 'awaiting-saves'
  await publish()
  await waitFor(() => session.active?.result?.html.includes('M1-FINAL-20') === true, '连续 20 次保存最终内容')
  await controls.painted()
  if (!document.querySelector('article.md-doc')?.textContent?.includes('M1-FINAL-20')) throw new Error('Latest saved content not visible')
  report.continuousSave = true
  report.finalVersion = session.active?.meta?.version
}

async function performanceProbe(config: M1Config, controls: M1Controls, report: Record<string, unknown>): Promise<void> {
  const scenario = config.scenario ?? {}
  const session = controls.session
  const publish = () => invoke('write_m1_report', { report })
  report.measurements = []
  for (const path of strings(scenario.files)) for (const temperature of ['cold', 'warm']) {
    await session.closeAll()
    const openedAt = new Date().toISOString()
    const start = performance.now()
    if (!await controls.open(path)) throw new Error(`Open failed: ${path}`)
    const firstReadableMs = performance.now() - start
    const firstReadableAt = new Date().toISOString()
    report.firstReadableAt ??= firstReadableAt
    const result = session.active?.result
    const fullStart = performance.now()
    const completion = await controls.renderAll()
    if (completion.cancelled || completion.visitedSegments !== completion.totalSegments || completion.graphs.pending > 0) throw new Error('Incomplete full-render traversal')
    const fullTraversalMs = performance.now() - fullStart
    const fullRenderMs = performance.now() - start
    const completedAt = new Date().toISOString()
    const frames: number[] = []
    const scroller = document.querySelector<HTMLElement>('.reader-scroll')
    for (let step = 0; step < 30; step++) {
      const before = performance.now()
      if (scroller) scroller.scrollTop = step * Math.max(1, scroller.scrollHeight - scroller.clientHeight) / 29
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      frames.push(performance.now() - before)
    }
    frames.sort((a, b) => a - b)
    ;(report.measurements as unknown[]).push({ path, temperature, openedAt, firstReadableAt, completedAt,
      firstReadableMs, parseMs: result?.parseMs, fullTraversalMs, fullRenderMs, completion,
      htmlBytes: result?.htmlBytes, segments: result?.segments?.length ?? 0,
      mountedElements: document.querySelector('article.md-doc')?.querySelectorAll('*').length ?? 0,
      scrollRafP95Ms: frames[Math.ceil(frames.length * 0.95) - 1], cache: session.cacheStats })
    report.stage = 'measuring'
    await publish()
  }
  await session.closeAll()
  await controls.open(`${config.fixtureRoot}/generated/100kb.md`)
  report.stage = 'idle-ready'
}

/** Explicit, host-validated isolated profile only. Normal launches never call this probe. */
export async function runM1Probe(config: M1Config, controls: M1Controls): Promise<void> {
  const scenario = config.scenario ?? {}
  const report: Record<string, unknown> = { date: new Date().toISOString(), mode: scenario.mode, complete: false, errors: [] }
  report.viewport = { width: innerWidth, height: innerHeight, scale: devicePixelRatio }
  const publish = () => invoke('write_m1_report', { report })
  try {
    report.environment = await invoke('get_env_info')
    if (scenario.mode === 'seed') await seedProbe(config, controls, report)
    else if (scenario.mode === 'restore') await restoreProbe(config, controls, report)
    else if (scenario.mode === 'performance') await performanceProbe(config, controls, report)
    else if (scenario.mode === 'resources') {
      const { runResourcesProbe } = await import('./m1ResourcesProbe')
      await runResourcesProbe(config, controls, report)
    }
    else throw new Error('Unknown M1 probe scenario')
    report.complete = true
    report.stage ??= 'complete'
  } catch (error) {
    ;(report.errors as string[]).push(String(error))
    report.complete = true
    report.stage = 'failed'
  }
  await publish()
  if (scenario.mode !== 'performance') await getCurrentWindow().close()
}
