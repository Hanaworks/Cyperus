const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function waitFor(predicate, label) {
  const until = Date.now() + 15000
  while (Date.now() < until) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw Error(`Timed out: ${label}`)
}

async function stableReadingSnapshot(document, tabs, history, label) {
  const started = Date.now()
  const stableFor = 1500
  let previous = ''
  let changedAt = 0
  let snapshot
  // Search first reports its query, then scrolls; position reports arrive on
  // later animation frames while content-visibility resolves intrinsic sizes.
  // One ready/position event is therefore not a settled persistence boundary.
  await waitFor(() => {
    const current = document()
    const state = current?.state
    if (!current?.result || current.rendered !== current.version || current.matches?.total !== 1
      || state?.query !== 'Paragraph 80' || !(state.scrollTop > 100) || !state.anchor) {
      previous = ''; changedAt = 0
      return false
    }
    const serialized = JSON.stringify({ tabs: tabs(), state })
    if (serialized !== previous) {
      previous = serialized
      changedAt = Date.now()
      snapshot = JSON.parse(serialized)
      history.push({ elapsedMs: changedAt - started, ...snapshot })
      if (history.length > 40) history.shift()
    }
    return Date.now() - changedAt >= stableFor
  }, label)
  return snapshot
}

async function run() {
  const phase = process.env.MD_READER_SESSION_PHASE
  assert.ok(['prepare', 'restore'].includes(phase))
  const root = process.env.MD_READER_TEST_ROOT
  assert.ok(root)
  const extension = vscode.extensions.getExtension('local-md-reader.md-reader-experiment')
  const api = await extension.activate()
  const first = vscode.Uri.file(path.join(root, 'session-first.md'))
  const second = vscode.Uri.file(path.join(root, 'session-second.md'))
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => ({ name: tab.label, type: tab.input?.viewType }))
  const document = () => api.documents.get(second.toString())
  const stability = []
  try {
    assert.equal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.toLowerCase(), path.resolve(root).toLowerCase())
    if (phase === 'prepare') {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await fs.writeFile(first.fsPath, '# First saved tab\n')
      await fs.writeFile(second.fsPath, Array.from({ length: 120 }, (_, i) => `## Section ${i}\n\nParagraph ${i}\n\n`).join(''))
      await api.openFile(first.fsPath)
      await api.openFile(second.fsPath)
      await waitFor(() => document()?.rendered === document()?.version && document()?.result, 'second tab rendered')
      api.send(document(), { type: 'search', query: 'Paragraph 80' })
      const settled = await stableReadingSnapshot(document, tabs, stability, 'reading position remains unchanged for 1500ms before shutdown')
      await fs.writeFile(path.join(root, 'session-expected.json'), JSON.stringify(settled, null, 2))
    } else {
      const expected = JSON.parse(await fs.readFile(path.join(root, 'session-expected.json'), 'utf8'))
      await waitFor(() => document()?.rendered === document()?.version && document()?.result, 'native session restores active preview')
      const restored = await stableReadingSnapshot(document, tabs, stability, 'restored position remains unchanged for 1500ms before comparison')
      assert.deepEqual(restored.tabs, expected.tabs)
      assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.toString(), second.toString())
      assert.equal(restored.state.anchor.text, expected.state.anchor.text)
      // Font/layout and content-visibility estimates can differ between processes;
      // the same paragraph and within-block ratio define the reading position.
      assert.equal(restored.state.anchor.line, expected.state.anchor.line)
      assert.ok(Math.abs(restored.state.anchor.ratio - expected.state.anchor.ratio) < 0.05)
      assert.ok(restored.state.scrollTop > 100)
    }
    await fs.writeFile(path.join(root, `session-${phase}.json`), JSON.stringify({ passed: true, phase, workspace: vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()), tabs: tabs(), state: document()?.state, stability, time: new Date().toISOString() }, null, 2))
  } catch (error) {
    await fs.writeFile(path.join(root, `session-${phase}.json`), JSON.stringify({ passed: false, error: String(error.stack ?? error), workspace: vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()), tabs: tabs(), state: document()?.state, stability }, null, 2))
    throw error
  }
}
module.exports = { run }
