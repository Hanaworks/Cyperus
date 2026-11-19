const { test } = require('node:test')
const assert = require('node:assert/strict')
const { migrateSettings } = require('./profile.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

test('migrates the old readonly trial without losing user preferences', () => {
  const original = { 'files.readonlyInclude': { '**/*': true, '**/archive/**': true }, 'workbench.colorTheme': 'Custom', 'editor.fontSize': 17 }
  const updated = migrateSettings(original)
  assert.equal(updated['files.readonlyInclude']['**/*'], undefined)
  assert.equal(updated['files.readonlyInclude']['**/archive/**'], true)
  assert.equal(updated['workbench.colorTheme'], 'Custom')
  assert.equal(updated['editor.fontSize'], 17)
  assert.equal(updated['workbench.editorAssociations']['*.md'], 'mdReader.preview')
  assert.equal(original['files.readonlyInclude']['**/*'], true)
  assert.deepEqual(migrateSettings(updated), updated)
})

test('does not undo a user readonly preference set after migration', () => {
  const settings = migrateSettings({})
  settings['files.readonlyInclude'] = { '**/*': true }
  assert.equal(migrateSettings(settings, 1)['files.readonlyInclude']['**/*'], true)
})

test('actual profile migration accepts JSONC and preserves comments and preferences', async () => {
  const root = await fs.mkdtemp(path.resolve('artifacts/code-oss/profiles/settings-jsonc-'))
  const file = path.join(root, 'settings.json')
  await fs.writeFile(file, '{\n  // keep my note\n  "editor.fontSize": 19,\n  "files.readonlyInclude": { "**/*": true, },\n}\n')
  execFileSync(process.execPath, [path.join(__dirname, 'profile.cjs'), file])
  const result = await fs.readFile(file, 'utf8')
  assert.match(result, /keep my note/)
  assert.match(result, /"editor.fontSize": 19/)
  assert.doesNotMatch(result, /"\*\*\/\*": true/)
  execFileSync(process.execPath, [path.join(__dirname, 'profile.cjs'), file])
  assert.equal(await fs.readFile(file, 'utf8'), result)
})
