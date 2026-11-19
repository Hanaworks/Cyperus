const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
const path = require('node:path')
const vm = require('node:vm')
const upstream = path.resolve(__dirname, '../../../artifacts/code-oss/upstream')
const ts = createRequire(path.join(upstream, 'package.json'))('typescript')
const entries = require('./workbench-policy.cjs')
let policy
try { policy = require('./backend-policy.cjs') } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }
const baseline = file => execFileSync('git', ['show', `HEAD:${file}`], { cwd: upstream, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
const parse = source => ts.createSourceFile('policy.ts', source, ts.ScriptTarget.Latest, true)
function code(source) {
  const file = parse(source)
  assert.deepEqual(file.parseDiagnostics, [])
  return file.statements.map(node => node.getText(file)).join('\n')
}

test('shared process cannot instantiate AI, remote or browser backends and keeps reader services', () => {
  assert.equal(typeof policy?.patchSharedProcess, 'function')
  const result = policy.patchSharedProcess(baseline('src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts'), ts)
  const executable = code(result)
  for (const name of ['SSHRemoteAgentHostMainService', 'DevContainerAgentHostMainService', 'WSLRemoteAgentHostMainService', 'TunnelAgentHostMainService', 'SharedTunnelsService', 'SharedProcessTunnelService', 'RemoteTunnelService', 'TunnelProcessCoordinator', 'PlaywrightChannel', 'AgentHostMcpOAuthMetadataService']) {
    assert.doesNotMatch(executable, new RegExp(`\\b${name}\\b`), name)
  }
  for (const name of ['LocalGitService', 'FileService', 'ExtensionsScannerService', 'SharedWebContentExtractorService', 'UserDataProfilesService']) assert.match(executable, new RegExp(`\\b${name}\\b`), name)
  assert.match(executable, /registerChannel\('localGit'/)
  assert.match(executable, /registerChannel\('languagePacks'/)
  assert.equal(policy.patchSharedProcess(result, ts), result)
})

test('main process has no agent process listener, prewarming or integrated browser creation', () => {
  assert.equal(typeof policy?.patchMainProcess, 'function')
  const result = policy.patchMainProcess(baseline('src/vs/code/electron-main/app.ts'), ts)
  const executable = code(result)
  for (const name of ['ElectronAgentHostStarter', 'AgentHostProcessManager', 'agentHostProcessManager', 'IBrowserViewMainService', 'BrowserViewMainService', 'IBrowserViewGroupMainService', 'BrowserViewGroupMainService', 'ipcBrowserViewChannelName', 'ipcBrowserViewGroupChannelName']) assert.doesNotMatch(executable, new RegExp(`\\b${name}\\b`), name)
  for (const name of ['IExtensionHostStarter', 'IWebviewManagerService', 'ILocalPtyService', 'IFileService', 'IKeyboardLayoutMainService']) assert.match(executable, new RegExp(`\\b${name}\\b`), name)
  assert.match(executable, /event\.preventDefault\(\)/)
  assert.equal(policy.patchMainProcess(result, ts), result)
})

test('inactive compatibility channels settle reads and reject attempts without starting anything', async () => {
  assert.equal(typeof policy?.disabledChannelsSource, 'string')
  const module = { exports: {} }
  const none = () => ({ dispose() {} })
  vm.runInNewContext(ts.transpileModule(policy.disabledChannelsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, module,
    require(id) {
      if (id.endsWith('/event.js')) return { Event: { None: none } }
      throw Error(`Disabled channels loaded a backend: ${id}`)
    },
  })
  const channels = new Map()
  module.exports.registerReaderDisabledChannels({ registerChannel: (name, channel) => channels.set(name, channel) })
  assert.deepEqual([...channels.keys()].sort(), ['remoteTunnel', 'sharedProcessTunnel'])
  const remote = channels.get('remoteTunnel')
  assert.equal(JSON.stringify(await remote.call(undefined, 'getTunnelStatus')), '{"type":"disconnected"}')
  assert.equal(JSON.stringify(await remote.call(undefined, 'getMode')), '{"active":false}')
  assert.equal(await remote.call(undefined, 'getTunnelName'), undefined)
  assert.equal(await remote.call(undefined, 'stopTunnel'), undefined)
  assert.equal(remote.listen(undefined, 'onDidChangeMode'), none)
  await assert.rejects(remote.call(undefined, 'startTunnel'), /unavailable/)
  const tunnel = channels.get('sharedProcessTunnel')
  assert.equal(await tunnel.call(undefined, 'destroyTunnel'), undefined)
  await assert.rejects(tunnel.call(undefined, 'createTunnel'), /unavailable/)
})

test('desktop uses null transcription and agent services without browser or Playwright feature entry', () => {
  assert.ok(policy?.workbenchEntries)
  const entry = 'workbench.desktop.main.ts'
  const replacements = policy.workbenchEntries[entry]
  const desktop = entries.patchEntryImports(baseline(`src/vs/workbench/${entry}`), replacements, entry)
  assert.equal(entries.patchEntryImports(desktop, replacements, entry), desktop)
  assert.match(desktop, /services\/localTranscription\/browser\/localTranscriptionService\.js/)
  assert.match(desktop, /services\/agentHost\/browser\/readerAgentHostService\.js/)
  assert.doesNotMatch(desktop, /^import .*playwrightWorkbenchService\.js';/m)
  assert.doesNotMatch(desktop, /^import .*browserView\.contribution\.js';/m)
  const source = baseline('src/vs/platform/agentHost/browser/agentHostEnablementService.ts')
  const result = policy.patchAgentEnablement(source)
  assert.match(result, /super\(false, configurationService/)
  assert.equal(policy.patchAgentEnablement(result), result)
})

test('reader agent compatibility registers existing null implementations with a harmless root snapshot', () => {
  assert.equal(typeof policy?.agentServicesSource, 'string')
  const calls = []
  const none = () => ({ dispose() {} })
  class NullAgentHostService { startAgentHost() {} async listSessions() { return [] } }
  class NullRemoteAgentHostService {}
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(policy.agentServicesSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, module,
    require(id) {
      if (id.endsWith('/event.js')) return { Event: { None: none } }
      if (id.endsWith('/extensions.js')) return { registerSingleton: (...args) => calls.push(args), InstantiationType: { Delayed: 'delayed' } }
      if (id.endsWith('/agentService.js')) return { IAgentHostService: 'local' }
      if (id.endsWith('/nullAgentHostService.js')) return { NullAgentHostService }
      if (id.endsWith('/remoteAgentHostService.js')) return { IRemoteAgentHostService: 'remote', NullRemoteAgentHostService }
      throw Error(`Agent compatibility loaded a live backend: ${id}`)
    },
  })
  assert.deepEqual(calls.map(([id, , type]) => [id, type]), [['local', 'delayed'], ['remote', 'delayed']])
  const local = new calls[0][1]()
  assert.equal(local.startAgentHost(), undefined)
  assert.equal(local.rootState.value, undefined)
  assert.equal(local.rootState.onDidChange, none)
  assert.equal(calls[1][1], NullRemoteAgentHostService)
})

test('backend transformations fail before writing when pinned source markers drift', () => {
  assert.equal(typeof policy?.patchSharedProcess, 'function')
  assert.throws(() => policy.patchSharedProcess(baseline('src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts').replace('// Playwright', '// Renamed upstream feature'), ts), /Playwright/)
  assert.throws(() => policy.patchMainProcess(baseline('src/vs/code/electron-main/app.ts').replace('// Agent Host', '// Renamed upstream feature'), ts), /Agent Host/)
  assert.throws(() => policy.patchAgentEnablement('unexpected source'), /enablement/)
})

test('actual browser RPC customers construct against null services without acquiring browser proxies', async () => {
  assert.equal(typeof policy?.browserServicesSource, 'string')
  const registrations = new Map()
  const none = () => ({ dispose() {} })
  const noop = { dispose() {} }
  class Disposable {
    static None = noop
    _register(value) { return value }
    dispose() {}
  }
  class DisposableMap extends Map {}
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(policy.browserServicesSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: module.exports, module,
    require(id) {
      if (id.endsWith('/event.js')) return { Event: { None: none } }
      if (id.endsWith('/lifecycle.js')) return { Disposable }
      if (id.endsWith('/extensions.js')) return { registerSingleton: (id, Service) => registrations.set(id, Service), InstantiationType: { Delayed: 'delayed' } }
      if (id.endsWith('/browserView.js')) return { IBrowserViewWorkbenchService: 'browser', IBrowserViewCDPService: 'cdp' }
      throw Error(`Null browser compatibility loaded a real backend: ${id}`)
    },
  })
  const browser = new (registrations.get('browser'))()
  const cdp = new (registrations.get('cdp'))()
  const contract = parse(baseline('src/vs/workbench/contrib/browserView/common/browserView.ts'))
  for (const [name, service] of [['IBrowserViewWorkbenchService', browser], ['IBrowserViewCDPService', cdp]]) {
    const declaration = contract.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === name)
    for (const member of declaration.members) {
      const key = member.name?.getText(contract)
      if (key && key !== '_serviceBrand') assert.ok(key in service, `Missing pinned ${name}.${key}`)
    }
  }
  assert.equal(browser.getKnownBrowserViews().size, 0)
  assert.equal(browser.getContextualBrowserViews().size, 0)
  assert.equal(browser.isSharingAvailable, false)
  assert.equal(browser.onDidChangeBrowserViews, none)
  let acquired = 0
  browser.registerNetworkProxyProvider({ acquire() { acquired++; throw Error('Proxy must stay inactive') }, release() {} }).dispose()
  browser.registerNetworkResolver({ resolveNetwork() { acquired++; throw Error('Resolver must stay inactive') } }).dispose()
  assert.equal(acquired, 0)
  await assert.rejects(browser.createBrowserView(), /unavailable/)
  await assert.rejects(browser.createExternalBrowserView(), /unavailable/)
  assert.throws(() => browser.getOrCreateLazy(), /unavailable/)
  await assert.rejects(browser.acquireNetwork(), /unavailable/)
  await assert.rejects(cdp.createSessionGroup(), /unavailable/)
  assert.equal(cdp.onCDPMessage('unused'), none)
  assert.equal(cdp.onDidDestroy('unused'), none)

  // Run the actual pinned RPC customer constructors. Their event subscriptions
  // and initial tab enumeration must complete, so the reader RPC can initialize.
  for (const name of ['MainThreadBrowsers', 'MainThreadBrowserTunnelProxy']) {
    const file = parse(baseline(`src/vs/workbench/api/browser/${name[0].toLowerCase()}${name.slice(1)}.ts`))
    const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name.text === name)
    const source = declaration.getText(file).replace(/@extHostNamedCustomer\(MainContext\.\w+\)\s*/g, '').replace(/@I\w+\s+/g, '')
    const customer = { exports: {} }
    const context = { extensionHostKind: 1, getProxy: () => new Proxy({}, { get: () => () => { acquired++ } }) }
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      exports: customer.exports, module: customer, Disposable, DisposableMap, BrowserEditorInput: class {},
      ExtHostContext: { ExtHostBrowsers: 1, ExtHostBrowserTunnelProxy: 2 }, ExtensionHostKind: { LocalProcess: 1 },
    })
    if (name === 'MainThreadBrowsers') {
      new customer.exports[name](context, { onDidActiveEditorChange: none }, cdp, browser, {}, {})
    } else {
      new customer.exports[name](context, browser, { getConnectionByAuthority() { throw Error('No Agent Host connection should be requested') } })
    }
  }
  assert.equal(acquired, 0)
  const desktop = entries.patchEntryImports(baseline('src/vs/workbench/workbench.desktop.main.ts'), policy.workbenchEntries['workbench.desktop.main.ts'], 'desktop')
  assert.match(desktop, /^import .*readerBrowserServices\.contribution\.js';/m)
})
