const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// Run inside the real extension host. These commands must actually change the
// native editor model, undo stack, saved file and rendered reader preview.
async function run({ api, root, waitFor }) {
  const artifacts = await fs.realpath(path.resolve(__dirname, '../../../artifacts'))
  const fixtureRoot = await fs.realpath(root)
  const relative = path.relative(artifacts, fixtureRoot)
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Editing QA must stay inside project artifacts')

  const checks = []
  const file = path.join(fixtureRoot, `native-editing-${randomUUID()}.md`)
  const uri = vscode.Uri.file(file)
  const initial = '# Native editing fixture\n\n原始内容\nfind-token find-token\n保留行\n'
  await fs.writeFile(file, initial, { flag: 'wx' })
  await api.openFile(file)
  const tabCount = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).length
  const openedTabCount = tabCount()
  assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType, 'mdReader.preview')
  await vscode.commands.executeCommand('mdReader.editSource')
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(), 'native editing fixture opens in source', 10000)
  const editor = vscode.window.activeTextEditor
  const document = editor.document
  assert.equal(document.getText(), initial)
  assert.equal(tabCount(), openedTabCount)
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')

  async function expectText(text, label) {
    try {
      await waitFor(() => document.getText() === text, label, 10000)
    } catch (error) {
      throw Error(`${error.message}\nEditing fixture diagnostic: ${JSON.stringify({
        file, completedChecks: checks, expectedText: text, actualText: document.getText(),
        dirty: document.isDirty, version: document.version, selection: editor.selection,
        activeTextEditor: vscode.window.activeTextEditor?.document.uri.toString(),
        activeTab: vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri?.toString(),
        activeViewType: vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType,
      })}`)
    }
    assert.equal(document.getText(), text)
  }
  async function selectLine(line, text, start = 0) {
    editor.selection = new vscode.Selection(line, start, line, start)
    await vscode.commands.executeCommand('cursorEndSelect')
    await waitFor(() => document.getText(editor.selection) === text, 'native selection reaches the end of the fixture line', 10000)
    assert.equal(editor.selection.start.line, line)
    assert.equal(editor.selection.start.character, start)
  }

  await selectLine(0, 'Native editing fixture', 2)
  checks.push('native selection command selects the actual source text')
  // Keyboard typing creates native undo groups at whitespace boundaries. Use a
  // single Unicode word here so one undo has an unambiguous expected document;
  // preserve the Markdown heading prefix outside the selected text.
  const typedHeading = '原生编辑验收'
  await vscode.commands.executeCommand('type', { text: typedHeading })
  const typed = initial.replace('Native editing fixture', typedHeading)
  await expectText(typed, 'native type command replaces the selected heading')
  assert.equal(document.isDirty, true)
  assert.equal(await fs.readFile(file, 'utf8'), initial)
  checks.push('native typing changes the dirty source buffer without saving implicitly')
  await vscode.commands.executeCommand('undo')
  await expectText(initial, 'native undo restores the original heading')
  await vscode.commands.executeCommand('redo')
  await expectText(typed, 'native redo restores the typed heading')
  checks.push('native undo and redo restore the complete typed document')

  await selectLine(2, '原始内容')
  // The editor's real paste handler accepts supplied text. It exercises native
  // replacement and history without reading or overwriting the OS clipboard.
  const pastedText = '粘贴夹具 中文 😀'
  await vscode.commands.executeCommand('paste', { text: pastedText, pasteOnNewLine: false })
  const pasted = typed.replace('原始内容', pastedText)
  await expectText(pasted, 'native paste handler replaces the selected fixture text')
  await vscode.commands.executeCommand('undo')
  await expectText(typed, 'native undo restores the text before supplied-text paste')
  await vscode.commands.executeCommand('redo')
  await expectText(pasted, 'native redo restores supplied-text paste')
  checks.push('native paste handler and its undo history preserve supplied Unicode fixture text')

  editor.selection = new vscode.Selection(0, 0, 0, 0)
  await vscode.commands.executeCommand('editor.actions.findWithArgs', {
    searchString: 'find-token', replaceString: 'replaced-token',
    isRegex: false, isCaseSensitive: true, matchWholeWord: false,
    preserveCase: false, findInSelection: false,
  })
  await vscode.commands.executeCommand('editor.action.nextMatchFindAction')
  await waitFor(() => document.getText(editor.selection) === 'find-token' && editor.selection.start.line === 3 && editor.selection.start.character === 0, 'native find selects the first match', 10000)
  await vscode.commands.executeCommand('editor.action.nextMatchFindAction')
  await waitFor(() => document.getText(editor.selection) === 'find-token' && editor.selection.start.line === 3 && editor.selection.start.character === 11, 'native find selects the next match', 10000)
  await vscode.commands.executeCommand('editor.action.previousMatchFindAction')
  await waitFor(() => document.getText(editor.selection) === 'find-token' && editor.selection.start.character === 0, 'native find returns to the previous match', 10000)
  checks.push('native find widget commands navigate the actual source matches in both directions')

  await vscode.commands.executeCommand('editor.action.replaceOne')
  const replacedOne = pasted.replace('find-token', 'replaced-token')
  await expectText(replacedOne, 'native replace-one changes exactly one source match')
  await vscode.commands.executeCommand('editor.action.replaceAll')
  const replacedAll = pasted.replaceAll('find-token', 'replaced-token')
  await expectText(replacedAll, 'native replace-all changes the remaining source match')
  assert.equal(document.isDirty, true)
  assert.equal(await fs.readFile(file, 'utf8'), initial)
  checks.push('native replace-one and replace-all update the dirty source without altering disk')
  await vscode.commands.executeCommand('closeFindWidget')
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
  await vscode.commands.executeCommand('undo')
  await expectText(replacedOne, 'native undo reverses replace-all as one edit')
  await vscode.commands.executeCommand('undo')
  await expectText(pasted, 'native undo reverses replace-one separately')
  await vscode.commands.executeCommand('redo')
  await expectText(replacedOne, 'native redo restores replace-one separately')
  await vscode.commands.executeCommand('redo')
  await expectText(replacedAll, 'native redo restores replace-all as one edit')
  checks.push('native replacement actions retain separate undo and redo steps')

  await vscode.commands.executeCommand('workbench.action.files.save')
  await waitFor(() => !document.isDirty, 'native save clears the dirty source state', 10000)
  assert.equal(await fs.readFile(file, 'utf8'), replacedAll)
  checks.push('native Save command persists the complete edited fixture and clears dirty state')
  await vscode.commands.executeCommand('mdReader.preview')
  const preview = () => api.documents.get(uri.toString())
  await waitFor(() => preview()?.result?.toc[0]?.text === typedHeading && preview().rendered === preview().version, 'saved edits are painted in reader preview', 10000)
  assert.equal(tabCount(), openedTabCount)
  assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType, 'mdReader.preview')
  api.send(preview(), { type: 'search', query: 'replaced-token' })
  await waitFor(() => preview()?.matches?.total === 2, 'rendered preview contains both saved replacements', 10000)
  api.send(preview(), { type: 'search', query: 'find-token' })
  await waitFor(() => preview()?.matches?.total === 0, 'rendered preview excludes both old source tokens', 10000)
  api.send(preview(), { type: 'search', query: pastedText })
  await waitFor(() => preview()?.matches?.total === 1, 'rendered preview contains saved Unicode paste text', 10000)
  checks.push('saved heading, replacements and Unicode text reach the rendered preview in the same tab')
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await waitFor(() => !api.documents.has(uri.toString()), 'native editing fixture closes cleanly', 10000)

  const scriptFile = path.join(fixtureRoot, `native-language-editing-${randomUUID()}.js`)
  const scriptUri = vscode.Uri.file(scriptFile)
  const scriptInitial = 'const nativeTextFixture = 1;\n'
  const scriptEdited = 'const nativeTextFixture = 2;\n'
  await fs.writeFile(scriptFile, scriptInitial, { flag: 'wx' })
  await vscode.commands.executeCommand('vscode.open', scriptUri)
  await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === scriptUri.toString(), 'ordinary JavaScript file opens directly in the native text editor', 10000)
  const scriptEditor = vscode.window.activeTextEditor
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText)
  assert.equal(scriptEditor.document.languageId, 'javascript')
  assert.equal(api.documents.has(scriptUri.toString()), false)
  const valueStart = scriptEditor.document.positionAt(scriptInitial.indexOf('1'))
  const valueEnd = valueStart.translate(0, 1)
  assert.ok(await scriptEditor.edit(edit => edit.replace(new vscode.Range(valueStart, valueEnd), '2')))
  assert.equal(scriptEditor.document.getText(), scriptEdited)
  assert.equal(scriptEditor.document.isDirty, true)
  assert.equal(await fs.readFile(scriptFile, 'utf8'), scriptInitial)
  await vscode.commands.executeCommand('workbench.action.files.save')
  await waitFor(() => !scriptEditor.document.isDirty, 'native Save persists the JavaScript fixture', 10000)
  assert.equal(await fs.readFile(scriptFile, 'utf8'), scriptEdited)
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  checks.push('non-Markdown JavaScript opens in the native text editor with its language ID and saves real edits')

  return {
    checks,
    manualChecks: [
      {
        feature: 'System clipboard copy and paste',
        reason: 'Not automated: public clipboard APIs cannot preserve all existing rich text, image and file formats. Supplied-text native paste is checked separately.',
        procedure: 'In a disposable artifacts fixture, select text, copy and paste with the native commands, then undo and redo.',
      },
      {
        feature: 'Save As and cancellation of its system dialog',
        reason: 'Not automated: this host exposes no extension API to supply the Save As target URI without opening a system file dialog.',
        procedure: 'Save As into a new artifacts fixture and check both files; repeat and cancel, confirming no extra file or content change.',
      },
      {
        feature: 'Cancel protection for unsaved source edits',
        reason: 'Not automated: the real native confirmation dialog has no deterministic public command for selecting Cancel.',
        procedure: 'Modify an artifacts fixture, return to preview and choose Cancel; verify the dirty source and original disk content remain. Also cancel closing the dirty tab.',
      },
    ],
  }
}

module.exports = { run }
