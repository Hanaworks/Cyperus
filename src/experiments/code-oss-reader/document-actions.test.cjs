const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reopenSingleEditor } = require('./document-actions.cjs')

test('switching one document clears native tab multiselection before reopening', async () => {
  const uri = { toString: () => 'file:///D:/first.md' }
  const types = { first: 'mdReader.preview', other: 'mdReader.preview' }
  let selected = ['first', 'other']
  // The real pinned upstream expands reopenActiveEditorWith to selected tabs.
  // Public extension APIs cannot set tab multi-selection; model only that host boundary.
  const host = {
    window: { tabGroups: { activeTabGroup: { viewColumn: 1, activeTab: { input: { uri, viewType: types.first } } } } },
    commands: { async executeCommand(command, resource, type) {
      if (command === 'vscode.openWith') { assert.equal(resource, uri); assert.equal(type, 'mdReader.preview'); selected = ['first'] }
      else if (command === 'reopenActiveEditorWith') for (const file of selected) types[file] = resource
      else throw Error(`Unexpected command ${command}`)
    } },
  }
  await reopenSingleEditor(host, uri, 'default')
  assert.deepEqual(types, { first: 'default', other: 'mdReader.preview' })
})
