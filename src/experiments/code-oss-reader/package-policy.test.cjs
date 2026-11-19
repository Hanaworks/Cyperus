const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createRequire } = require('node:module')
const policy = require('./package-policy.cjs')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-package-policy-'))
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('reader-package-policy-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  async function write(name, data = name) {
    const target = path.join(root, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, data)
  }
  return { root, write }
}

test('copying real native fixtures removes build debris and preserves runtime files and notices', async t => {
  assert.equal(typeof policy.shouldShipFile, 'function')
  const { root, write } = await fixture(t)
  const omitted = ['native.obj', 'native.PDB', 'native.ipdb', 'native.iobj', 'native.ilk', 'native.lib', 'native.exp', 'native.pch', 'native.idb', 'native.tlog', 'native.lastbuildstate', 'native.o', 'native.a']
  const retained = ['native.node', 'helper.dll', 'helper.exe', 'grammar.wasm', 'entry.js', 'entry.cjs', 'entry.mjs', 'style.css', 'data.json', 'snapshot.bin', 'LICENSE', 'NOTICE.lib', 'ThirdPartyNotices.pdb', 'licenses/original.obj', 'data.obj/loader.js']
  for (const name of [...omitted, ...retained]) await write(`source/build/Release/${name}`)
  const source = path.join(root, 'source')
  const target = path.join(root, 'copied')
  await fs.cp(source, target, { recursive: true, filter: async file => policy.shouldShipFile(path.relative(source, file), { isDirectory: (await fs.stat(file)).isDirectory() }) })
  for (const name of omitted) await assert.rejects(fs.access(path.join(target, 'build/Release', name)), { code: 'ENOENT' })
  for (const name of retained) assert.equal(await fs.readFile(path.join(target, 'build/Release', name), 'utf8'), `source/build/Release/${name}`)
  assert.equal(policy.shouldShipFile('build\\Release\\native.OBJ'), false)
  assert.equal(policy.shouldShipFile('build/Release/native.obj.js'), true)
})

async function dependencyFixture(t) {
  const result = await fixture(t)
  const packages = {
    '': { dependencies: { editor: '1', '@github/copilot-sdk': '1', 'foundry-local-sdk': '1' }, devDependencies: { builder: '1' } },
    'node_modules/editor': { dependencies: { shared: '1' }, peerDependencies: { optionalPeer: '*' }, peerDependenciesMeta: { optionalPeer: { optional: true } } },
    'node_modules/@github/copilot-sdk': { dependencies: { shared: '1', sdkOnly: '1' }, optionalDependencies: { '@github/copilot-sdk-win32-x64': '1', '@github/copilot-sdk-linux-x64': '1' } },
    'node_modules/@github/copilot-sdk-win32-x64': { optional: true },
    'node_modules/@github/copilot-sdk-linux-x64': { optional: true },
    'node_modules/@github/copilot-sdk/node_modules/shared': {},
    'node_modules/shared': { dependencies: { leaf: '1' } },
    'node_modules/sdkOnly': { dependencies: { cycle: '1' } },
    'node_modules/cycle': { dependencies: { sdkOnly: '1' } },
    'node_modules/foundry-local-sdk': { dependencies: { sdkOnly: '1' } },
    'node_modules/leaf': {},
    'node_modules/untracked-runtime': {},
    'node_modules/builder': { dev: true }
  }
  await result.write('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages }))
  for (const packagePath of Object.keys(packages).filter(Boolean)) {
    const name = packagePath.split('node_modules/').at(-1)
    await result.write(`${packagePath}/package.json`, JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...packages[packagePath] }))
    await result.write(`${packagePath}/index.js`, `module.exports = ${JSON.stringify(packagePath)}`)
  }
  return { ...result, lock: JSON.parse(await fs.readFile(path.join(result.root, 'package-lock.json'), 'utf8')) }
}

test('dependency graph removes only denied roots and their exclusive closure, with real nested resolution', async t => {
  assert.equal(typeof policy.createRuntimePlan, 'function')
  const { root, lock } = await dependencyFixture(t)
  const editorRequire = createRequire(path.join(root, 'node_modules/editor/index.js'))
  const copilotRequire = createRequire(path.join(root, 'node_modules/@github/copilot-sdk/index.js'))
  assert.equal(editorRequire('shared'), 'node_modules/shared')
  assert.equal(copilotRequire('shared'), 'node_modules/@github/copilot-sdk/node_modules/shared')
  const plan = policy.createRuntimePlan(lock)
  assert.deepEqual([...plan.includedPaths].sort(), ['node_modules/editor', 'node_modules/leaf', 'node_modules/shared', 'node_modules/untracked-runtime'])
  assert.deepEqual(plan.removedRootDependencies, ['@github/copilot-sdk', 'foundry-local-sdk'])
  for (const name of ['@github/copilot-sdk', '@github/copilot-sdk-win32-x64', '@github/copilot-sdk-linux-x64', '@github/copilot-sdk/node_modules/shared', 'sdkOnly', 'cycle', 'foundry-local-sdk']) {
    assert.ok(plan.omittedPaths.has(`node_modules/${name}`), name)
    assert.match(plan.reasons[`node_modules/${name}`], /copilot|foundry/i)
  }
  assert.equal(plan.includedPaths.has('node_modules/builder'), false)
  assert.equal(plan.omittedPaths.has('node_modules/builder'), false)
  const destination = (await fixture(t)).root
  for (const packagePath of plan.includedPaths) {
    const source = path.join(root, packagePath)
    await fs.cp(source, path.join(destination, packagePath), {
      recursive: true,
      filter: file => !path.relative(source, file).split(path.sep).includes('node_modules')
    })
  }
  const packagedRequire = createRequire(path.join(destination, 'node_modules/editor/index.js'))
  assert.equal(packagedRequire('shared'), 'node_modules/shared')
  assert.equal(packagedRequire('leaf'), 'node_modules/leaf')
  assert.throws(() => packagedRequire('@github/copilot-sdk'), { code: 'MODULE_NOT_FOUND' })
  assert.throws(() => packagedRequire('sdkOnly'), { code: 'MODULE_NOT_FOUND' })
})

test('a retained core dependency overrides the denylist and keeps its full closure', async t => {
  const { lock } = await dependencyFixture(t)
  lock.packages['node_modules/editor'].dependencies['@github/copilot-sdk'] = '1'
  const plan = policy.createRuntimePlan(lock)
  assert.ok(plan.includedPaths.has('node_modules/@github/copilot-sdk'))
  assert.ok(plan.includedPaths.has('node_modules/@github/copilot-sdk-win32-x64'))
  assert.ok(plan.includedPaths.has('node_modules/cycle'))
  assert.deepEqual(plan.removedRootDependencies, ['foundry-local-sdk'])
  assert.match(plan.reasons['node_modules/@github/copilot-sdk'], /editor/)
})

test('explicit retain by package name or lock path restores a package and its dependencies', async t => {
  const { lock } = await dependencyFixture(t)
  const byName = policy.createRuntimePlan(lock, { retain: ['@github/copilot-sdk'] })
  assert.ok(byName.includedPaths.has('node_modules/@github/copilot-sdk-win32-x64'))
  assert.ok(byName.includedPaths.has('node_modules/cycle'))
  assert.deepEqual(byName.removedRootDependencies, ['foundry-local-sdk'])
  const byPath = policy.createRuntimePlan(lock, { retain: ['node_modules/sdkOnly'] })
  assert.ok(byPath.includedPaths.has('node_modules/sdkOnly'))
  assert.ok(byPath.includedPaths.has('node_modules/cycle'))
  assert.ok(byPath.omittedPaths.has('node_modules/@github/copilot-sdk'))
  assert.throws(() => policy.createRuntimePlan(lock, { retain: ['not-installed'] }), /Unknown retain/)
})

test('peer dependencies and undeclared runtime roots protect packages from deletion', async t => {
  const { lock } = await dependencyFixture(t)
  lock.packages['node_modules/editor'].peerDependencies = { sdkOnly: '*' }
  lock.packages['node_modules/untracked-runtime'].dependencies = { 'foundry-local-sdk': '1' }
  const plan = policy.createRuntimePlan(lock)
  assert.ok(plan.includedPaths.has('node_modules/sdkOnly'))
  assert.ok(plan.includedPaths.has('node_modules/foundry-local-sdk'))
  assert.deepEqual(plan.removedRootDependencies, ['@github/copilot-sdk'])
})

test('malformed lock paths and missing required dependencies fail instead of producing a broken package', async t => {
  const { lock } = await dependencyFixture(t)
  lock.packages['node_modules/editor'].dependencies.missing = '1'
  assert.throws(() => policy.createRuntimePlan(lock), /missing.*editor|editor.*missing/)
  delete lock.packages['node_modules/editor'].dependencies.missing
  lock.packages['node_modules/../escape'] = {}
  assert.throws(() => policy.createRuntimePlan(lock), /Invalid package path/)
})

test('Windows x64 packaging keeps search and SQLite binaries without foreign or build-only payloads', () => {
  const { shouldShipWindowsX64DependencyFile: ship } = policy
  assert.equal(ship('node_modules/@vscode/ripgrep-universal', 'bin/win32-x64/rg.exe'), true)
  assert.equal(ship('node_modules/@vscode/ripgrep-universal', 'bin/win32-arm64'), false)
  assert.equal(ship('node_modules/@vscode/ripgrep-universal', 'bin/linux-x64/rg'), false)
  assert.equal(ship('node_modules/@vscode/sqlite3', 'build/Release/vscode-sqlite3.node'), true)
  assert.equal(ship('node_modules/@vscode/sqlite3', 'build/Release/obj/global_intermediate/sqlite-autoconf-3390400/sqlite3.c'), false)
  assert.equal(ship('node_modules/@vscode/sqlite3', 'deps/sqlite-autoconf-3390400.tar.gz'), false)
  assert.equal(ship('node_modules/@vscode/sqlite3', 'LICENSE'), true)
  assert.equal(ship('node_modules/editor', 'bin/linux-x64/rg'), true)
})

test('general request, telemetry, editor, and native services remain available', () => {
  const roots = ['kerberos', '@vscode/proxy-agent', '@microsoft/1ds-core-js', '@microsoft/1ds-post-js', 'tas-client', '@xterm/xterm', 'vscode-oniguruma', 'vscode-textmate', '@vscode/ripgrep-universal', '@vscode/sqlite3', '@parcel/watcher', 'native-keymap']
  const packages = { '': { dependencies: Object.fromEntries(roots.map(name => [name, '1'])) } }
  for (const name of roots) packages[`node_modules/${name}`] = {}
  const plan = policy.createRuntimePlan({ lockfileVersion: 3, packages })
  assert.equal(plan.includedPaths.size, roots.length)
  assert.equal(plan.omittedPaths.size, 0)
  assert.deepEqual(plan.removedRootDependencies, [])
})

test('runtime peer dependencies marked dev in the lock are promoted with their own closure', () => {
  const packages = {
    '': { dependencies: { '@microsoft/1ds-core-js': '1' }, devDependencies: { tslib: '1', builder: '1' } },
    'node_modules/@microsoft/1ds-core-js': { peerDependencies: { tslib: '*' } },
    'node_modules/tslib': { dev: true, dependencies: { helper: '1' } },
    'node_modules/helper': { dev: true },
    'node_modules/builder': { dev: true }
  }
  const plan = policy.createRuntimePlan({ lockfileVersion: 3, packages })
  assert.ok(plan.includedPaths.has('node_modules/tslib'))
  assert.ok(plan.includedPaths.has('node_modules/helper'))
  assert.equal(plan.includedPaths.has('node_modules/builder'), false)
})
