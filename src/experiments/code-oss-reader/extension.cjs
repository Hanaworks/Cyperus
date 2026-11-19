const vscode = require('vscode')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { Worker } = require('node:worker_threads')
const { isMarkdown, isHtml, isWithin, resolveLocal, resolveLocalFile, readMarkdown, imageData } = require('./security.cjs')
const external = require('./external-apps.cjs')
const { reopenSingleEditor } = require('./document-actions.cjs')
const { registerHtmlPreview } = require('./html-preview.cjs')
const t = message => vscode.l10n.t(message)

async function activate(context) {
  const performanceConfig = process.env.MD_READER_PERF_CONFIG
  if (performanceConfig) {
    const probeRoot = fs.realpathSync(path.join(context.extensionPath, '../../../artifacts/code-oss/performance'))
    if (!isWithin(probeRoot, fs.realpathSync(performanceConfig))) throw Error('Performance probe must use the isolated benchmark directory')
  }
  const documents = new Map()
  const readingStates = new Map()
  const fileKey = file => process.platform === 'win32' ? file.toLowerCase() : file
  const documentFor = file => [...documents.values()].find(doc => !doc.disposed && fileKey(doc.file) === fileKey(file))
  const jobs = new Map()
  let jobId = 0
  let active
  let sourceOutline
  let outlineTimer
  let externalApp = context.globalState.get('reader.externalApp')
  let discoveredApps
  let workerError
  const worker = new Worker(path.join(context.extensionPath, 'dist/worker/parse-worker.mjs'))
  worker.on('message', ({ id, result, error }) => {
    const job = jobs.get(id)
    jobs.delete(id)
    if (job) error ? job.reject(Error(error)) : job.resolve(result)
  })
  worker.on('error', (error) => { workerError = error; for (const job of jobs.values()) job.reject(error); jobs.clear() })
  context.subscriptions.push({ dispose: () => { clearTimeout(outlineTimer); sourceOutline = undefined; void worker.terminate(); for (const doc of documents.values()) doc.dispose() } })
  function parse(text, generation, outlineOnly = false) {
    if (workerError) return Promise.reject(workerError)
    const id = ++jobId
    return new Promise((resolve, reject) => { jobs.set(id, { resolve, reject }); worker.postMessage({ id, text, generation, outlineOnly }) })
  }
  const changes = { outline: new vscode.EventEmitter() }
  for (const event of Object.values(changes)) context.subscriptions.push(event)
  function updateActive(doc) {
    active = doc
    changes.outline.fire()
  }
  updateActive()
  const command = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, (...args) =>
    Promise.resolve().then(() => fn(...args)).catch((error) => { void vscode.window.showErrorMessage(String(error.message ?? error)); throw error })))
  async function openFile(file, anchor, preserveFocus = false) {
    const canonical = await fsp.realpath(file)
    if (!isMarkdown(canonical)) throw Error('仅支持 Markdown 文件')
    const uri = documentFor(canonical)?.uri ?? vscode.Uri.file(canonical)
    await vscode.commands.executeCommand('vscode.openWith', uri, 'mdReader.preview', { preview: false, preserveFocus })
    const doc = documents.get(uri.toString())
    if (anchor && doc) { doc.pendingAnchor = anchor; send(doc, { type: 'navigate', anchor }) }
  }
  async function targetUri(candidate) {
    const uri = candidate instanceof vscode.Uri ? candidate : vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri
    if (!uri || uri.scheme !== 'file' || uri.authority) throw Error('请先打开一个本地文件')
    if (!(await fsp.stat(uri.fsPath)).isFile()) throw Error('目标不是文件')
    return uri
  }
  async function switchEditor(candidate, editorId) {
    const uri = await targetUri(candidate)
    const previewId = isMarkdown(uri.fsPath) ? 'mdReader.preview' : isHtml(uri.fsPath) ? 'mdReader.htmlPreview' : undefined
    if (!previewId || (editorId !== 'default' && editorId !== previewId)) throw Error('该文件类型没有对应的预览')
    if (editorId === previewId) {
      const text = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString() && doc.isDirty)
      if (text) {
        const save = t('Save and Preview')
        const choice = await vscode.window.showWarningMessage(t('Save changes and return to preview?'), { modal: true, detail: t('The preview shows the last saved contents. Cancel to continue editing.') }, save)
        if (choice !== save || !await text.save()) return
      }
    }
    await reopenSingleEditor(vscode, uri, editorId)
  }
  async function openFolder(file) {
    const folder = await fsp.realpath(file)
    if (!(await fsp.stat(folder)).isDirectory()) throw Error('目标不是目录')
    if (vscode.workspace.workspaceFolders?.some(item => item.uri.fsPath.toLowerCase() === folder.toLowerCase())) {
      await vscode.commands.executeCommand('workbench.view.explorer')
    } else {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceReuseWindow: true })
    }
  }
  command('mdReader.editSource', candidate => switchEditor(candidate, 'default'))
  command('mdReader.preview', candidate => switchEditor(candidate, 'mdReader.preview'))
  command('mdReader.previewHtml', candidate => switchEditor(candidate, 'mdReader.htmlPreview'))
  const htmlPreviews = registerHtmlPreview(vscode, context)
  async function availableApps() {
    discoveredApps ??= external.discoverApplications()
    return discoveredApps
  }
  async function chooseExternal(candidate) {
    const uri = await targetUri(candidate)
    const apps = await availableApps()
    const selected = await vscode.window.showQuickPick([
      ...apps.map(app => ({ label: app.label, description: app.executable, app })),
      { label: t('Choose another application…'), action: 'choose' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: t('Open Terminal Here'), action: 'terminal' },
    ], { title: t('Open With'), placeHolder: t('Choose an application to open the current file') })
    if (!selected) return
    if (selected.action === 'terminal') return external.openTerminal(uri.fsPath)
    let app = selected.app
    if (selected.action === 'choose') {
      const files = await vscode.window.showOpenDialog({ title: t('Choose an External Application'), canSelectMany: false, filters: { [t('Application')]: ['exe'] } })
      if (!files?.[0]) return
      const executable = await external.validateApplication(files[0].fsPath)
      const name = path.basename(executable)
      app = { executable, label: /^code\.exe$/i.test(name) ? 'VS Code' : path.basename(name, path.extname(name)), kind: /^code\.exe$/i.test(name) ? 'code' : 'custom' }
    }
    if (!app) return
    await external.validateApplication(app.executable)
    externalApp = app
    await context.globalState.update('reader.externalApp', app)
    return openExternal(uri)
  }
  async function openExternal(candidate) {
    const uri = await targetUri(candidate)
    if (!externalApp) return chooseExternal(uri)
    try { await external.validateApplication(externalApp.executable) }
    catch {
      externalApp = undefined
      await context.globalState.update('reader.externalApp', undefined)
      void vscode.window.showInformationMessage(t('The previously selected application is unavailable. Please choose another.'))
      return chooseExternal(uri)
    }
    const text = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString() && doc.isDirty)
    if (text) {
      const save = t('Save and Open')
      const choice = await vscode.window.showWarningMessage(t('Save changes before opening in the external application?'), { modal: true }, save)
      if (choice !== save || !await text.save()) return
    }
    return external.launchApplication(externalApp, uri.fsPath)
  }
  async function revealFile(candidate) { return vscode.commands.executeCommand('revealFileInOS', await targetUri(candidate)) }
  command('mdReader.openExternal', openExternal)
  command('mdReader.chooseExternal', chooseExternal)
  command('mdReader.revealFile', revealFile)
  command('mdReader.open', async () => {
    const files = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Markdown: ['md', 'markdown', 'mdown', 'mkd'] } })
    for (const file of files ?? []) await openFile(file.fsPath)
  })
  command('mdReader.folder', async () => {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false })
    if (picked?.[0]) await openFolder(picked[0].fsPath)
  })
  command('mdReader.heading', (heading, sourceTarget) => {
    const editor = currentSourceEditor()
    if (sourceTarget) {
      if (editor?.document.uri.toString() !== sourceTarget.uri || editor.document.version !== sourceTarget.version) return
      const position = new vscode.Position(heading.line - 1, 0)
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    } else if (!editor && active) {
      send(active, { type: 'navigate', anchor: heading.id })
    }
  })
  command('mdReader.search', async () => {
    const doc = active
    if (!doc) return
    const query = await vscode.window.showInputBox({ prompt: t('Find in the current preview'), value: doc.state.query ?? '', placeHolder: t('Type to search. Clear the text to remove highlighting.') })
    if (query === undefined) return
    doc.state.query = query.slice(0, 1024)
    send(doc, { type: 'search', query: doc.state.query })
  })
  command('mdReader.nextMatch', () => { if (active) send(active, { type: 'moveMatch', delta: 1 }) })
  command('mdReader.previousMatch', () => { if (active) send(active, { type: 'moveMatch', delta: -1 }) })
  command('mdReader.theme', async () => {
    const doc = active
    if (!doc) return
    const picked = await vscode.window.showQuickPick([{ label: t('Light'), value: 'light' }, { label: t('Dark'), value: 'dark' }, { label: t('Paper'), value: 'paper' }], { placeHolder: t('Reading theme') })
    if (picked) { doc.theme = picked.value; await context.globalState.update('reader.theme', doc.theme); send(doc, { type: 'theme', theme: doc.theme }); updateActive(doc) }
  })
  function currentSourceEditor() {
    const editor = vscode.window.activeTextEditor
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    if (editor && input instanceof vscode.TabInputText && input.uri.toString() === editor.document.uri.toString()
      && editor.document.uri.scheme === 'file' && isMarkdown(editor.document.uri.fsPath)) return editor
  }
  function updateSourceOutline() {
    const document = currentSourceEditor()?.document
    if (document && sourceOutline?.document === document && sourceOutline.version === document.version) return
    clearTimeout(outlineTimer)
    const previous = sourceOutline
    sourceOutline = document ? { document, version: document.version, headings: [] } : undefined
    if (previous || sourceOutline) changes.outline.fire()
    if (!sourceOutline) return
    const request = sourceOutline
    outlineTimer = setTimeout(async () => {
      try {
        const headings = await parse(document.getText(), request.version, true)
        if (sourceOutline !== request || currentSourceEditor()?.document !== document || document.version !== request.version) return
        request.headings = headings
        changes.outline.fire()
      } catch (error) {
        if (sourceOutline === request) console.error('Could not parse the Markdown source outline', error)
      }
    }, 120)
  }
  function outlineChildren(parent) {
    const editor = currentSourceEditor()
    const list = (editor ? sourceOutline?.document === editor.document && sourceOutline.headings : active?.result?.toc) || []
    if (parent && !list.includes(parent)) return []
    const children = []
    let start = parent ? list.indexOf(parent) + 1 : 0
    let level = 7
    for (; start < list.length; start++) {
      const entry = list[start]
      if (parent && entry.level <= parent.level) break
      if (entry.level < level) level = entry.level
    }
    start = parent ? list.indexOf(parent) + 1 : 0
    for (; start < list.length; start++) {
      const entry = list[start]
      if (parent && entry.level <= parent.level) break
      if (entry.level === level) children.push(entry)
    }
    return children
  }
  const outlineProvider = {
    onDidChangeTreeData: changes.outline.event,
    getChildren: outlineChildren,
    getTreeItem(heading) {
      const item = new vscode.TreeItem(heading.text, outlineChildren(heading).length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None)
      item.iconPath = new vscode.ThemeIcon('symbol-string')
      const editor = currentSourceEditor()
      if (editor) {
        if (sourceOutline?.document === editor.document && sourceOutline.headings.includes(heading)) {
          item.command = { command: 'mdReader.heading', title: t('Go to heading'), arguments: [heading, { uri: editor.document.uri.toString(), version: sourceOutline.version }] }
        }
      } else {
        item.command = { command: 'mdReader.heading', title: t('Go to heading'), arguments: [heading] }
      }
      return item
    },
  }
  context.subscriptions.push(vscode.window.registerTreeDataProvider('mdReader.outlineTree', outlineProvider))
  function send(doc, message) { for (const panel of doc.panels) if (panel.visible) void panel.webview.postMessage(message) }
  function render(doc, panel) {
    const message = doc.error ? { type: 'error', error: doc.error } : doc.result ? { type: 'render', result: doc.result, state: doc.state, theme: doc.theme, anchor: doc.pendingAnchor } : { type: 'loading' }
    void panel.webview.postMessage({ ...message, performanceProbe: !!performanceConfig })
  }
  async function refresh(doc) {
    const version = ++doc.version
    try {
      const data = await readMarkdown(doc.file)
      const result = await parse(data.text, version)
      if (doc.disposed || version !== doc.version) return
      doc.result = result; doc.encoding = data.encoding; doc.error = undefined
      for (const panel of doc.panels) if (panel.visible) render(doc, panel)
      if (active === doc) updateActive(doc)
    } catch (error) {
      if (doc.disposed || version !== doc.version) return
      doc.error = String(error.message ?? error)
      send(doc, { type: 'error', error: doc.error })
    }
  }
  function html(webview) {
    const nonce = randomBytes(18).toString('base64')
    const language = vscode.env.language === 'zh-cn' ? 'zh-CN' : 'en'
    const root = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')
    const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js'))
    const assets = fs.readdirSync(path.join(context.extensionPath, 'dist/webview/assets'))
    const css = assets.filter((name) => name.endsWith('.css')).map((name) => `<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(root, 'assets', name))}">`).join('')
    const csp = `default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src data: blob:; connect-src ${webview.cspSource};`
    return `<!doctype html><html lang="${language}"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1">${css}</head><body><div id="app"></div><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`
  }
  async function rpc(doc, panel, message) {
    const { method, args } = message
    if (!Array.isArray(args)) throw Error('无效请求')
    if (method === 'resolveAssets') {
      const raws = args[1]
      if (!Array.isArray(raws) || raws.length > 500 || raws.some((raw) => typeof raw !== 'string' || raw.length > 8192)) throw Error('无效资源请求')
      return Promise.all(raws.map(async (raw) => { try { return { raw, verdict: 'ok', absPath: await imageData(path.dirname(doc.file), raw) } } catch { return { raw, verdict: 'invalid' } } }))
    }
    if (method === 'resolveLink') {
      const href = args[1]
      if (typeof href !== 'string' || href.length > 8192) throw Error('无效链接')
      if (href.startsWith('#')) return { kind: 'anchor', anchor: decodeURIComponent(href.slice(1)) }
      if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', url: href }
      try {
        const file = await resolveLocal(path.dirname(doc.file), href)
        if (!isMarkdown(file)) return { kind: 'blocked', reason: 'scheme' }
        const anchor = href.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : undefined
        return { kind: 'localMd', absPath: file, ...(anchor ? { anchor } : {}) }
      } catch { return { kind: 'blocked', reason: 'outside-scope' } }
    }
    if (method === 'openUrl') {
      const value = args[0]
      if (typeof value !== 'string' || value.length > 8192 || !/^(https?:|mailto:)/i.test(value)) throw Error('不支持该链接')
      // A modal makes a malicious document unable to launch many external URLs silently.
      const open = t('Open')
      if (await vscode.window.showInformationMessage(t('Open this link in the system application?'), { modal: true, detail: value }, open) === open) return vscode.env.openExternal(vscode.Uri.parse(value))
      return false
    }
    throw Error(`试验版未启用此操作：${method}`)
  }
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('mdReader.preview', {
    async openCustomDocument(uri) {
      if (uri.scheme !== 'file') throw Error('仅支持本地文件')
      const canonical = await fsp.realpath(uri.fsPath)
      if (!isMarkdown(canonical)) throw Error('仅支持 Markdown 文件')
      const stateKey = fileKey(canonical)
      const doc = { uri, file: canonical, panels: new Set(), state: readingStates.get(stateKey) ?? {}, theme: context.globalState.get('reader.theme', 'light'), version: 0, disposed: false,
        dispose() {
          this.disposed = true; clearTimeout(this.timer); this.watcher?.close()
          readingStates.delete(stateKey); readingStates.set(stateKey, this.state)
          if (readingStates.size > 50) readingStates.delete(readingStates.keys().next().value)
          documents.delete(uri.toString()); if (active === this) updateActive()
        } }
      documents.set(uri.toString(), doc)
      doc.watcher = fs.watch(path.dirname(canonical), (_event, name) => {
        if (!name || String(name).toLowerCase() === path.basename(canonical).toLowerCase()) { clearTimeout(doc.timer); doc.timer = setTimeout(() => void refresh(doc), 120) }
      })
      doc.watcher.on('error', () => { doc.error = '文件监听不可用，请重新打开文档'; send(doc, { type: 'error', error: doc.error }) })
      void refresh(doc)
      return doc
    },
    async resolveCustomEditor(doc, panel) {
      // Native Explorer/CLI opens can arrive through a directory alias. Keep
      // the first document's URI, tab and state; only dispose this extra panel.
      const existing = documentFor(doc.file)
      if (existing && existing !== doc) {
        await vscode.commands.executeCommand('vscode.openWith', existing.uri, 'mdReader.preview', {
          preview: false, preserveFocus: !panel.active, viewColumn: existing.panels.values().next().value?.viewColumn,
        })
        panel.dispose()
        return
      }
      doc.panels.add(panel)
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')] }
      panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message !== 'object' || typeof message.type !== 'string' || doc.disposed) return
        try {
          if (message.type === 'ready') {
            if (!Object.keys(doc.state).length && message.state && typeof message.state === 'object') doc.state = validState(message.state)
            render(doc, panel)
          } else if (message.type === 'state') doc.state = validState(message.state)
          else if (message.type === 'rendered') { doc.rendered = message.generation; doc.pendingAnchor = undefined; if (performanceConfig) doc.renderedAt = message.renderedAt }
          else if (message.type === 'benchmark' && performanceConfig) doc.benchmark = message
          else if (message.type === 'matches' && Number.isSafeInteger(message.total) && message.total >= 0) { doc.matches = { total: message.total } }
          else if (message.type === 'openLocal' && typeof message.file === 'string' && message.file.length < 8192) {
            const target = await resolveLocalFile(path.dirname(doc.file), message.file)
            await openFile(target, typeof message.anchor === 'string' ? message.anchor.slice(0, 2048) : undefined, message.activate === false)
          } else if (message.type === 'rpc' && Number.isSafeInteger(message.id) && typeof message.method === 'string') {
            try { await panel.webview.postMessage({ type: 'response', id: message.id, value: await rpc(doc, panel, message) }) }
            catch (error) { await panel.webview.postMessage({ type: 'response', id: message.id, error: String(error.message ?? error) }) }
          }
        } catch (error) { void vscode.window.showErrorMessage(String(error.message ?? error)) }
      }, undefined, context.subscriptions)
      panel.onDidDispose(() => doc.panels.delete(panel), undefined, context.subscriptions)
      panel.onDidChangeViewState(() => { if (panel.active) { updateActive(doc); if (panel.visible) render(doc, panel) } }, undefined, context.subscriptions)
      panel.webview.html = html(panel.webview)
      if (panel.active) updateActive(doc)
    },
  }, { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: false }))
  function onActiveTabChanged() {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    if (input?.viewType !== 'mdReader.preview' && active) updateActive()
    updateSourceOutline()
  }
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(onActiveTabChanged),
    vscode.window.tabGroups.onDidChangeTabGroups(onActiveTabChanged),
    vscode.window.onDidChangeActiveTextEditor(onActiveTabChanged),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length && currentSourceEditor()?.document === event.document) updateSourceOutline()
    }),
  )
  onActiveTabChanged()
  const api = { openFile, documents, openFolder, send, refresh, outlineProvider, htmlPreviews }
  void availableApps().then(apps => {
    if (!externalApp && apps[0]) externalApp = apps[0]
  }).catch(() => {})
  if (performanceConfig) void require('./performance.cjs').run(api, performanceConfig)
  return api
}

function validState(state) {
  if (!state || typeof state !== 'object') return {}
  const value = state.anchor
  const anchor = value && typeof value.text === 'string' && Number.isSafeInteger(value.line) && value.line > 0
    ? { text: value.text.slice(0, 256), line: value.line, ratio: Number.isFinite(value.ratio) ? Math.max(0, Math.min(1, value.ratio)) : 0,
      ...(typeof value.id === 'string' ? { id: value.id.slice(0, 1024) } : {}) } : undefined
  return { scrollTop: Number.isFinite(state.scrollTop) ? Math.max(0, state.scrollTop) : 0,
    query: typeof state.query === 'string' ? state.query.slice(0, 1024) : '', ...(anchor ? { anchor } : {}) }
}
module.exports = { activate }
