const fs = require('node:fs/promises')
const path = require('node:path')

const isMarkdown = (file) => /\.(md|markdown|mdown|mkd)$/i.test(file)
const isHtml = (file) => /\.html?$/i.test(file)
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }

function isWithin(root, file) {
  const relative = path.relative(root, file)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function resolveLocal(root, href) {
  if (typeof href !== 'string' || !href || href.length > 8192 || /[\x00-\x1f]/.test(href)) throw Error('无效路径')
  const raw = decodeURIComponent(href.split(/[?#]/)[0])
  if (!raw || /[\x00-\x1f]/.test(raw) || /^[a-z][\w+.-]*:/i.test(raw) || path.isAbsolute(raw) || raw.startsWith('\\') || raw.includes(':')) throw Error('不允许绝对路径或特殊协议')
  const canonicalRoot = await fs.realpath(root)
  return resolveLocalFile(canonicalRoot, path.resolve(canonicalRoot, raw))
}

// A resolved link is a filesystem path, not a URL. In particular, literal '#'
// and '%' in a filename must survive the second check before opening a tab.
async function resolveLocalFile(root, file) {
  if (typeof file !== 'string' || !file || file.length > 8192 || /[\x00-\x1f]/.test(file) || !path.isAbsolute(file)) throw Error('无效路径')
  const canonicalRoot = await fs.realpath(root)
  const lexical = path.resolve(file)
  if (path.relative(canonicalRoot, lexical).includes(':')) throw Error('不允许特殊文件流')
  if (!isWithin(canonicalRoot, lexical)) throw Error('目标位于文档目录之外')
  const resolved = await fs.realpath(lexical)
  if (!isWithin(canonicalRoot, resolved)) throw Error('目标位于文档目录之外')
  if (!(await fs.stat(resolved)).isFile()) throw Error('目标不是文件')
  return resolved
}

async function readMarkdown(file) {
  return readTextFile(file, isMarkdown, '仅支持 Markdown 文件', 64 * 1024 * 1024)
}

async function readTextFile(file, accepts, unsupportedMessage, maxBytes) {
  const canonical = await fs.realpath(file)
  if (!accepts(canonical)) throw Error(unsupportedMessage)
  const info = await fs.stat(canonical)
  if (!info.isFile() || info.size > maxBytes) throw Error(`文件超过 ${maxBytes / (1024 * 1024)} MiB 预览上限或无法读取`)
  const bytes = await fs.readFile(canonical)
  let encoding = 'utf-8'
  let offset = 0
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2 }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2 }
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3
  let text
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)) }
  catch { if (encoding !== 'utf-8' || offset) throw Error('文件编码无效'); encoding = 'gb18030'; text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  if (text.includes('\0')) throw Error('不支持二进制文件')
  return { path: canonical, text, encoding, size: bytes.length }
}

async function imageData(root, raw) {
  return imageDataFile(await resolveLocal(root, raw))
}

async function imageDataFile(file) {
  const mime = imageTypes[path.extname(file).toLowerCase()]
  if (!mime || (await fs.stat(file)).size > 10 * 1024 * 1024) throw Error('不支持该图片或图片过大')
  return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`
}

module.exports = { isMarkdown, isHtml, isWithin, resolveLocal, resolveLocalFile, readMarkdown, readTextFile, imageData, imageDataFile }
