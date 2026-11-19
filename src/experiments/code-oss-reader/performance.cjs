// Opt-in, isolated measurement of the same ReaderView operations as the Tauri M1 probe.
const vscode = require('vscode')
const fs = require('node:fs/promises')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

async function waitFor(check, label, timeout = 180000) {
  const deadline = performance.now() + timeout
  while (!check()) {
    if (performance.now() > deadline) throw Error(`Timed out: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function run(api, configPath) {
  const reportPath = path.join(path.dirname(configPath), 'report.json')
  const report = { complete: false, errors: [], measurements: [], appName: vscode.env.appName,
    appRoot: vscode.env.appRoot, vscode: vscode.version, node: process.versions.node }
  const publish = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2))
  try {
    const config = JSON.parse((await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''))
    const file = await fs.realpath(config.file)
    for (const temperature of ['cold', 'warm']) {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await waitFor(() => api.documents.size === 0, 'closed documents')
      const openedAt = new Date().toISOString()
      const start = performance.now()
      await api.openFile(file)
      const doc = api.documents.get(vscode.Uri.file(file).toString())
      await waitFor(() => doc?.error || (doc?.result && doc.rendered === doc.version), 'readable document')
      if (doc.error) throw Error(doc.error)
      const firstReadableAt = doc.renderedAt
      if (!firstReadableAt) throw Error('Missing visible-reader timestamp')
      report.firstReadableAt ??= firstReadableAt
      const firstReadableMs = Date.parse(firstReadableAt) - Date.parse(openedAt)
      const id = report.measurements.length + 1
      api.send(doc, { type: 'benchmark', id })
      await waitFor(() => doc.benchmark?.id === id, 'full traversal and scrolling')
      const measured = doc.benchmark
      if (measured.error) throw Error(measured.error)
      const completion = measured.completion
      if (completion.cancelled || completion.visitedSegments !== completion.totalSegments || completion.graphs.pending) throw Error('Incomplete traversal')
      report.viewport = measured.viewport
      report.measurements.push({ path: file, temperature, openedAt, firstReadableAt,
        completedAt: measured.completedAt, firstReadableMs, parseMs: doc.result.parseMs,
        fullTraversalMs: measured.fullTraversalMs,
        fullRenderMs: Date.parse(measured.completedAt) - Date.parse(openedAt),
        completion, htmlBytes: doc.result.htmlBytes, segments: doc.result.segments?.length ?? 0,
        mountedElements: measured.mountedElements, scrollRafP95Ms: measured.scrollRafP95Ms,
        probeWallMs: performance.now() - start })
      report.stage = 'measuring'
      await publish()
    }
    // Match the Tauri probe's final idle document, regardless of measured file size.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    const small = await fs.realpath(path.join(__dirname, '../../../fixtures/generated/100kb.md'))
    await api.openFile(small)
    const doc = api.documents.get(vscode.Uri.file(small).toString())
    await waitFor(() => doc?.error || (doc?.result && doc.rendered === doc.version), 'idle document')
    if (doc.error) throw Error(doc.error)
    report.stage = 'idle-ready'
  } catch (error) { report.errors.push(String(error.stack ?? error)); report.stage = 'failed' }
  report.complete = true
  report.completedAt = new Date().toISOString()
  await publish()
}

module.exports = { run }
