const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const path = require('node:path')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const upstreamRequire = createRequire(path.resolve(__dirname, '../../../artifacts/code-oss/upstream/package.json'))
const ts = upstreamRequire('typescript')
let policy
try { policy = require('./workbench-policy.cjs') } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }

test('service contribution keeps extension API services without running feature UI or eager startup', () => {
  assert.equal(typeof policy?.generateServiceContribution, 'function')
  const source = `
import './feature-ui.js';
import { registerSingleton, InstantiationType } from './registry.js';
import { IService, Service, UnusedAction } from './service.js';
import { registerAction } from './actions.js';
registerSingleton(IService, Service, InstantiationType.Eager);
registerAction(UnusedAction);
`
  const generated = policy.generateServiceContribution(source, ts, 'fixture.ts')
  const calls = []
  const registry = { registerSingleton: (...args) => calls.push(args), InstantiationType: { Eager: 'eager', Delayed: 'delayed' } }
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(generated, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, module,
    require(id) {
      if (id === './registry.js') return registry
      if (id === './service.js') return { IService: 'service-id', Service: 'service-implementation' }
      throw Error(`Feature UI must not load: ${id}`)
    },
  })
  assert.deepEqual(calls, [['service-id', 'service-implementation', 'delayed']])
})

test('native service contribution retains IPC registration needed by internal extension services', () => {
  assert.equal(typeof policy?.generateServiceContribution, 'function')
  const source = `
import { registerMainProcessRemoteService } from './registry.js';
import { ILocalPtyService, TerminalIpcChannels } from './service.js';
registerMainProcessRemoteService(ILocalPtyService, TerminalIpcChannels.LocalPty);
`
  const calls = []
  const module = { exports: {} }
  const generated = policy.generateServiceContribution(source, ts, 'native.ts')
  vm.runInNewContext(ts.transpileModule(generated, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, module,
    require: id => id === './registry.js' ? { registerMainProcessRemoteService: (...args) => calls.push(args) } : { ILocalPtyService: 'pty', TerminalIpcChannels: { LocalPty: 'local-pty' } },
  })
  assert.deepEqual(calls, [['pty', 'local-pty']])
})

test('terminal compatibility keeps explicit extension-point services and configuration defaults', () => {
  const source = `
import { registerSingleton } from './registry.js';
import { IService, Service } from './service.js';
import { registerConfiguration } from './configuration.js';
registerSingleton(IService, Service, false);
registerConfiguration();
`
  const calls = []
  const module = { exports: {} }
  const generated = policy.generateServiceContribution(source, ts, 'terminal.ts', {
    retainCalls: ['registerConfiguration'], sideEffectImports: ['./extension-points.js'],
  })
  vm.runInNewContext(ts.transpileModule(generated, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, module,
    require(id) {
      if (id === './registry.js') return { registerSingleton: () => calls.push('service') }
      if (id === './service.js') return { IService: 'id', Service: 'implementation' }
      if (id === './configuration.js') return { registerConfiguration: () => calls.push('configuration') }
      if (id === './extension-points.js') { calls.push('extension-points'); return {} }
      throw Error(`Unexpected module: ${id}`)
    },
  })
  assert.deepEqual(calls, ['extension-points', 'service', 'configuration'])
})

test('service extraction stops for a source change requiring local declarations', () => {
  assert.equal(typeof policy?.generateServiceContribution, 'function')
  assert.throws(() => policy.generateServiceContribution(`
import { registerSingleton } from './registry.js';
import { IService } from './service.js';
class LocalService {}
registerSingleton(IService, LocalService, false);
`, ts, 'changed.ts'), /LocalService/)
})

test('entry patch preserves reading imports, repeats safely and rejects upstream drift', () => {
  assert.equal(typeof policy?.patchEntryImports, 'function')
  const source = "import './files.js';\r\nimport './debug.js';\r\nimport './search.js';\r\n"
  const replacements = { './debug.js': './debug.service.js' }
  const result = policy.patchEntryImports(source, replacements, 'entry.ts')
  assert.equal(result, "import './files.js';\r\nimport './debug.service.js';\r\nimport './search.js';\r\n")
  assert.equal(policy.patchEntryImports(result, replacements, 'entry.ts'), result)
  assert.throws(() => policy.patchEntryImports(source.replace('./debug.js', './unknown.js'), replacements, 'entry.ts'), /entry.ts/)
})

test('entry patch activates services when a prior trim omitted the whole feature', () => {
  assert.equal(typeof policy?.patchEntryImports, 'function')
  const result = policy.patchEntryImports("// Markdown Reader omitted: import './debug.js';\n", { './debug.js': './debug.service.js' }, 'entry.ts')
  assert.equal(result, "import './debug.service.js';\n")
  assert.throws(() => policy.patchEntryImports("import './debug.js';\nimport './debug.service.js';\n", { './debug.js': './debug.service.js' }, 'entry.ts'), /entry.ts/)
})

test('Reader retains the snippet service without loading the user-facing snippet contribution', () => {
  const original = './contrib/snippets/browser/snippets.contribution.js'
  const service = './contrib/snippets/browser/snippets.service.contribution.js'
  const replacement = policy.workbenchEntries['workbench.common.main.ts'][original]
  assert.equal(replacement, service)
  assert.equal(policy.patchEntryImports(`import '${original}';\n`, { [original]: replacement }, 'workbench.common.main.ts'), `import '${service}';\n`)
})

test('Reader debug services do not load command registrations or prompt with omitted commands', () => {
  const upstream = path.resolve(__dirname, '../../../artifacts/code-oss/upstream')
  for (const name of ['debugService', 'debugTaskRunner']) {
    const source = `src/vs/workbench/contrib/debug/browser/${name}.ts`
    const original = fs.readFileSync(path.join(upstream, source), 'utf8')
    const patch = policy.sourcePatches[source]
    const updated = patch(original)
    assert.equal(patch(updated), updated)
    const parsed = ts.createSourceFile(source, updated, ts.ScriptTarget.Latest, true)
    assert.deepEqual(parsed.parseDiagnostics, [])
    const imports = parsed.statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text)
    assert.ok(!imports.includes('./debugCommands.js'))
    assert.doesNotMatch(updated, /DEBUG_CONFIGURE_COMMAND_ID|debug\.installAdditionalDebuggers/)
    if (name === 'debugService') {
      assert.match(updated, /buttons: errorActions\.map/)
    } else {
      assert.match(updated, /Promise\.reject\(new Error\(errorMessage\)\)/)
    }
  }
})

test('reader account policy ignores old visibility storage and omits account menu toggles', () => {
  assert.equal(typeof policy?.patchAccountActions, 'function')
  const source = fs.readFileSync(path.resolve(__dirname, '../../../artifacts/code-oss/upstream/src/vs/workbench/browser/parts/globalCompositeBar.ts'), 'utf8')
  const updated = policy.patchAccountActions(source)
  assert.equal(policy.patchAccountActions(updated), updated)
  const parsed = ts.createSourceFile('accounts.ts', updated, ts.ScriptTarget.Latest, true)
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ['isAccountsActionVisible', 'simpleActivityContextMenuActions'].includes(node.name?.text))
  const globalBar = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GlobalCompositeBar')
  const contextMenu = globalBar.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'getContextMenuActions')
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(`${functions.map(node => node.getText(parsed)).join('\n')}\nexport const readMenus = simpleActivityContextMenuActions;\nexport class Bar { ${contextMenu.getText(parsed)} }`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, module,
    localize: (_key, label) => label, toAction: action => action,
    AccountsActivityActionViewItem: { ACCOUNTS_VISIBILITY_PREFERENCE_KEY: 'accounts' }, StorageScope: { PROFILE: 0 },
  })
  const storedVisible = { getBoolean: () => true }
  assert.equal(module.exports.isAccountsActionVisible(storedVisible), false)
  assert.equal(new module.exports.Bar().getContextMenuActions().length, 0)
  assert.deepEqual(Array.from(module.exports.readMenus(storedVisible, false), action => action.id), ['toggle.hideManage'])
})
