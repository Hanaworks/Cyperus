import { execFileSync } from 'node:child_process'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import policy from './workbench-policy.cjs'
import backendPolicy from './backend-policy.cjs'
import agentsPolicy from './agents-policy.cjs'
import terminalPolicy from './terminal-policy.cjs'

const upstream = new URL('../../../artifacts/code-oss/upstream/', import.meta.url)
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(upstream), encoding: 'utf8' }).trim()
if (revision !== '6bab64e2d12b04d04c0d99c27ff166023efd1dda') throw Error(`Unexpected upstream: ${revision}`)
const productFile = new URL('product.json', upstream)
const original = JSON.parse(await readFile(productFile, 'utf8'))
const overrides = JSON.parse(await readFile(new URL('product-overrides.json', import.meta.url), 'utf8'))
const product = { ...original, ...overrides, commit: revision }
// Trim desktop workbench feature registration while retaining the shared
// services used by the internal extension host. Generate from the pinned,
// unmodified contribution sources; do not silently reinterpret local edits.
const ts = createRequire(new URL('package.json', upstream))('typescript')
const workbench = new URL('src/vs/workbench/', upstream)
const workbenchWrites = []
for (const source of policy.serviceOnlyContributions) {
  const file = new URL(source, workbench)
  const text = await readFile(file, 'utf8')
  const baseline = execFileSync('git', ['show', `HEAD:src/vs/workbench/${source}`], { cwd: fileURLToPath(upstream), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (text.replace(/\r\n/g, '\n') !== baseline.replace(/\r\n/g, '\n')) throw Error(`Review locally modified workbench contribution before trimming: ${source}`)
  const compat = policy.generateServiceContribution(text, ts, source, policy.serviceContributionOptions[source])
  const generated = source === 'contrib/terminal/electron-browser/terminal.contribution.ts'
    ? terminalPolicy.patchDesktopContribution(compat) : compat
  workbenchWrites.push([new URL(policy.serviceContributionTarget(source), workbench), generated])
}
const entryPolicies = { ...policy.workbenchEntries }
for (const [entry, replacements] of Object.entries(backendPolicy.workbenchEntries)) entryPolicies[entry] = { ...entryPolicies[entry], ...replacements }
for (const [entry, replacements] of Object.entries(entryPolicies)) {
  const file = new URL(entry, workbench)
  const source = await readFile(file, 'utf8')
  workbenchWrites.push([file, policy.patchEntryImports(source, replacements, entry)])
}
const accountsFile = new URL('browser/parts/globalCompositeBar.ts', workbench)
workbenchWrites.push([accountsFile, policy.patchAccountActions(await readFile(accountsFile, 'utf8'))])
// Compose the policies from the pinned baseline. Accept an earlier generated
// stage when upgrading an existing checkout, but reject unrelated local edits.
const sourcePolicies = [backendPolicy.sourcePatches, agentsPolicy.sourcePatches, terminalPolicy.sourcePatches, policy.sourcePatches, backendPolicy.readerLocaleSourcePatches]
const patchedSources = new Set(sourcePolicies.flatMap(patches => Object.keys(patches)))
for (const source of patchedSources) {
  const file = new URL(source, upstream)
  const baseline = execFileSync('git', ['show', `HEAD:${source}`], { cwd: fileURLToPath(upstream), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  let generated = baseline
  const accepted = new Set([baseline.replace(/\r\n/g, '\n')])
  for (const patches of sourcePolicies) {
    const patch = patches[source]
    if (!patch) continue
    generated = patch(generated, ts)
    accepted.add(generated.replace(/\r\n/g, '\n'))
  }
  const current = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
  if (!accepted.has(current)) throw Error(`Review locally modified upstream file before trimming: ${source}`)
  workbenchWrites.push([file, generated])
}
for (const [source, generated] of Object.entries(backendPolicy.generatedSources)) workbenchWrites.push([new URL(source, upstream), generated])
// All planned transformations are checked before writing any workbench file.
for (const [file, source] of workbenchWrites) {
  let current
  try { current = await readFile(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (current !== source) await writeFile(file, source)
}
// Forward native search/goto selections to our readonly preview only. Other
// custom editors retain upstream navigation behavior. Keep this patch repeatable.
const navigationFile = new URL('src/vs/workbench/contrib/customEditor/browser/customEditorInput.ts', upstream)
const navigationSource = await readFile(navigationFile, 'utf8')
const navigationNeedle = '\t\tconst selection = options.selection;'
const navigationPatch = `${navigationNeedle}
\t\tif (this.viewType === 'mdReader.preview' && selection && !token.isCancellationRequested) {
\t\t\tawait this.webview.postMessage({ type: 'sourceSelection', line: selection.startLineNumber, preserveFocus: !!options.preserveFocus });
\t\t\treturn;
\t\t}`.replace(/\n/g, navigationSource.includes('\r\n') ? '\r\n' : '\n')
if (!navigationSource.includes(navigationPatch)) {
  if (navigationSource.split(navigationNeedle).length !== 2) throw Error('Unexpected custom editor navigation; review before patching')
  await writeFile(navigationFile, navigationSource.replace(navigationNeedle, navigationPatch))
}
// Reuse the original reader artwork for both the executable and custom title bar.
const titlebarFile = new URL('src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css', upstream)
const titlebarSource = await readFile(titlebarFile, 'utf8')
const originalIcon = "url('../../../media/code-icon.svg')"
const readerIcon = "url('../../../media/md-reader-icon.png')"
if (!titlebarSource.includes(originalIcon) && !titlebarSource.includes(readerIcon)) {
  throw Error('Unexpected title bar icon reference; review before patching')
}
await copyFile(new URL('../../host/icons/icon.ico', import.meta.url), new URL('resources/win32/code.ico', upstream))
await copyFile(new URL('../../host/icons/64x64.png', import.meta.url), new URL('src/vs/workbench/browser/media/md-reader-icon.png', upstream))
if (titlebarSource.includes(originalIcon)) await writeFile(titlebarFile, titlebarSource.replace(originalIcon, readerIcon))
// gulp-electron assumes the SDK lives on C:. Keep its signing/checksum logic,
// but allow the build wrapper to provide the actual registered SDK location.
const win32File = new URL('node_modules/@vscode/gulp-electron/src/win32.js', upstream)
const win32Source = await readFile(win32File, 'utf8')
const sdkLine = 'let windowsSDKDir = "C:\\\\Program Files (x86)\\\\Windows Kits\\\\10\\\\bin\\\\";'
const sdkReplacement = 'let windowsSDKDir = process.env.MD_READER_WINDOWS_SDK_BIN || "C:\\\\Program Files (x86)\\\\Windows Kits\\\\10\\\\bin\\\\";'
if (win32Source.includes(sdkLine)) {
  await writeFile(win32File, win32Source.replace(sdkLine, sdkReplacement))
} else if (!win32Source.includes(sdkReplacement)) {
  throw Error('Unexpected gulp-electron Windows SDK lookup; review before patching')
}
// This is a local source-run experiment; distribution and service auditing remain separate gates.
delete product.extensionsGallery
delete product.updateUrl
delete product.downloadUrl
await writeFile(productFile, `${JSON.stringify(product, null, '\t')}\n`)
process.stdout.write(`Prepared ${product.nameShort} from Code OSS ${revision}.\n`)
