const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')
const policy = require('./terminal-policy.cjs')
const backend = require('./backend-policy.cjs')
const agents = require('./agents-policy.cjs')
const workbench = require('./workbench-policy.cjs')

const upstream = resolve(__dirname, '../../../artifacts/code-oss/upstream')
const tsPath = resolve(upstream, 'node_modules/typescript')
const available = existsSync(tsPath)
const revision = '6bab64e2d12b04d04c0d99c27ff166023efd1dda'

function pinnedSource(path) {
  return execFileSync('git', ['show', `${revision}:${path}`], { cwd: upstream, encoding: 'utf8' })
}

test('Reader desktop drops the local PTY but preserves external terminal registration', { skip: !available }, () => {
  const ts = require(tsPath)
  const patched = new Map()
  for (const [path, patch] of Object.entries(policy.sourcePatches)) {
    let source = pinnedSource(path)
    for (const previous of [backend, agents]) source = previous.sourcePatches[path]?.(source, ts) ?? source
    const generated = patch(source)
    assert.notEqual(generated, source, path)
    assert.deepEqual(ts.createSourceFile(path, generated, ts.ScriptTarget.Latest, true).parseDiagnostics, [], path)
    patched.set(path, generated)
  }
  const app = patched.get('src/vs/code/electron-main/app.ts')
  assert.doesNotMatch(app, /ptyHost|ILocalPtyService|TerminalIpcChannels/i)
  assert.match(app, /new SyncDescriptor\(WindowsExternalTerminalService\)/)
  assert.match(app, /registerChannel\('externalTerminal', externalTerminalChannel\)/)
  assert.match(app, /sharedProcessReady,?\s*\]\);/)
  const entries = patched.get('build/next/index.ts')
  assert.doesNotMatch(entries.split('const serverEntryPoints')[0], /terminal\/node\/ptyHostMain/)
  assert.match(entries.split('const serverEntryPoints')[1], /terminal\/node\/ptyHostMain/)
  const resources = patched.get('build/next/resources.ts').split('const serverResourcePatterns')[0]
  assert.doesNotMatch(resources, /contrib\/terminal\/common\/scripts\//)
  assert.match(resources, /contrib\/externalTerminal\/\*\*\/\*\.scpt/)

  const contribution = 'contrib/terminal/electron-browser/terminal.contribution.ts'
  const generated = workbench.generateServiceContribution(pinnedSource(`src/vs/workbench/${contribution}`), ts, contribution)
  const desktop = policy.patchDesktopContribution(generated)
  assert.doesNotMatch(desktop, /ILocalPtyService|registerMainProcessRemoteService/)
  assert.match(desktop, /registerSingleton\(ITerminalProfileResolverService,/)
})
