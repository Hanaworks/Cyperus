import { invoke } from '@tauri-apps/api/core'
import type { M1Config, M1Controls } from './m1Probe'

const HTML_BUDGET = 48 * 1024 * 1024
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const pathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase()

function requireCheck(condition: boolean, description: string): void {
  if (!condition) throw new Error(`Resources probe: ${description}`)
}

async function activateReady(controls: M1Controls, id: string): Promise<void> {
  controls.activate(id)
  const deadline = performance.now() + 30000
  while (true) {
    const tab = controls.session.tabs.find((item) => item.id === id)
    if (!tab || tab.status === 'error') throw new Error(`Activation failed: ${tab?.error ?? id}`)
    if (controls.session.activeId === id && tab.status === 'ready' && tab.result && !tab.evicted && !tab.refreshing) break
    if (performance.now() >= deadline) throw new Error(`Activation timed out: ${id}`)
    await pause(25)
  }
  await controls.painted()
}

function cacheEvidence(controls: M1Controls) {
  const cache = { ...controls.session.cacheStats }
  requireCheck(cache.budgetBytes === HTML_BUDGET, 'expected the production 48 MiB HTML budget')
  requireCheck(cache.retainedHtmlBytes <= HTML_BUDGET && cache.overBudgetBytes === 0, 'retained HTML exceeds its budget')
  return { cache, tabCount: controls.session.tabs.length,
    cachedTabs: controls.session.tabs.filter((tab) => tab.result !== null).length,
    evictedTabs: controls.session.tabs.filter((tab) => tab.evicted).length,
    parseCount: controls.stats().parseCount }
}

async function verifyCachedSwitch(controls: M1Controls, count: number): Promise<Record<string, unknown>> {
  const activeId = controls.session.activeId
  const cached = controls.session.tabs.find((tab) => tab.id !== activeId && tab.result && !tab.evicted && !tab.stale)
  if (!activeId || !cached) throw new Error(`No unchanged cached tab available at ${count} tabs`)
  const before = controls.stats().parseCount
  await activateReady(controls, cached.id)
  await activateReady(controls, activeId)
  const after = controls.stats().parseCount
  requireCheck(after === before, `unchanged cached switching reparsed at ${count} tabs`)
  return { tabCount: count, before, after, cachedPath: cached.path, passed: true }
}

async function verifyEvictedReload(controls: M1Controls, firstId: string): Promise<Record<string, unknown>> {
  const evicted = controls.session.tabs.find((tab) => tab.id === firstId)
  requireCheck(evicted?.evicted === true && evicted.result === null, 'first tab was not evicted after the 100-tab workload')
  requireCheck(evicted?.search.query === 'M1-retained-search-state', 'eviction lost lightweight search state')
  const before = controls.stats().parseCount
  await activateReady(controls, firstId)
  const after = controls.stats().parseCount
  requireCheck(after === before + 1 && !!controls.session.active?.result?.html, 'evicted activation did not reload and parse exactly once')
  requireCheck(controls.session.active?.search.query === 'M1-retained-search-state', 'reloading lost search state')
  return { passed: true, before, after, ...cacheEvidence(controls) }
}

function resourceScenario(config: M1Config) {
  const scenario = config.scenario ?? {}
  const files = Array.isArray(scenario.files) ? scenario.files.filter((path): path is string => typeof path === 'string') : []
  const smallPath = typeof scenario.smallPath === 'string' ? scenario.smallPath : ''
  requireCheck(files.length === 100 && new Set(files.map(pathKey)).size === 100 && !!smallPath, '100 distinct files and one 100 KB fixture are required')
  return { files, smallPath }
}

/** Invoked only by the host-validated M1 isolated profile. No forced GC or RSS claims in JS. */
export async function runResourcesProbe(config: M1Config, controls: M1Controls, report: Record<string, unknown>): Promise<void> {
  const { files, smallPath } = resourceScenario(config)
  const checkpoints: Record<string, unknown>[] = []
  const switches: Record<string, unknown>[] = []
  const cycles: Record<string, unknown>[] = []
  report.checkpoints = checkpoints
  report.cachedSwitches = switches
  report.closeCycles = cycles
  report.resourceNotes = 'Real native file IPC and production session. HTML bytes are a cache quota, not heap/RSS. RSS is sampled independently. No forced GC. Close cycles precede the multi-tab workload.'
  const publish = () => invoke('write_m1_report', { report })
  const checkpoint = async (name: string) => {
    const evidence: Record<string, unknown> = { name, startedAt: new Date().toISOString(), ...cacheEvidence(controls) }
    checkpoints.push(evidence)
    report.stage = name
    await publish()
    // The external sampler uses the last two seconds of this quiet window.
    // There is no UI-side process sampler, control-file polling, or explicit GC.
    await pause(5000)
    evidence.endedAt = new Date().toISOString()
    await publish()
  }

  await controls.session.closeAll()
  await controls.painted()
  const cycleParseStart = controls.stats().parseCount
  for (let round = 1; round <= 50; round++) {
    const startedAt = new Date().toISOString()
    requireCheck(await controls.open(smallPath), `100 KB open failed at round ${round}`)
    requireCheck(controls.session.active?.status === 'ready', `100 KB not ready at round ${round}`)
    await controls.session.closeAll()
    await controls.painted()
    const evidence = cacheEvidence(controls)
    requireCheck(evidence.tabCount === 0 && evidence.cache.retainedHtmlBytes === 0 && evidence.cache.storedHtmlBytes === 0, `closed document retained HTML at round ${round}`)
    cycles.push({ round, startedAt, closedAt: new Date().toISOString(), ...evidence })
    if (round === 5 || round === 50) await checkpoint(`close-${round}`)
    else await pause(50)
  }
  requireCheck(controls.stats().parseCount - cycleParseStart === 50, '50 actual opens did not produce 50 parses')
  report.closeCyclesPassed = true

  let firstId = ''
  for (let index = 0; index < files.length; index++) {
    const path = files[index]
    if (!path) throw new Error('Missing fixture path')
    requireCheck(await controls.open(path), `native file open failed at tab ${index + 1}`)
    requireCheck(controls.session.tabs.length === index + 1, `file was deduplicated or lost at tab ${index + 1}`)
    requireCheck(controls.session.active?.status === 'ready' && pathKey(controls.session.active.path) === pathKey(path), 'active file mismatch')
    if (index === 0) firstId = controls.session.activeId ?? ''
    if (index === 1) controls.session.setSearch(firstId, 'M1-retained-search-state', 0)
    cacheEvidence(controls)
    const count = index + 1
    if (![10, 30, 100].includes(count)) continue

    switches.push(await verifyCachedSwitch(controls, count))
    await checkpoint(`tabs-${count}`)
  }

  report.evictedReopen = await verifyEvictedReload(controls, firstId)
  await controls.session.closeAll()
  await controls.painted()
  const released = cacheEvidence(controls)
  requireCheck(released.tabCount === 0 && released.cache.retainedHtmlBytes === 0 && released.cache.storedHtmlBytes === 0, '100-tab close did not release HTML')
  report.finalCache = released
  report.resourcesPassed = true
  report.stage = 'resources-complete'
}
