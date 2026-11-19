const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { imageDataFile, isHtml, isWithin, readTextFile, resolveLocalFile } = require('./security.cjs')

const mib = 1024 * 1024

async function localAsset(root, directory, asset) {
  if (!['image', 'stylesheet'].includes(asset?.kind) || typeof asset.url !== 'string' || asset.url.length > 8192) return
  const relative = decodeURIComponent(asset.url.trim().split(/[?#]/)[0])
  if (!relative || relative.startsWith('//') || /[\x00-\x1f\\:]/.test(relative)) return
  // Match static site paths inside the opened workspace. Outside a workspace,
  // the page's directory is the root and parent paths remain out of bounds.
  const file = await resolveLocalFile(root, relative.startsWith('/')
    ? path.resolve(root, relative.slice(1)) : path.resolve(directory, relative))
  if (asset.kind === 'image') return { file, url: await imageDataFile(file) }
  const { text } = await readTextFile(file, name => path.extname(name).toLowerCase() === '.css', '仅支持 CSS 文件', mib)
  return { file, url: `data:text/css;charset=utf-8;base64,${Buffer.from(text).toString('base64')}` }
}

function registerHtmlPreview(vscode, context) {
  const samples = new Map()
  const test = !!process.env.MD_READER_TEST_ROOT
  const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'html-preview', 'render.js')
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('mdReader.htmlPreview', {
    async openCustomDocument(uri) {
      if (uri.scheme !== 'file' || uri.authority || !isHtml(uri.fsPath)) throw Error('仅支持本地 HTML 文件')
      const file = await fsp.realpath(uri.fsPath)
      const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri
      const project = folder?.scheme === 'file' && !folder.authority ? await fsp.realpath(folder.fsPath).catch(() => undefined) : undefined
      const root = project && isWithin(project, file) ? project : path.dirname(file)
      return { uri, file, root, dispose() {} }
    },
    resolveCustomEditor(doc, panel) {
      const { webview } = panel
      const directory = path.dirname(doc.file)
      const key = doc.uri.toString()
      const nonce = randomBytes(18).toString('base64')
      const language = vscode.env.language === 'zh-cn' ? 'zh-CN' : 'en'
      webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'html-preview')] }
      const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' data:; img-src data:; frame-src 'self'; base-uri 'none'; form-action 'none'`
      let generation = 0
      let ready = false
      let disposed = false
      let timer
      let needsRefresh = true
      let stylesheets = new Set()

      async function refresh() {
        needsRefresh = true
        if (!ready || !panel.visible) return
        needsRefresh = false
        const current = ++generation
        try {
          const { text } = await readTextFile(doc.file, isHtml, '仅支持 HTML 文件', 4 * mib)
          if (!disposed && current === generation) await webview.postMessage({ type: 'document', generation: current, text, test })
        } catch (error) {
          if (!disposed && current === generation) await webview.postMessage({ type: 'error', message: String(error.message ?? error) })
        }
      }

      const messages = webview.onDidReceiveMessage(async message => {
        if (disposed) return
        if (message?.type === 'ready') {
          ready = true
          await refresh()
        } else if (message?.type === 'assets' && message.generation === generation && Array.isArray(message.assets) && message.assets.length <= 64) {
          let remaining = 16 * mib
          const urls = []
          const loadedStylesheets = new Set()
          for (const asset of message.assets) {
            if (disposed || message.generation !== generation) return
            const resolved = remaining > 0 ? await localAsset(doc.root, directory, asset).catch(() => undefined) : undefined
            const url = resolved?.url
            if (url && url.length <= remaining) {
              remaining -= url.length
              urls.push(url)
              if (asset.kind === 'stylesheet') loadedStylesheets.add(resolved.file)
            } else {
              urls.push(null)
            }
          }
          if (!disposed && message.generation === generation) {
            stylesheets = loadedStylesheets
            await webview.postMessage({ type: 'assets', generation, urls })
          }
        } else if (test && message?.type === 'painted' && message.generation === generation) {
          samples.set(key, message.sample)
        }
      })
      const view = panel.onDidChangeViewState(() => { if (panel.visible && needsRefresh) void refresh() })
      const stylesheetSave = vscode.workspace.onDidSaveTextDocument(async document => {
        if (document.uri.scheme !== 'file' || path.extname(document.uri.fsPath).toLowerCase() !== '.css') return
        const file = await fsp.realpath(document.uri.fsPath).catch(() => undefined)
        if (!disposed && stylesheets.has(file)) void refresh()
      })
      const watcher = fs.watch(directory, (_event, name) => {
        if (!name || String(name).toLowerCase() === path.basename(doc.file).toLowerCase()) {
          clearTimeout(timer)
          timer = setTimeout(() => void refresh(), 120)
        }
      })
      watcher.on('error', () => { if (!disposed) void webview.postMessage({ type: 'error', message: 'HTML 文件监听不可用，请重新打开文件。' }) })
      panel.onDidDispose(() => {
        disposed = true
        clearTimeout(timer)
        watcher.close()
        messages.dispose()
        view.dispose()
        stylesheetSave.dispose()
        samples.delete(key)
      })
      webview.html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;padding:0}iframe{display:block}</style></head><body><script nonce="${nonce}" src="${webview.asWebviewUri(scriptPath)}"></script></body></html>`
    },
  }, { supportsMultipleEditorsPerDocument: false }))
  return samples
}

module.exports = { registerHtmlPreview }
