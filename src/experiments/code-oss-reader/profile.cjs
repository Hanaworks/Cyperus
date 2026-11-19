const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const readerTitle = '${activeEditorShort}${separator}Cyperus'

function migrateSettings(existing, version = 0) {
  const settings = {
    'workbench.colorTheme': 'Reader Light Purple',
    'workbench.startupEditor': 'none',
    'workbench.editor.enablePreview': false,
    'breadcrumbs.showEditorType': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'window.commandCenter': false,
    'window.titleBarStyle': 'custom',
    'window.restoreWindows': 'all',
    'window.menuBarVisibility': 'classic',
    'window.title': readerTitle,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'chat.disableAIFeatures': true,
    'git.enabled': false,
    ...existing,
  }
  if (settings['window.title'] === '${activeEditorShort}${separator}Markdown Reader') settings['window.title'] = readerTitle
  settings['workbench.editorAssociations'] = {
    '*.md': 'mdReader.preview', '*.markdown': 'mdReader.preview', '*.mdown': 'mdReader.preview', '*.mkd': 'mdReader.preview',
    ...existing['workbench.editorAssociations'],
  }
  if (version < 1 && settings['files.readonlyInclude']?.['**/*'] === true) {
    settings['files.readonlyInclude'] = { ...settings['files.readonlyInclude'] }
    delete settings['files.readonlyInclude']['**/*']
  }
  return settings
}

async function migrateProfile() {
  const settingsFile = path.resolve(process.argv[2])
  const allowedRoot = path.resolve(__dirname, '../../../artifacts/code-oss/profiles')
  const relative = path.relative(allowedRoot, settingsFile)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Only isolated reader profiles can be migrated')
  const marker = path.join(path.dirname(settingsFile), 'reader-profile-version.json')
  // Reuse the pinned host's own JSONC implementation; no additional dependency.
  const common = path.resolve(__dirname, '../../../artifacts/code-oss/upstream/out/vs/base/common')
  const { parse } = await import(pathToFileURL(path.join(common, 'json.js')).href)
  const { setProperty, applyEdits } = await import(pathToFileURL(path.join(common, 'jsonEdit.js')).href)
  let text = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, '') : '{}\n'
  const errors = []
  const current = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: true }) ?? {}
  if (errors.length || typeof current !== 'object' || Array.isArray(current)) throw Error('阅读器设置格式有误，请检查 settings.json；原文件未修改')
  const version = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')).version : 0
  const settings = migrateSettings(current, version)
  const formatting = { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' }
  let changed = false
  for (const [key, value] of Object.entries(settings)) {
    if (JSON.stringify(value) !== JSON.stringify(current[key])) {
      text = applyEdits(text, setProperty(text, [key], value, formatting)); changed = true
    }
  }
  if (changed) fs.writeFileSync(settingsFile, text)
  if (version < 1) fs.writeFileSync(marker, '{"version":1}\n')
}
if (require.main === module) migrateProfile().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
module.exports = { migrateSettings }
