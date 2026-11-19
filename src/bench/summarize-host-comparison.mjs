import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const directory = path.resolve(process.argv[2] ?? '')
const complete = JSON.parse(await readFile(path.join(directory, 'complete.json'), 'utf8').then(s => s.replace(/^\uFEFF/, '')))
const runs = JSON.parse(await readFile(path.join(directory, 'runs.json'), 'utf8').then(s => s.replace(/^\uFEFF/, '')))
if (!complete.complete || runs.length !== complete.runs || runs.length !== complete.rounds * complete.files.length * 2) throw Error('Incomplete comparison matrix')
function stats(values) {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw Error('Missing or invalid measurement')
  const sorted = values.toSorted((a, b) => a - b)
  const center = Math.floor(sorted.length / 2)
  const round = value => Math.round(value * 100) / 100
  return { count: values.length, median: round(sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2), min: round(sorted[0]), max: round(sorted.at(-1)) }
}
const groups = []
for (const file of complete.files) for (const hostKind of ['tauri', 'code-oss']) {
  const selected = runs.filter(r => r.file === file && r.hostKind === hostKind)
  if (selected.length !== complete.rounds || selected.some(r => !r.probe.complete || r.probe.errors.length)) throw Error('Probe failure')
  const measurements = selected.flatMap(r => r.probe.measurements)
  if (measurements.some(m => m.completion.cancelled || m.completion.visitedSegments !== m.completion.totalSegments || m.completion.graphs.pending)) throw Error('Incomplete rendering')
  const byTemperature = temp => measurements.filter(m => m.temperature === temp)
  groups.push({ file, hostKind,
    startupMs: stats(selected.map(r => r.processToFirstReadableMs)),
    activePeakMiB: stats(selected.map(r => r.activePeakMiB)),
    coldOpenMs: stats(byTemperature('cold').map(m => m.firstReadableMs)),
    warmOpenMs: stats(byTemperature('warm').map(m => m.firstReadableMs)),
    coldParseMs: stats(byTemperature('cold').map(m => m.parseMs)),
    coldFullRenderMs: stats(byTemperature('cold').map(m => m.fullRenderMs)),
    warmFullRenderMs: stats(byTemperature('warm').map(m => m.fullRenderMs)),
    scrollRafP95Ms: stats(measurements.map(m => m.scrollRafP95Ms)),
    ...(selected.every(r => r.idle) ? {
      idleRssMiB: stats(selected.map(r => r.idle.rssMedianMiB)),
      idleOneCoreCpuPct: stats(selected.map(r => r.idle.oneCoreCpuPct)),
      idleDurationMs: stats(selected.map(r => r.idle.durationMs)),
    } : {}),
  })
}
const summary = { directory, rounds: complete.rounds, groups }
await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2))
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
