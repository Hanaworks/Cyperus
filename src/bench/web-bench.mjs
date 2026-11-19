#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MATRIX = ['100kb', '1mb', '10mb', '50mb', 'mermaid-100', 'code-heavy', 'math-heavy']
const FIXTURES = ['basic', 'extended', 'cjk-typography', 'theme', 'html-safety', 'links']
export const CSV_FIELDS = [
  'date', 'commit', 'scenario', 'fixture', 'cold_or_warm', 'first_paint_ms',
  'full_render_ms', 'p95_interaction_ms', 'rss_peak_mb', 'rss_stable_mb', 'idle_cpu_pct', 'notes',
]

export function csvRow(row) {
  return CSV_FIELDS.map((field) => {
    const value = row[field] === null || row[field] === undefined ? '' : String(row[field])
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  }).join(',')
}

export function fingerprintSources(entries) {
  const digest = createHash('sha256')
  for (const entry of [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    digest.update(entry.path).update('\0').update(entry.content).update('\0')
  }
  return digest.digest('hex').slice(0, 16)
}

async function getUiFingerprint() {
  const paths = ['src/ui/src/App.vue', 'src/ui/src/reader/ReaderView.vue',
    'src/ui/src/workers/parse.worker.ts', 'src/ui/src/core/markdown/index.ts']
  return fingerprintSources(await Promise.all(paths.map(async (path) => ({ path, content: await readFile(join(REPO_ROOT, path)) }))))
}

export function percentile(values, percent) {
  if (!(percent > 0 && percent <= 100)) throw new Error('percentile must be in (0, 100]')
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Measurements must be finite')
  if (!values.length) return null
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * percent / 100) - 1]
}

function validateNumericOptions(options) {
  for (const key of ['port', 'idleSeconds', 'iterations', 'timeoutMs']) {
    options[key] = Number(options[key])
    if (!Number.isFinite(options[key]) || options[key] <= 0) throw new Error(`${key} must be positive`)
  }
  if (!Number.isInteger(options.port) || options.port > 65535) throw new Error('port must be 1..65535')
  if (!Number.isInteger(options.iterations)) throw new Error('iterations must be a positive integer')
}

export function parseArgs(argv) {
  const options = {
    scenario: 'open', fixture: '100kb', output: resolve(REPO_ROOT, 'benchmarks/results.csv'),
    port: 1421, idleSeconds: 60, iterations: 50, timeoutMs: 180000, baseUrl: undefined,
    help: false, browserPath: undefined, coldOnly: false,
  }
  const names = {
    '--scenario': 'scenario', '--fixture': 'fixture', '--output': 'output',
    '--port': 'port', '--idle-seconds': 'idleSeconds', '--iterations': 'iterations',
    '--timeout-ms': 'timeoutMs', '--base-url': 'baseUrl',
    '--browser-path': 'browserPath',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help' || flag === '-h') { options.help = true; continue }
    if (flag === '--cold-only') { options.coldOnly = true; continue }
    const key = names[flag]
    if (!key) throw new Error(`Unknown option: ${flag}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
    options[key] = value
  }
  if (!['idle', 'open', 'matrix', 'reload', 'lifecycle', 'isolation'].includes(options.scenario)) {
    throw new Error(`Unknown scenario: ${options.scenario}`)
  }
  if (options.scenario === 'idle' && !argv.includes('--fixture')) options.fixture = 'none'
  validateNumericOptions(options)
  if (options.baseUrl) {
    const url = new URL(options.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('base-url must use HTTP(S)')
    options.baseUrl = url.href
  }
  options.output = resolve(options.output)
  return options
}

export async function appendResults(output, rows) {
  let existing = ''
  try { existing = await readFile(output, 'utf8') } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const header = CSV_FIELDS.join(',')
  if (existing && existing.split(/\r?\n/)[0] !== header) throw new Error(`Unexpected CSV header: ${output}`)
  await mkdir(dirname(output), { recursive: true })
  const prefix = existing ? (existing.endsWith('\n') ? '' : '\n') : `${header}\n`
  await appendFile(output, `${prefix}${rows.map(csvRow).join('\n')}\n`)
}

export function summarizeSamples(samples) {
  if (!samples.length) return {
    rssPeakMb: null, rssStableMb: null, cpuMs: null, cpuPct: null, sampleCount: 0,
  }
  validateNumericSamples(samples)
  const last = samples.at(-1)
  return {
    rssPeakMb: Math.max(...samples.map((row) => Number(row.rss_bytes))) / 1048576,
    rssStableMb: Number(last.rss_bytes) / 1048576,
    cpuMs: Number(last.cpu_elapsed_ms),
    cpuPct: Number(last.elapsed_ms) > 0 ? Number(last.cpu_elapsed_ms) / Number(last.elapsed_ms) * 100 : null,
    sampleCount: samples.length,
  }
}

function validateNumericSamples(samples) {
  for (const sample of samples) {
    for (const field of ['rss_bytes', 'cpu_elapsed_ms', 'elapsed_ms']) {
      const value = sample[field]
      if (value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error(`Invalid numeric sampler field: ${field}`)
      }
    }
  }
}

export function validateSampleWindow(samples, { now = Date.now(), durationMs = 0 } = {}) {
  if (!samples.length) throw new Error('Sampler produced no complete rows')
  validateNumericSamples(samples)
  const last = samples.at(-1)
  if (String(last.root_alive).toLowerCase() !== 'true') throw new Error('Sampled root process is no longer alive')
  const timestamp = Date.parse(last.timestamp_utc)
  if (!Number.isFinite(timestamp) || now - timestamp > 5000) throw new Error('Sampler last row is stale')
  const tolerance = Math.min(1000, durationMs * 0.02 + 200)
  if (Number(last.elapsed_ms) < durationMs - tolerance) throw new Error('Sampler duration is shorter than the requested idle window')
}

export function fixturePath(name) {
  const fixture = name.replace(/\.md$/, '')
  if (MATRIX.includes(fixture)) return join(REPO_ROOT, 'fixtures/generated', `${fixture}.md`)
  if (FIXTURES.includes(fixture)) return join(REPO_ROOT, 'fixtures', `${fixture}.md`)
  throw new Error(`Unknown fixture: ${name}`)
}

// Export-Csv has no embedded newlines in sampler fields. Ignore an unfinished last
// line if the runner stops the owned sampler between writes.
export function readSamplerCsv(content) {
  const lines = content.replace(/^\ufeff/, '').split(/\r?\n/)
  const parse = (line) => line.split(',').map((value) => value.replace(/^"|"$/g, '').replaceAll('""', '"'))
  const headers = parse(lines.shift() ?? '')
  return lines.filter((line) => line.endsWith('"')).map(parse)
    .filter((values) => values.length === headers.length)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])))
}

const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  const exited = new Promise((done) => child.once('exit', done))
  await Promise.race([exited, delay(3000, undefined, { ref: false })])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function startSampler(browser, directory, label, signal) {
  if (process.platform !== 'win32') return { note: 'RSS/CPU not measured: Windows sampler required' }
  let session
  let child
  try {
    session = await browser.newBrowserCDPSession()
    const processes = await session.send('SystemInfo.getProcessInfo')
    const root = processes.processInfo.find((entry) => entry.type === 'browser')
    if (!root) throw new Error('CDP did not return browser PID')
    const output = join(directory, `${label}.csv`)
    const script = quotePowerShell(join(REPO_ROOT, 'src/bench/sample-tree.ps1'))
    const command = `& ([scriptblock]::Create([IO.File]::ReadAllText(${script}))) -RootProcessId ${Number(root.id)} -DurationSeconds 86400 -IntervalMs 200 -OutFile ${quotePowerShell(output)}`
    child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    })
    let errors = ''
    child.stderr.on('data', (data) => { errors += data.toString() })
    child.on('error', (error) => { errors += error.message })
    const sampler = { child, output, note: `browser process-tree RSS; CDP root PID=${root.id}` }
    // Wait for the first sample so CPU deltas have a baseline before the action.
    const deadline = Date.now() + 15000
    while (!existsSync(output) && Date.now() < deadline && child.exitCode === null) await delay(100, undefined, { signal })
    if (!existsSync(output)) {
      await stopOwnedChild(child)
      return { note: `RSS/CPU not measured: ${errors.trim() || 'sampler did not start'}` }
    }
    return sampler
  } catch (error) {
    await stopOwnedChild(child)
    signal?.throwIfAborted()
    return { note: `RSS/CPU not measured: ${error.message}` }
  } finally {
    await session?.detach().catch(() => {})
  }
}

async function samplerSnapshot(sampler, durationMs = 0) {
  if (!sampler.output) return summarizeSamples([])
  if (sampler.child && (sampler.child.exitCode !== null || sampler.child.signalCode !== null)) throw new Error('Sampler exited before the measurement ended')
  const samples = readSamplerCsv(await readFile(sampler.output, 'utf8'))
  validateSampleWindow(samples, { durationMs })
  return { ...summarizeSamples(samples), method: samples.at(-1)?.method }
}

export async function withTimeout(promise, milliseconds, label, signal) {
  let timer
  let onAbort
  if (signal?.aborted) {
    void Promise.resolve(promise).catch(() => {})
    throw signal.reason
  }
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds)
      }),
      new Promise((_, reject) => {
        onAbort = () => reject(signal.reason)
        signal?.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

async function startServer(options) {
  if (options.baseUrl) return { url: options.baseUrl }
  const requireUi = createRequire(join(REPO_ROOT, 'src/ui/package.json'))
  const vitePath = join(dirname(requireUi.resolve('vite/package.json')), 'bin/vite.js')
  const child = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', String(options.port), '--strictPort'], {
    cwd: join(REPO_ROOT, 'src/ui'), windowsHide: true,
    env: { ...process.env, VITE_M0_BENCH: '1', VITE_IPC_MOCK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { log = (log + data.toString()).slice(-8000) })
  child.on('error', (error) => { log += error.message })
  const url = `http://127.0.0.1:${options.port}/`
  try {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Vite exited (${child.exitCode}): ${log}`)
      try {
        if (log.includes('Local:')) {
          const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
          if (response.ok) return { child, url }
        }
      } catch { /* Startup is not ready yet. */ }
      await delay(200, undefined, { signal: options.signal })
    }
    throw new Error(`Vite startup timed out: ${log}`)
  } catch (error) {
    await stopOwnedChild(child)
    throw error
  }
}

async function loadFixture(name) {
  const path = fixturePath(name)
  if (!existsSync(path) && MATRIX.includes(name)) {
    const group = ['100kb', '1mb', '10mb', '50mb'].includes(name) ? 'large' : 'special'
    const result = spawnSync(process.execPath, ['src/bench/gen-fixtures.mjs', '--only', group], {
      cwd: REPO_ROOT, windowsHide: true, encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(`Fixture generation failed: ${result.stderr || result.error}`)
  }
  return readFile(path, 'utf8')
}

function findBrowserPath(chromium, explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Browser executable not found: ${explicit}`)
    return explicit
  }
  const expected = chromium.executablePath()
  if (existsSync(expected)) return expected
  // The desktop runner can redirect LOCALAPPDATA. Reuse only the installed same
  // Playwright revision under the user profile; never install a browser here.
  const revision = expected.match(/chromium-\d+/)?.[0]
  const installed = revision && join(homedir(), 'AppData/Local/ms-playwright', revision, 'chrome-win64/chrome.exe')
  if (installed && existsSync(installed)) return installed
  throw new Error(`Playwright browser unavailable (${expected}); use --browser-path with an existing executable. No browser was installed.`)
}

async function waitForBridge(page, options) {
  await page.waitForFunction(() => typeof window.__M0__?.openText === 'function', null, { timeout: options.timeoutMs })
}

async function openText(page, text, name, options) {
  const metrics = await withTimeout(page.evaluate(({ source, filename }) => window.__M0__.openText(source, filename), {
    source: text, filename: `${name}.md`,
  }), options.timeoutMs, `open ${name}`, options.signal)
  if (metrics.mermaidCount > 0 || await page.evaluate(() => (window.__M0__.stats().segments ?? 0) > 0)) {
    metrics.graphs = await withTimeout(page.evaluate(async () => {
      const started = performance.now()
      const completed = await window.__M0__.renderAll()
      return { elapsedMs: performance.now() - started, ...completed.graphs,
        visitedSegments: completed.visitedSegments, totalSegments: completed.totalSegments, cancelled: completed.cancelled }
    }), options.timeoutMs, `full traversal ${name}`, options.signal)
  }
  return metrics
}

async function interactions(page) {
  const frames = await page.evaluate(async () => {
    const scroller = document.querySelector('.reader-scroll')
    if (!scroller) throw new Error('Missing .reader-scroll')
    const durations = []
    for (let index = 0; index < 100; index += 1) {
      const start = performance.now()
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * ((index % 10) / 9)
      await new Promise(requestAnimationFrame)
      durations.push(performance.now() - start)
    }
    scroller.scrollTop = 0
    return durations
  })
  return percentile(frames, 95)
}

function round(value) { return value === null || value === undefined ? null : Math.round(value * 1000) / 1000 }

function resultRow(context, metrics = {}, resources = {}, notes = '') {
  return {
    date: context.date, commit: context.commit, scenario: context.scenario,
    fixture: context.fixture, cold_or_warm: context.temperature,
    first_paint_ms: round(metrics.firstPaintMs), full_render_ms: round(metrics.fullRenderMs),
    p95_interaction_ms: round(metrics.p95), rss_peak_mb: round(resources.rssPeakMb),
    rss_stable_mb: round(resources.rssStableMb), idle_cpu_pct: round(resources.cpuPct),
    notes: `browser Chromium ${context.browserVersion}; Vite dev; viewport=1440x900; ui_source_sha256=${context.uiFingerprint ?? 'unknown'}; native WebView2 startup/IPC not measured; ${context.dependenciesWarmed ? 'dev dependencies warmed in discarded context; ' : ''}${notes}`,
  }
}

async function warmDevDependencies(browser, url, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(options.timeoutMs)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(url, { waitUntil: 'networkidle' })
      await waitForBridge(page, options)
      try {
        await openText(page, '# Dependency preparation\n\n$x^2$\n\n```mermaid\ngraph LR\n A-->B\n```', 'dependency-preparation', options)
        await page.waitForLoadState('networkidle')
        return
      } catch (error) {
        if (attempt === 2 || !/Execution context was destroyed|navigation/i.test(error.message)) throw error
      }
    }
  } finally { await context.close() }
}

async function runLifecycle(page, options, fixture, text, sampler, collect) {
  let baseline = null
  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const metrics = await openText(page, text, fixture, options)
    await page.evaluate(() => window.__M0__.close())
    if (iteration !== 5 && iteration % 10 !== 0 && iteration !== options.iterations) continue
    await delay(5000, undefined, { signal: options.signal })
    const resources = await samplerSnapshot(sampler)
    if (iteration === 5) baseline = resources.rssStableMb
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null)
    const ratio = baseline && resources.rssStableMb ? resources.rssStableMb / baseline : null
    await collect(metrics, `open-close iteration=${iteration}; 5s settle; heap_used_bytes=${heap}; RSS baseline iteration5 MB=${round(baseline)}; RSS ratio to iteration5=${round(ratio)}; no forced GC; browser-only ratio target<=1.3`, false, resources)
  }
}

async function runReload(page, options, fixture, text, collect) {
  const before = await page.evaluate(() => window.__M0__.stats())
  let metrics
  for (let version = 1; version <= 3; version += 1) {
    metrics = await openText(page, `${text}\n\nM0-RELOAD-${version}`, fixture, options)
  }
  const status = await page.evaluate(() => ({
    stats: window.__M0__.stats(), lastVersionVisible: document.querySelector('.md-doc')?.textContent.includes('M0-RELOAD-3'),
  }))
  if (!status.lastVersionVisible) throw new Error('Manual content replacement did not display the last version')
  await collect(metrics, `manual openText replacement x3; parse_count_delta=${status.stats.parseCount - before.parseCount}; real OS watcher overwrite/atomic replace/burst not measured`)
}

export function validateThemeSample(sample, appTheme, mdTheme) {
  if (sample.appTheme !== appTheme) throw new Error(`App theme did not apply: ${appTheme}`)
  if (sample.mdTheme !== mdTheme) throw new Error(`Markdown theme did not apply: ${mdTheme}`)
}

async function runIsolation(page, metrics, collect) {
  const before = await page.evaluate(() => window.__M0__.stats())
  const samples = []
  for (const appTheme of ['light', 'dark']) {
    await page.getByTestId('app-theme').selectOption(appTheme)
    for (const mdTheme of ['light', 'dark', 'paper']) {
      await page.getByTestId('md-theme').selectOption(mdTheme)
      const sample = await page.evaluate(() => {
        const article = document.querySelector('.md-doc')
        const control = document.querySelector('[data-testid="app-theme"]')
        const style = getComputedStyle(article)
        const appStyle = getComputedStyle(control)
        return {
          appTheme: document.documentElement.dataset.appTheme,
          mdTheme: article.dataset.mdTheme,
          articleColor: style.color, articleBackground: style.backgroundColor,
          controlColor: appStyle.color, controlFont: appStyle.fontFamily,
        }
      })
      validateThemeSample(sample, appTheme, mdTheme)
      samples.push(sample)
    }
  }
  const after = await page.evaluate(() => window.__M0__.stats())
  if (after.parseCount !== before.parseCount || after.parseMs !== before.parseMs) throw new Error('Theme change reparsed the document')
  for (const appTheme of ['light', 'dark']) {
    const group = samples.filter((sample) => sample.appTheme === appTheme)
    if (group.length !== 3) throw new Error(`App theme did not apply: ${appTheme}`)
    if (new Set(group.map((sample) => `${sample.controlColor}/${sample.controlFont}`)).size !== 1) {
      throw new Error(`Markdown theme changed app control styles: ${appTheme}`)
    }
  }
  await collect(metrics, `themes x6; parseCount/parseMs unchanged; computed_styles=${JSON.stringify(samples)}; namespace implementation only; Shadow DOM A/B not measured`)
}

async function runScenario(page, browser, options, context, directory) {
  const rows = []
  let measured = {}
  if (options.scenario === 'idle') {
    await page.evaluate(() => window.__M0__.close())
    if (context.fixture !== 'none') await openText(page, await loadFixture(context.fixture), context.fixture, options)
    await delay(5000, undefined, { signal: options.signal })
  }
  const sampler = await startSampler(browser, directory, `${options.scenario}-${context.fixture}-${Date.now()}`, options.signal)
  const notes = () => `${sampler.note}; CPU=one logical core 100%; RSS interval=200ms plus query cost, shared pages counted per process`
  const collect = async (metrics, extra = '', cpu = false, existingResources) => {
    const resources = existingResources ?? await samplerSnapshot(sampler, cpu ? options.idleSeconds * 1000 : 0)
    if (!cpu) resources.cpuPct = null
    rows.push(resultRow(context, metrics, resources, `${notes()}; sampler=${resources.method ?? 'unavailable'}; sample_count=${resources.sampleCount}; ${extra}`))
  }
  try {
    if (options.scenario === 'idle') {
      await delay(options.idleSeconds * 1000, undefined, { signal: options.signal })
      await collect({}, `${context.fixture === 'none' ? 'empty shell' : 'opened document'} idle ${options.idleSeconds}s after 5s settle; cpu_elapsed_ms=${(await samplerSnapshot(sampler)).cpuMs}`, true)
      return rows
    }
    const text = await loadFixture(context.fixture)
    if (options.scenario === 'lifecycle') {
      await runLifecycle(page, options, context.fixture, text, sampler, collect)
      return rows
    }
    if (options.scenario === 'reload') {
      await runReload(page, options, context.fixture, text, collect)
      return rows
    }
    const metrics = await openText(page, text, context.fixture, options)
    measured = metrics
    if (options.scenario === 'isolation') {
      await runIsolation(page, metrics, collect)
      return rows
    }
    metrics.p95 = await withTimeout(interactions(page), options.timeoutMs, `scroll ${context.fixture}`, options.signal)
    await delay(1000, undefined, { signal: options.signal })
    const graphsComplete = metrics.graphs ? !metrics.graphs.cancelled && metrics.graphs.pending === 0 && metrics.graphs.error === 0 && metrics.graphs.done === metrics.mermaidCount : 'n/a'
    await collect(metrics, `fixture UTF8 bytes=${Buffer.byteLength(text)}; parse_ms=${round(metrics.parseMs)}; html_bytes=${metrics.htmlBytes}; mermaid_count=${metrics.mermaidCount}; full_render_ms=full DOM+two-rAF ready only, null for segmented documents whose unseen segments remain deferred; all_graphs=${JSON.stringify(metrics.graphs ?? null)}; graphs_complete=${graphsComplete}; firstPaint/fullRender measured from openText only; scroll-to-rAF x100 P95; cold/warm refers to first/subsequent fixture in a fresh browser context`)
    return rows
  } catch (error) {
    error.measured = measured
    error.resources = await samplerSnapshot(sampler).catch(() => ({}))
    if (options.scenario !== 'idle') error.resources.cpuPct = null
    error.samplerNote = sampler.note
    throw error
  } finally { await stopOwnedChild(sampler.child) }
}

async function runFixture(browser, url, options, fixture, directory, revision) {
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const context = {
    date: new Date().toISOString(), commit: revision, scenario: options.scenario,
    fixture, temperature: 'cold', browserVersion: browser.version(), dependenciesWarmed: true,
    uiFingerprint: options.uiFingerprint,
  }
  const events = []
  try {
    const page = await browserContext.newPage()
    page.on('crash', () => events.push('page-crash'))
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) events.push(`navigation:${frame.url()}`)
    })
    page.setDefaultTimeout(options.timeoutMs)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await waitForBridge(page, options)
    const temperatures = ['open', 'matrix'].includes(options.scenario) && !options.coldOnly ? ['cold', 'warm'] : ['cold']
    for (const temperature of temperatures) {
      context.temperature = temperature
      const rows = await runScenario(page, browser, { ...options, scenario: options.scenario === 'matrix' ? 'open' : options.scenario }, context, directory)
      await appendResults(options.output, rows)
      for (const row of rows) console.log(csvRow(row))
    }
  } catch (error) {
    await appendResults(options.output, [resultRow(context, error.measured ?? {}, error.resources ?? {}, `FAILED; only completed stage measurements retained, unavailable stages blank; ${error.samplerNote ?? ''}; ${error.message}; events=${JSON.stringify(events)}`)])
    throw error
  } finally { await browserContext.close() }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const controller = new AbortController()
  options.signal = controller.signal
  if (options.help) {
    console.log('Usage: node src/bench/web-bench.mjs --scenario idle|open|matrix|reload|lifecycle|isolation --fixture 100kb|1mb|10mb|50mb|mermaid-100|code-heavy|math-heavy|basic|extended|cjk-typography|theme|html-safety|links [--cold-only] [--base-url http://127.0.0.1:1420] [--port 1421] [--browser-path PATH] [--output benchmarks/results.csv] [--idle-seconds 60] [--iterations 50] [--timeout-ms 180000]')
    return
  }
  const { chromium } = await import('@playwright/test')
  const executablePath = findBrowserPath(chromium, options.browserPath)
  const directory = await mkdtemp(join(tmpdir(), 'markdown-bench-'))
  const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true })
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true }).stdout?.trim()
  const revision = `${commitResult.stdout?.trim() || 'unknown'}${dirty ? '-dirty' : ''}`
  let server
  let browser
  const onInterrupt = () => {
    controller.abort(new Error('Benchmark interrupted'))
    void browser?.close().catch(() => {})
  }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  try {
    server = await startServer(options)
    options.signal.throwIfAborted()
    browser = await chromium.launch({ headless: true, executablePath })
    options.signal.throwIfAborted()
    await warmDevDependencies(browser, server.url, options)
    options.uiFingerprint = await getUiFingerprint()
    const fixtures = options.scenario === 'matrix' ? MATRIX : [options.fixture]
    for (const fixture of fixtures) {
      await runFixture(browser, server.url, options, fixture, directory, revision)
    }
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
    await browser?.close().catch(() => {})
    await stopOwnedChild(server?.child)
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
