const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function waitFor(predicate, label, timeout = 60000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)) }
  throw Error(`Timed out: ${label}`)
}
async function run() {
  const root = process.env.MD_READER_TEST_ROOT
  if (!root) throw Error('Missing isolated QA directory')
  await fs.mkdir(root, { recursive: true })
  const checks = []
  try {
    if (process.env.MD_READER_EXPECT_APP_ROOT) {
      assert.equal(path.resolve(vscode.env.appRoot).toLowerCase(), path.resolve(process.env.MD_READER_EXPECT_APP_ROOT).toLowerCase())
      assert.equal(vscode.env.appName, 'Cyperus')
      assert.equal(vscode.workspace.getConfiguration('window').get('title'), '${activeEditorShort}${separator}Cyperus')
      checks.push('independent Code OSS host identity and source root')
    }
    const extension = vscode.extensions.getExtension('local-md-reader.md-reader-experiment')
    assert.ok(extension)
    const api = await extension.activate()
    const language = process.env.MD_READER_EXPECT_LANGUAGE
    if (language) {
      assert.equal(vscode.env.language, language)
      const title = extension.packageJSON.contributes.commands.find(command => command.command === 'mdReader.editSource').title
      assert.equal(typeof title === 'string' ? title : title.value, language === 'zh-cn' ? '编辑源码' : 'Edit Source')
      await waitFor(async () => (await vscode.commands.getCommands(true)).includes('workbench.action.configureLocale'), 'native display language picker is registered', 10000)
      const commands = await vscode.commands.getCommands(true)
      for (const id of ['workbench.action.editor.changeLanguageMode', 'workbench.action.editor.changeEOL', 'workbench.action.editor.changeEncoding']) {
        assert.ok(commands.includes(id), `native action remains available: ${id}`)
      }
      checks.push('requested display language and native editor status actions load')
    }
    assert.equal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.toLowerCase(), path.resolve(root).toLowerCase())
    checks.push('native Explorer is backed by the actual workspace')
    assert.ok(vscode.workspace.isTrusted, 'Reader opens the folder without a restricted workspace')
    const commands = await vscode.commands.getCommands(true)
    assert.ok(!commands.includes('workbench.trust.manage') && !commands.includes('workbench.trust.configure'), 'Workspace Trust commands are absent')
    checks.push('workspace opens directly with no Restricted Mode commands')
    assert.ok(!commands.includes('workbench.action.toggleDevTools') && !commands.includes('workbench.action.showGPUInfo'), 'desktop development commands are absent')
    checks.push('development tools and GPU diagnostics commands are absent')
    for (const id of [
      'workbench.action.debug.start', 'workbench.action.debug.run', 'editor.debug.action.toggleBreakpoint',
      'editor.debug.action.toggleInlineBreakpoint', 'debug.toggleExceptionBreakpoints', 'workbench.debug.viewlet.action.removeAllBreakpoints',
      'workbench.action.openSnippets', 'editor.action.insertSnippet', 'editor.action.showSnippets',
      'editor.action.surroundWithSnippet', 'workbench.action.populateFileFromSnippet',
    ]) assert.ok(!commands.includes(id), `Cyperus omits the user-facing command ${id}`)
    checks.push('debug, breakpoint and snippet user commands are absent')
    assert.ok(!commands.includes('workbench.action.openAgentsWindow'), 'Agents window command is absent')
    if (process.env.MD_READER_EXPECT_APP_ROOT) {
      await assert.rejects(fs.access(path.join(vscode.env.appRoot, 'out', 'vs', 'sessions')), { code: 'ENOENT' })
      await assert.rejects(fs.access(path.join(vscode.env.appRoot, 'out', 'vs', 'platform', 'terminal', 'node', 'ptyHostMain.js')), { code: 'ENOENT' })
      for (const packagePath of ['node-pty', '@xterm/headless']) {
        await assert.rejects(fs.access(path.join(vscode.env.appRoot, 'node_modules', packagePath)), { code: 'ENOENT' })
      }
      checks.push('native integrated terminal process and PTY dependencies are absent')
    }
    checks.push('Agents window command and renderer are absent')
    assert.equal(vscode.workspace.getConfiguration('editor.experimental').inspect('preferTreeSitter.typescript')?.defaultValue, undefined)
    if (process.env.MD_READER_EXPECT_APP_ROOT) {
      const appRoot = vscode.env.appRoot
      await assert.rejects(fs.access(path.join(appRoot, 'node_modules', '@vscode', 'tree-sitter-wasm')), { code: 'ENOENT' })
      await assert.rejects(fs.access(path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'tree-sitter-wasm')), { code: 'ENOENT' })
    }
    checks.push('Tree-sitter configuration and runtime resources are absent')
    await fs.mkdir(path.join(root, 'pages'), { recursive: true })
    const htmlFile = path.join(root, 'pages', 'static-page.html')
    const htmlUri = vscode.Uri.file(htmlFile)
    await fs.writeFile(path.join(root, 'static-page.css'), 'body.fixture-theme .preview-probe {color: rgb(20, 40, 60)}')
    await fs.writeFile(path.join(root, 'static-page.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD9sAAAAASUVORK5CYII=', 'base64'))
    const writeHtml = text => fs.writeFile(htmlFile, `<!doctype html><html><head><link rel="stylesheet" href="../static-page.css"></head><body class="fixture-theme"><p class="preview-probe">${text}</p><img src="/static-page.png" onload="document.querySelector('.preview-probe').textContent = 'handler ran'"><a href="https://example.invalid">Outside</a><script>document.querySelector('.preview-probe').textContent = 'script ran'</script></body></html>`)
    await writeHtml('静态页面')
    await vscode.commands.executeCommand('vscode.open', htmlUri)
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType, 'mdReader.htmlPreview', 'HTML defaults to static preview')
    await waitFor(() => {
      const sample = api.htmlPreviews.get(htmlUri.toString())
      return sample?.text === '静态页面' && sample.color === 'rgb(20, 40, 60)' && sample.imageWidth === 1 && sample.blockedLink
    }, 'static HTML renders local CSS and images without executing code or enabling external navigation', 10000)
    await writeHtml('保存后更新')
    await waitFor(() => api.htmlPreviews.get(htmlUri.toString())?.text === '保存后更新', 'static HTML reloads after save', 10000)
    const stylesheet = await vscode.workspace.openTextDocument(path.join(root, 'static-page.css'))
    const styleEdit = new vscode.WorkspaceEdit()
    styleEdit.insert(stylesheet.uri, stylesheet.positionAt(stylesheet.getText().length), '\nbody.fixture-theme .preview-probe {color: rgb(60, 40, 20)}')
    assert.ok(await vscode.workspace.applyEdit(styleEdit))
    assert.ok(await stylesheet.save())
    await waitFor(() => api.htmlPreviews.get(htmlUri.toString())?.color === 'rgb(60, 40, 20)', 'static HTML reloads its local stylesheet after an editor save', 10000)
    await vscode.commands.executeCommand('mdReader.editSource')
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.toString() === htmlUri.toString(), 'HTML source opens')
    assert.ok(vscode.window.activeTextEditor.document.getText().includes('<script>'))
    await vscode.commands.executeCommand('mdReader.previewHtml')
    await waitFor(() => api.htmlPreviews.get(htmlUri.toString())?.text === '保存后更新', 'HTML returns to preview', 10000)
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    checks.push('static HTML defaults to preview, applies local CSS, disables scripts, refreshes on save and switches to source')
    if (process.env.MD_READER_EXPECT_START_FILE) {
      const startupUri = vscode.Uri.file(await fs.realpath(process.env.MD_READER_EXPECT_START_FILE))
      await waitFor(() => api.documents.has(startupUri.toString()), 'native CLI opens startup Markdown in preview', 15000)
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await waitFor(() => api.documents.size === 0, 'startup preview closed')
      checks.push('native CLI startup file defaults to reader preview')
    }
    const first = path.join(root, '中文 文档.md')
    const second = path.join(root, 'second.md')
    await fs.writeFile(first, '# 阅读器测试\n\nsearch-token search-token\n\n## 第二节\n\n$x^2$\n\n```mermaid\ngraph TD\nA-->B\n```\n')
    await fs.writeFile(second, '# Second document\n\n**Bold**\n')
    await api.openFile(first)
    const doc = api.documents.get(vscode.Uri.file(first).toString())
    assert.ok(doc)
    await waitFor(() => doc.result && doc.rendered === doc.version, 'first document painted')
    assert.equal(doc.result.mermaidCount, 1)
    assert.equal(doc.result.toc.length, 2)
    checks.push('custom readonly editor + Node parser + Webview rendered')
    api.send(doc, { type: 'search', query: 'search-token' })
    await waitFor(() => doc.matches?.total === 2, 'rendered text search')
    checks.push('rendered text search finds 2 matches')
    await api.openFile(second)
    const other = api.documents.get(vscode.Uri.file(second).toString())
    await waitFor(() => other?.rendered === other?.version && other?.result, 'second document painted')
    assert.equal(api.documents.size, 2)
    await api.openFile(first)
    await waitFor(() => doc.matches?.total === 2, 'search state after tab restore')
    checks.push('native multiple tabs and hidden Webview restoration')
    const old = doc.version
    await fs.writeFile(first, '# Updated externally\n\nsearch-token\n')
    await waitFor(() => doc.version > old && doc.result?.toc[0]?.text === 'Updated externally' && doc.rendered === doc.version, 'external file save')
    checks.push('external save refresh')
    await fs.rename(first, `${first}.backup`)
    await waitFor(() => doc.error, 'missing file error')
    await fs.rename(`${first}.backup`, first)
    await waitFor(() => !doc.error && doc.rendered === doc.version, 'file recreated')
    checks.push('delete/recreate recovery')
    const replacedVersion = doc.version
    const replacement = path.join(root, 'replacement.tmp')
    await fs.writeFile(replacement, '# Atomically replaced\n\nsearch-token\n')
    await fs.rename(replacement, first)
    await waitFor(() => doc.version > replacedVersion && doc.result?.toc[0]?.text === 'Atomically replaced' && doc.rendered === doc.version, 'atomic replacement refresh')
    checks.push('atomic replacement refreshes the existing document')
    const alias = `${root}-directory-alias`
    await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir').catch(error => { if (error.code !== 'EEXIST') throw error })
    const aliasUri = vscode.Uri.file(path.join(alias, path.basename(first)))
    const beforeAlias = vscode.window.tabGroups.all.flatMap(group => group.tabs).length
    await vscode.commands.executeCommand('vscode.open', aliasUri)
    await api.openFile(first)
    await waitFor(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).length === beforeAlias && api.documents.size === 2, 'path alias reuses the existing preview', 5000)
    assert.equal(doc.disposed, false)
    assert.equal(doc.state.query, 'search-token')
    checks.push('native path aliases reuse one preview and reading state')
    const tabCount = vscode.window.tabGroups.all.flatMap(group => group.tabs).length
    await vscode.commands.executeCommand('mdReader.editSource')
    await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath.toLowerCase() === first.toLowerCase(), 'source editor opened')
    const source = vscode.window.activeTextEditor
    assert.ok(await source.edit(edit => edit.insert(new vscode.Position(0, 0), '# Edited in source\n\n')))
    assert.equal(source.document.isDirty, true)
    await waitFor(() => {
      const headings = api.outlineProvider?.getChildren()
      return headings?.[0]?.text === 'Edited in source' && headings[1]?.line === 3
    }, 'outline follows the unsaved editor buffer', 5000)
    const heading = api.outlineProvider.getChildren()[1]
    const action = api.outlineProvider.getTreeItem(heading).command
    assert.ok(action, 'source outline item exposes a jump command')
    if (language) assert.equal(action.title, language === 'zh-cn' ? '跳转' : 'Go to heading')
    source.selection = new vscode.Selection(0, 0, 0, 0)
    await vscode.commands.executeCommand(action.command, ...action.arguments)
    assert.equal(source.selection.active.line, 2, 'chapter navigation reaches the moved heading without leaving source mode')
    assert.equal(vscode.window.activeTextEditor, source)
    assert.equal(source.document.isDirty, true)
    checks.push('source outline uses unsaved headings and jumps to the current source line')
    assert.ok(await source.document.save())
    assert.match(await fs.readFile(first, 'utf8'), /^# Edited in source/)
    await vscode.commands.executeCommand('mdReader.preview')
    await waitFor(() => api.documents.get(vscode.Uri.file(first).toString())?.result?.toc[0]?.text === 'Edited in source', 'preview after source save')
    await waitFor(() => api.outlineProvider.getChildren()[0]?.text === 'Edited in source', 'outline resumes preview headings', 5000)
    assert.equal(api.outlineProvider.getTreeItem(api.outlineProvider.getChildren()[0]).command.arguments.length, 1)
    assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, tabCount)
    checks.push('source editing saves to disk and returns to preview in the same tab')
    const fresh = path.join(root, 'freshly-opened.md')
    await fs.writeFile(fresh, '# Fresh Markdown file\n')
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(fresh))
    await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType === 'mdReader.preview', 'default Markdown preview')
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.fsPath.toLowerCase(), fresh.toLowerCase())
    checks.push('ordinary file open still defaults to Markdown preview')
    for (const extensionName of ['MD', 'markdown', 'mdown', 'mkd']) {
      const file = path.join(root, `default-preview.${extensionName}`)
      await fs.writeFile(file, '# Preview by default\n')
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file))
      await waitFor(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType === 'mdReader.preview', `${extensionName} preview`)
      assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.fsPath.toLowerCase(), file.toLowerCase())
    }
    const editedUri = vscode.window.tabGroups.activeTabGroup.activeTab.input.uri
    await vscode.commands.executeCommand('mdReader.editSource')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await vscode.commands.executeCommand('vscode.open', editedUri)
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType, 'mdReader.preview')
    checks.push('Markdown filename variants default to preview after explicit source editing')
    const navigationFile = path.join(root, 'search-navigation.md')
    await fs.writeFile(navigationFile, Array.from({ length: 120 }, (_, i) => `## Section ${i}\n\nParagraph ${i}\n\n`).join(''))
    const navigationUri = vscode.Uri.file(navigationFile)
    await vscode.commands.executeCommand('vscode.open', navigationUri, { selection: new vscode.Range(240, 0, 240, 8), preserveFocus: true })
    // Headings have a 20px scroll margin. The viewport's semantic anchor can
    // therefore be the preceding paragraph while the target heading is visible.
    const nearLine = line => {
      const state = api.documents.get(navigationUri.toString())?.state
      return state?.scrollTop > 0 && state.anchor?.line >= line - 2 && state.anchor?.line <= line
    }
    await waitFor(() => nearLine(241), 'source selection reaches preview block', 10000)
    await vscode.commands.executeCommand('vscode.open', navigationUri, { selection: new vscode.Range(320, 0, 320, 8), preserveFocus: true })
    await waitFor(() => nearLine(321), 'second source selection reaches existing preview', 10000)
    checks.push('source search selections reveal their rendered block in new and existing previews')
    const picture = path.join(root, '图片 sample.png')
    await fs.writeFile(picture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD9sAAAAASUVORK5CYII=', 'base64'))
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(picture))
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.label, path.basename(picture))
    assert.notEqual(vscode.window.tabGroups.activeTabGroup.activeTab.input?.viewType, 'mdReader.preview')
    checks.push('native image preview opens an associated workspace file')
    await api.openFolder(root)
    await vscode.commands.executeCommand('workbench.view.extension.mdReader-outline')
    checks.push('native outline container opens')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await waitFor(() => api.documents.size === 0, 'documents closed before alias-first open')
    await vscode.commands.executeCommand('vscode.open', aliasUri)
    const aliasDoc = api.documents.get(aliasUri.toString())
    await waitFor(() => aliasDoc?.result && aliasDoc.rendered === aliasDoc.version, 'alias-first document rendered')
    await api.openFile(first)
    await waitFor(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).length === 1 && api.documents.size === 1, 'canonical open reuses the first alias URI', 5000)
    assert.equal(aliasDoc.disposed, false)
    assert.equal(aliasDoc.state.query, 'search-token')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await waitFor(() => api.documents.size === 0, 'alias document closed')
    await api.openFile(first)
    const reopened = api.documents.get(vscode.Uri.file(first).toString())
    await waitFor(() => reopened?.result && reopened.rendered === reopened.version, 'canonical document reopened after alias close')
    assert.equal(reopened.state.query, 'search-token')
    checks.push('alias-first opens and close/reopen retain one canonical reading state')
    const editing = await require('./editing-integration.cjs').run({ api, root, waitFor })
    checks.push(...editing.checks)
    if (process.env.MD_READER_EXPECT_APP_ROOT) {
      assert.equal(vscode.extensions.all.filter(item => item.isActive && item.id !== extension.id).length, 0)
      checks.push('reader is the only active runtime extension')
    }
    await vscode.commands.executeCommand('workbench.view.explorer')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await waitFor(() => api.documents.size === 0, 'close previews before extension host exits', 5000)
    const report = { passed: true, vscode: vscode.version, appName: vscode.env.appName, appRoot: vscode.env.appRoot, node: process.versions.node, checks, manualChecks: editing.manualChecks, time: new Date().toISOString() }
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } catch (error) {
    await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: false, checks, error: String(error.stack ?? error) }, null, 2))
    throw error
  }
}
module.exports = { run }
