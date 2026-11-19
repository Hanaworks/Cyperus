import { cp, mkdir, readFile, writeFile, readdir, access, lstat } from 'node:fs/promises'
import { resolve, relative, join, dirname, basename, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import packagePolicy from './package-policy.cjs'

const reader = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(reader, '../../..')
const upstream = join(repo, 'artifacts/code-oss/upstream')
const destination = resolve(process.argv[2] ?? join(repo, 'dist/Cyperus-Windows-x64'))
const within = relative(join(repo, 'dist'), destination)
if (!within || within.startsWith('..') || isAbsolute(within)) throw Error('Candidate must be a new directory within project dist/')
try { await access(destination); throw Error('Candidate directory already exists; choose a new path to preserve previous builds') }
catch (error) { if (error.code !== 'ENOENT') throw error }
const bundle = join(upstream, 'out-reader-portable')
for (const file of ['main.js', 'vs/workbench/workbench.desktop.main.js', 'vs/workbench/workbench.desktop.main.css', 'nls.messages.json']) await access(join(bundle, file))
const desktopBundle = await readFile(join(bundle, 'vs/workbench/workbench.desktop.main.js'), 'utf8')
if (!desktopBundle.includes('reader.workspaceContext')
  || desktopBundle.includes('editor.experimental.preferTreeSitter.typescript')) {
  throw Error('Rebuild the prepared Reader desktop bundle before packaging without experimental services')
}
for (const entry of ['vs/sessions', 'vs/platform/terminal/node/ptyHostMain.js']) {
  try {
    await access(join(bundle, entry))
    throw Error(`Rebuild the prepared Reader desktop bundle without ${entry}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
await access(join(reader, 'dist/webview/main.js'))
const lock = JSON.parse(await readFile(join(upstream, 'package-lock.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(join(upstream, 'package.json'), 'utf8'))
const runtimePlan = packagePolicy.createRuntimePlan(lock)
const production = Object.entries(lock.packages).filter(([name]) => runtimePlan.includedPaths.has(name))
const dependencies = []
const absentOptional = []
for (const [name, metadata] of production) {
  try { await access(join(upstream, name, 'package.json')); dependencies.push([name, metadata]) }
  catch (error) { if (metadata.optional) absentOptional.push(name); else throw Error(`Required runtime dependency missing: ${name}`, { cause: error }) }
}
const app = join(destination, 'resources/app')
const product = JSON.parse(await readFile(join(upstream, 'product.json'), 'utf8'))
if (product.nameShort !== 'Cyperus' || product.nameLong !== 'Cyperus') throw Error('Run prepare-upstream.mjs before packaging Cyperus')
const runtime = join(upstream, '.build/electron')
const executable = `${product.nameShort}.exe`
const legacyExecutable = 'Markdown Reader Lab.exe'
let runtimeExecutable = executable
try { await access(join(runtime, executable)) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  runtimeExecutable = legacyExecutable
  await access(join(runtime, runtimeExecutable))
}
await mkdir(app, { recursive: true })
const ignored = new Set(['.git', '.bin', '.cache', 'test', 'tests', '__tests__'])
async function copyTree(source, target, extraFilter = () => true) {
  await cp(source, target, { recursive: true, dereference: true, filter: async file => {
    const parts = relative(source, file).split(/[\\/]/)
    return !parts.some(part => ignored.has(part)) && !file.endsWith('.map') && !file.endsWith('.npmrc')
      && packagePolicy.shouldShipFile(relative(source, file), { isDirectory: (await lstat(file)).isDirectory() }) && extraFilter(file, parts)
  } })
}
// Code OSS and the reader supply their own UI text. Keep the English
// fallback for Electron's runtime strings.
await copyTree(runtime, destination, (file, parts) =>
  !file.endsWith('default_app.asar') && parts[0] !== legacyExecutable && parts[0] !== executable
  && (parts[0] !== 'locales' || parts.length === 1 || parts[1] === 'en-US.pak'))
const packagedExecutable = join(destination, executable)
await cp(join(runtime, runtimeExecutable), packagedExecutable)
// Rebrand the cached unsigned Windows runtime locally, retaining its icon.
if (runtimeExecutable === legacyExecutable) {
  execFileSync(join(upstream, 'node_modules/rcedit/bin/rcedit.exe'), [
    packagedExecutable, '--set-version-string', 'FileDescription', product.nameLong,
    '--set-version-string', 'ProductName', product.nameLong,
    '--set-version-string', 'OriginalFilename', executable,
  ])
}
await access(join(destination, 'locales/en-US.pak'))
// The pinned Reader backend patch disconnects the Agent Host startup process.
// Keep the other agent resources until their individual call sites are removed.
await copyTree(bundle, join(app, 'out'), (_file, parts) => parts.join('/') !== 'vs/platform/agentHost/node/agentHostMain.js')
await cp(join(reader, 'i18n/vscode-zh-cn.json'), join(app, 'out/nls.cyperus.zh-cn.json'))
const readerStrings = JSON.parse(await readFile(join(reader, 'l10n/bundle.l10n.zh-cn.json'), 'utf8'))
await writeFile(join(app, 'out/nls.cyperus.reader.zh-cn.json'), JSON.stringify({ contents: { bundle: readerStrings } }))
await mkdir(join(app, 'licenses'), { recursive: true })
await cp(join(reader, 'i18n/LICENSE.md'), join(app, 'licenses/vscode-loc-MIT.md'))
await copyTree(join(upstream, 'resources'), join(app, 'resources'))
for (const [name] of dependencies) {
  await copyTree(join(upstream, name), join(app, name), (_file, parts) =>
    !parts.includes('node_modules') && packagePolicy.shouldShipWindowsX64DependencyFile(name, parts.join('/')))
}
// Browser workers use VS Code's production ASAR URLs even when Node loads
// ordinary dependencies from node_modules. Ship those JS libraries as an ASAR
// with WASM unpacked, matching TextMate's resource paths.
const upstreamRequire = createRequire(join(upstream, 'package.json'))
const browserStaging = join(repo, 'artifacts/code-oss', `browser-asar-${Date.now()}`)
await mkdir(browserStaging, { recursive: true })
for (const name of ['vscode-oniguruma', 'vscode-textmate', 'vscode-regexp-languagedetection', '@vscode/vscode-languagedetection']) {
  try { await access(join(upstream, 'node_modules', name, 'package.json')) }
  catch (error) { if (['vscode-oniguruma', 'vscode-textmate'].includes(name)) throw error; continue }
  await copyTree(join(upstream, 'node_modules', name), join(browserStaging, name))
}
await upstreamRequire('asar').createPackageWithOptions(browserStaging, join(app, 'node_modules.asar'), { unpack: '**/*.wasm' })
const staticExtensions = []
for (const entry of await readdir(join(upstream, 'extensions'), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  let manifest
  try { manifest = JSON.parse(await readFile(join(upstream, 'extensions', entry.name, 'package.json'), 'utf8')) } catch { continue }
  if (manifest.main || manifest.browser) continue
  await copyTree(join(upstream, 'extensions', entry.name), join(app, 'extensions', entry.name), (_file, parts) => !parts.includes('node_modules'))
  staticExtensions.push(`${manifest.publisher}.${manifest.name}`)
}
const readerExtension = join(app, 'extensions/md-reader')
await mkdir(readerExtension, { recursive: true })
const runtimeScripts = (await readdir(reader)).filter(name => name.endsWith('.cjs') && !/test|integration|profile|performance|-policy/.test(name))
for (const name of [...runtimeScripts, 'package.json', 'package.nls.json', 'package.nls.zh-cn.json', 'l10n', 'theme.json', 'icons', 'dist', 'html-preview']) {
  await copyTree(join(reader, name), join(readerExtension, name))
}
for (const name of ['LICENSE.txt', 'ThirdPartyNotices.txt']) await cp(join(upstream, name), join(app, name))
delete packageJson.scripts
delete packageJson.devDependencies
for (const name of runtimePlan.removedRootDependencies) delete packageJson.dependencies[name]
packageJson.main = './out/main.js'
await writeFile(join(app, 'package.json'), JSON.stringify(packageJson, null, 2))
const nlsHash = createHash('sha256')
for (const name of ['nls.keys.json', 'nls.messages.json']) nlsHash.update(await readFile(join(bundle, name)))
product.nlsMetadataHash = nlsHash.digest('hex')
await writeFile(join(app, 'product.json'), JSON.stringify(product, null, 2))
const require = createRequire(import.meta.url)
const { migrateSettings } = require('./profile.cjs')
const userSettings = join(destination, 'data/user-data/User')
await mkdir(userSettings, { recursive: true })
await mkdir(join(destination, 'data/extensions'), { recursive: true })
await mkdir(join(destination, 'data/tmp'), { recursive: true })
await writeFile(join(userSettings, 'settings.json'), JSON.stringify(migrateSettings({}), null, 2))

// Preserve upstream/Electron notices and add the licenses of bundled reader
// packages. This is an inventory for the candidate, not a legal review claim.
const licenses = []
const visited = new Set()
async function collectPackage(folder) {
  const { realpath } = await import('node:fs/promises')
  let canonical, metadata
  try { canonical = await realpath(folder); metadata = JSON.parse(await readFile(join(canonical, 'package.json'), 'utf8')) } catch { return }
  if (visited.has(canonical)) return
  visited.add(canonical)
  const id = `${metadata.name ?? basename(folder)}@${metadata.version ?? 'unknown'}`
  const target = join(app, 'licenses', id.replace(/[^a-zA-Z0-9@._-]/g, '_'))
  const notices = (await readdir(canonical, { withFileTypes: true })).filter(item => item.isFile() && /^(license|licence|copying|notice)(\.|$|-)/i.test(item.name))
  for (const notice of notices) { await mkdir(target, { recursive: true }); await cp(join(canonical, notice.name), join(target, notice.name)) }
  licenses.push({ name: metadata.name, version: metadata.version, license: metadata.license, notices: notices.map(item => item.name) })
  for (const name of Object.keys(metadata.dependencies ?? {})) {
    let current = canonical
    while (current !== dirname(current)) {
      try { await access(join(current, 'node_modules', name, 'package.json')); await collectPackage(join(current, 'node_modules', name)); break }
      catch { current = dirname(current) }
    }
  }
}
for (const [name] of dependencies) await collectPackage(join(upstream, name))
const ui = join(repo, 'src/ui')
const uiMetadata = JSON.parse(await readFile(join(ui, 'package.json'), 'utf8'))
for (const name of Object.keys(uiMetadata.dependencies)) await collectPackage(join(ui, 'node_modules', name))
await writeFile(join(app, 'licenses/inventory.json'), JSON.stringify(licenses.sort((a, b) => a.name.localeCompare(b.name)), null, 2))
await writeFile(join(destination, '使用说明.txt'), `Cyperus · Windows 免安装候选版\r\n\r\n双击 Cyperus.exe 启动；也可把文档拖到程序上。\r\n设置与阅读记录保存在同目录 data 文件夹。升级时请保留 data。\r\n默认以预览打开 Markdown 和静态 HTML，右上角图标可切换源码、外部打开、定位文件夹。\r\n本候选未签名，尚未完成正式发行验收。Git 后续接入。\r\n上游和运行组件许可见 resources/app/LICENSE.txt、ThirdPartyNotices.txt、licenses，以及根目录 Electron 许可文件。\r\n`)
const files = []
async function inventory(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const full = join(folder, item.name)
    if (item.isDirectory()) await inventory(full)
    else { const data = await readFile(full); files.push({ path: relative(destination, full).replaceAll('\\', '/'), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }) }
  }
}
await inventory(destination)
const manifest = { schemaVersion: 1, created: new Date().toISOString(), codeOssVersion: packageJson.version,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), runtimeDependencies: dependencies.map(([name]) => name), absentOptional,
  omittedRuntimeDependencies: [...runtimePlan.omittedPaths], removedRootDependencies: runtimePlan.removedRootDependencies,
  staticExtensions, readerScripts: runtimeScripts, files }
await writeFile(join(destination, 'portable-manifest.json'), JSON.stringify(manifest, null, 2))
process.stdout.write(JSON.stringify({ destination, files: files.length, bytes: manifest.totalBytes, runtimeDependencies: dependencies.length, staticExtensions: staticExtensions.length }) + '\n')
