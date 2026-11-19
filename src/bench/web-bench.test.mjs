import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const bench = await import('./web-bench.mjs').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})

test('CSV retains all 12 fields and quotes commas, line breaks and quotes', () => {
  assert.equal(typeof bench.csvRow, 'function')
  assert.equal(bench.CSV_FIELDS.length, 12)
  assert.equal(
    bench.csvRow({ date: '2026-11-04', notes: 'browser, "dev"\nsecond line' }),
    '2026-11-04,,,,,,,,,,,"browser, ""dev""\nsecond line"',
  )
  assert.equal(bench.csvRow({ first_paint_ms: 0 }).split(',')[5], '0')
})

test('nearest-rank P95 leaves input intact and rejects invalid measurements', () => {
  assert.equal(typeof bench.percentile, 'function')
  const values = [10, 1, 4, 3, 2]
  assert.equal(bench.percentile(values, 95), 10)
  assert.deepEqual(values, [10, 1, 4, 3, 2])
  assert.equal(bench.percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95)
  assert.equal(bench.percentile([], 95), null)
  assert.throws(() => bench.percentile([Number.NaN], 95), /finite/)
  assert.throws(() => bench.percentile([1], 101), /percentile/)
})

test('CLI accepts explicit benchmark settings and refuses typos and missing values', () => {
  assert.equal(typeof bench.parseArgs, 'function')
  const args = bench.parseArgs([
    '--scenario', 'lifecycle', '--fixture', '1mb', '--base-url', 'http://127.0.0.1:1420',
    '--iterations', '50', '--idle-seconds', '60', '--output', 'benchmarks/custom.csv',
  ])
  assert.equal(args.scenario, 'lifecycle')
  assert.equal(args.fixture, '1mb')
  assert.equal(args.iterations, 50)
  assert.equal(args.idleSeconds, 60)
  assert.equal(args.baseUrl, 'http://127.0.0.1:1420/')
  assert.throws(() => bench.parseArgs(['--scenario', 'wat']), /scenario/)
  assert.throws(() => bench.parseArgs(['--fixture']), /value/)
  assert.throws(() => bench.parseArgs(['--iteratons', '2']), /Unknown/)
  assert.throws(() => bench.parseArgs(['--iterations', '0']), /positive/)
  assert.throws(() => bench.parseArgs(['--idle-seconds', 'NaN']), /positive/)
  assert.throws(() => bench.parseArgs(['--base-url', 'file:///tmp/a']), /HTTP/)
  assert.equal(bench.parseArgs(['--scenario', 'idle']).fixture, 'none')
  assert.equal(bench.parseArgs(['--scenario', 'idle', '--fixture', '100kb']).fixture, '100kb')
  assert.equal(bench.parseArgs(['--scenario', 'open', '--cold-only']).coldOnly, true)
  assert.equal(bench.parseArgs([]).coldOnly, false)
})

test('CSV append writes a single header and refuses a different schema', async () => {
  assert.equal(typeof bench.appendResults, 'function')
  const directory = await mkdtemp(join(tmpdir(), 'md-bench-test-'))
  const output = join(directory, 'results.csv')
  try {
    await bench.appendResults(output, [{ scenario: 'idle' }])
    await bench.appendResults(output, [{ scenario: 'open', fixture: '100kb' }])
    const content = await readFile(output, 'utf8')
    assert.equal(content.split('\n').length, 4)
    assert.equal(content.split('\n')[0], bench.CSV_FIELDS.join(','))
    await writeFile(output, 'unrelated,data\n')
    await assert.rejects(() => bench.appendResults(output, [{}]), /header/)
    assert.equal(await readFile(output, 'utf8'), 'unrelated,data\n')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('CSV append separates a header that has no trailing newline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'md-bench-test-'))
  const output = join(directory, 'results.csv')
  try {
    await writeFile(output, bench.CSV_FIELDS.join(','))
    await bench.appendResults(output, [{ scenario: 'idle' }])
    const lines = (await readFile(output, 'utf8')).trimEnd().split('\n')
    assert.equal(lines.length, 2)
    assert.equal(lines[1].split(',')[2], 'idle')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('resource summaries preserve blanks when sampler is unavailable', () => {
  assert.equal(typeof bench.summarizeSamples, 'function')
  assert.deepEqual(bench.summarizeSamples([]), {
    rssPeakMb: null, rssStableMb: null, cpuMs: null, cpuPct: null, sampleCount: 0,
  })
  const summary = bench.summarizeSamples([
    { rss_bytes: 1048576, cpu_elapsed_ms: 0, elapsed_ms: 0 },
    { rss_bytes: 3145728, cpu_elapsed_ms: 20, elapsed_ms: 1000 },
    { rss_bytes: 2097152, cpu_elapsed_ms: 30, elapsed_ms: 2000 },
  ])
  assert.equal(summary.rssPeakMb, 3)
  assert.equal(summary.rssStableMb, 2)
  assert.equal(summary.cpuMs, 30)
  assert.equal(summary.cpuPct, 1.5)
  assert.throws(() => bench.summarizeSamples([{ rss_bytes: '', cpu_elapsed_ms: '', elapsed_ms: '1000' }]), /numeric/i)
})

test('fixture resolution accepts named fixtures and rejects path traversal', () => {
  assert.equal(typeof bench.fixturePath, 'function')
  assert.equal(bench.fixturePath('100kb'), resolve('fixtures/generated/100kb.md'))
  assert.equal(bench.fixturePath('html-safety'), resolve('fixtures/html-safety.md'))
  assert.throws(() => bench.fixturePath('../../private'), /fixture/)
  assert.throws(() => bench.fixturePath('unknown'), /fixture/)
})

test('sampler CSV handles BOM, quoted fields and truncated final lines', () => {
  assert.equal(typeof bench.readSamplerCsv, 'function')
  assert.deepEqual(bench.readSamplerCsv('\ufeff"rss_bytes","elapsed_ms","cpu_elapsed_ms","method"\r\n"1048576","1000","20","CIM"\r\n"123'), [
    { rss_bytes: '1048576', elapsed_ms: '1000', cpu_elapsed_ms: '20', method: 'CIM' },
  ])
})

test('sample validity rejects dead roots, stale rows and incomplete idle windows', () => {
  assert.equal(typeof bench.validateSampleWindow, 'function')
  const now = Date.parse('2026-11-04T08:00:00Z')
  const row = { timestamp_utc: '2026-11-04T07:59:59.900Z', root_alive: 'True', rss_bytes: '10000', elapsed_ms: '59900', cpu_elapsed_ms: '20' }
  assert.doesNotThrow(() => bench.validateSampleWindow([row], { now, durationMs: 60000 }))
  assert.throws(() => bench.validateSampleWindow([{ ...row, root_alive: 'False' }], { now }), /root/i)
  assert.throws(() => bench.validateSampleWindow([{ ...row, elapsed_ms: '20' }], { now, durationMs: 60000 }), /duration/i)
  assert.throws(() => bench.validateSampleWindow([{ ...row, timestamp_utc: '2026-11-04T07:00:00Z' }], { now }), /stale/i)
  assert.throws(() => bench.validateSampleWindow([{ ...row, rss_bytes: 'NaN' }], { now }), /numeric/i)
  assert.throws(() => bench.validateSampleWindow([{ ...row, cpu_elapsed_ms: '' }], { now }), /numeric/i)
  assert.throws(() => bench.validateSampleWindow([{ ...row, cpu_elapsed_ms: '-1' }], { now }), /numeric/i)
})

test('theme verification rejects a control that does not change the requested document theme', () => {
  assert.equal(typeof bench.validateThemeSample, 'function')
  assert.doesNotThrow(() => bench.validateThemeSample({ appTheme: 'dark', mdTheme: 'paper' }, 'dark', 'paper'))
  assert.throws(() => bench.validateThemeSample({ appTheme: 'dark', mdTheme: 'light' }, 'dark', 'paper'), /Markdown theme/)
  assert.throws(() => bench.validateThemeSample({ appTheme: 'light', mdTheme: 'paper' }, 'dark', 'paper'), /App theme/)
})

test('abort interrupts an in-flight benchmark wait immediately', async () => {
  assert.equal(typeof bench.withTimeout, 'function')
  const controller = new AbortController()
  const pending = bench.withTimeout(new Promise(() => {}), 10000, 'test', controller.signal)
  controller.abort(new Error('benchmark cancelled'))
  await assert.rejects(pending, /benchmark cancelled/)
})

test('a pre-aborted wait consumes a rejected underlying request without an unhandled rejection', () => {
  const moduleUrl = new URL('./web-bench.mjs', import.meta.url).href
  const source = `import { withTimeout } from ${JSON.stringify(moduleUrl)}; const controller = new AbortController(); controller.abort(new Error('cancelled')); try { await withTimeout(Promise.reject(new Error('underlying request failed')), 100, 'test', controller.signal) } catch (error) { if (error.message !== 'cancelled') throw error } await new Promise(setImmediate)`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr)
})

test('source fingerprints are stable across input order and change with source bytes', () => {
  assert.equal(typeof bench.fingerprintSources, 'function')
  const entries = [{ path: 'App.vue', content: 'one' }, { path: 'ReaderView.vue', content: 'two' }]
  const hash = bench.fingerprintSources(entries)
  assert.match(hash, /^[a-f0-9]{16}$/)
  assert.equal(hash, bench.fingerprintSources([...entries].reverse()))
  assert.notEqual(hash, bench.fingerprintSources([{ path: 'App.vue', content: 'changed' }, entries[1]]))
  assert.equal(entries[0].path, 'App.vue')
})

test('CIM and fallback process creation timestamps have the same identity', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows sampler identity')
  const script = await readFile('src/bench/sample-tree.ps1', 'utf8')
  const start = script.indexOf('function Get-TreeProcessKey')
  assert.ok(start >= 0)
  const end = script.indexOf('\n}', start) + 2
  const functionCode = script.slice(start, end)
  const command = `${functionCode}\nGet-TreeProcessKey ([pscustomobject]@{ProcessId=123;CreationDate=([datetime]'2026-11-04T08:00:00.1234560Z').ToLocalTime()})\nGet-TreeProcessKey ([pscustomobject]@{ProcessId=123;CreationDate='2026-11-04T08:00:00.1234567Z'})`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr)
  const keys = result.stdout.trim().split(/\r?\n/)
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
})

test('PowerShell sampler samples a real process tree and produces numeric rows', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows process sampler')
  const directory = await mkdtemp(join(tmpdir(), 'md-tree-test-'))
  const output = join(directory, 'samples.csv')
  try {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`
    const command = `& ([scriptblock]::Create([IO.File]::ReadAllText(${quote(resolve('src/bench/sample-tree.ps1'))}))) -RootProcessId ${process.pid} -DurationSeconds 0.3 -IntervalMs 100 -OutFile ${quote(output)}`
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8', timeout: 30000,
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    const content = await readFile(output, 'utf8')
    assert.match(content, /rss_bytes/)
    assert.match(content, /cpu_elapsed_ms/)
    assert.ok(content.trim().split(/\r?\n/).length >= 3)
    const headers = content.split(/\r?\n/)[0].replaceAll('"', '').split(',')
    const row = content.split(/\r?\n/)[1].replaceAll('"', '').split(',')
    assert.ok(Number(row[headers.indexOf('rss_bytes')]) > 0)
    assert.ok(Number(row[headers.indexOf('process_count')]) >= 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
