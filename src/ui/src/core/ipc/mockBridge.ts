import type { IpcBridge } from './bridge'
import {
  DOC_CHANGED,
  DOC_GONE,
  type DocChangedPayload,
  type DocGonePayload,
  type DocMeta,
  type EnvInfo,
  type ResolvedAsset,
  type ResolvedLink,
} from './contract'

// 无 Tauri 环境下的桥接实现。
//
// 用途：Vitest、Playwright、以及纯浏览器里预览 UI（`VITE_IPC_MOCK=1`）。
// 数据来源是仓库根目录的 `fixtures/`，通过 Vite 的 `import.meta.glob` 以原始文本引入，
// 因此不需要文件系统访问，也不需要启动 Rust。

// 夹具内容来自构建期生成的静态模块。
// 不用 import.meta.glob 的原因：Vite 的 glob 不允许跳出项目根（root = src/ui），
// 越界模式会静默匹配到 0 个文件 —— 实测只拿到 basic.md 一个。
// 生成方式：node src/bench/gen-fixture-manifest.mjs
import { FIXTURE_MANIFEST, FIXTURE_PATHS } from './fixture-manifest.generated'

interface MockDoc {
  meta: DocMeta
  text: string
  gone: boolean
}

const docs = new Map<string, MockDoc>()
const byPath = new Map<string, string>()

let versionSeq = 0
let documentSeq = 0

function nextVersion(): number {
  versionSeq += 1
  return versionSeq
}

// 把 glob 键（`../../../../../fixtures/a/b.md`）还原为仓库相对路径 `fixtures/a/b.md`。
function fixtureFor(path: string): string | undefined {
  // 清单键是仓库相对 fixtures 的路径（如 `tabs/a.md`、`extended.md`）。
  // 调用方可能传入 `fixtures/a.md` 或 `a.md`，统一剥离前缀后再查。
  const rel = path.replace(/^fixtures\//, '').replace(/\\/g, '/')
  return FIXTURE_MANIFEST[rel]
}

function guessEncoding(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? 'utf-8-bom' : 'utf-8'
}

function buildMeta(docId: string, path: string, text: string): DocMeta {
  const name = path.split('/').pop() ?? path
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'fixtures'
  return {
    docId,
    path,
    dir,
    name,
    size: new TextEncoder().encode(text).byteLength,
    mtimeMs: 0,
    encoding: guessEncoding(text),
    hadBom: text.charCodeAt(0) === 0xfeff,
    version: nextVersion(),
    tooLarge: false,
  }
}

// 供 E2E 断言：已打开的 mock 文档路径列表。
export function mockOpenedPaths(): string[] {
  return [...docs.values()].map((d) => d.meta.path)
}

// 清空 mock 状态，测试之间隔离用。
export function mockReset(): void {
  docs.clear()
  byPath.clear()
  versionSeq = 0
  documentSeq = 0
}

// 列出所有可用 fixture 的仓库相对路径。
export function mockAvailableFixtures(): string[] {
  return [...FIXTURE_PATHS]
}

function openMock(path: string): DocMeta {
  const normalized = path.replace(/\\/g, '/')
  const existingId = byPath.get(normalized)
  if (existingId) {
    const existing = docs.get(existingId)
    if (existing && !existing.gone) return existing.meta
    // 文件曾被删除，重新打开视为同一文档的新版本
    if (existing) {
      existing.gone = false
      existing.meta = { ...existing.meta, version: nextVersion() }
      return existing.meta
    }
  }

  const text = fixtureFor(normalized)
  if (text === undefined) {
    throw { code: 'E_FILE_NOT_FOUND', message: `fixture 不存在：${normalized}` }
  }

  const docId = `mock-${++documentSeq}`
  const meta = buildMeta(docId, normalized, text)
  docs.set(docId, { meta, text, gone: false })
  byPath.set(normalized, docId)
  return meta
}

function requireDoc(docId: string): MockDoc {
  const doc = docs.get(docId)
  if (!doc) throw { code: 'E_DOC_UNKNOWN', message: `未知文档：${docId}` }
  if (doc.gone) throw { code: 'E_FILE_NOT_FOUND', message: '文件已被移除' }
  return doc
}

function classifyLink(docId: string, href: string): ResolvedLink {
  const doc = requireDoc(docId)
  const s = href.trim()
  if (s === '') return { kind: 'blocked', reason: 'empty' }

  if (s.startsWith('#')) {
    try { return { kind: 'anchor', anchor: decodeURIComponent(s.slice(1)) } }
    catch { return { kind: 'blocked', reason: 'invalid-path' } }
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s)
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase()
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      return { kind: 'external', url: s }
    }
    if (
      scheme === 'javascript' ||
      scheme === 'vbscript' ||
      scheme === 'data' ||
      scheme === 'file' ||
      scheme === 'asset'
    ) {
      return { kind: 'blocked', reason: 'scheme' }
    }
    return { kind: 'blocked', reason: 'unknown-scheme' }
  }

  return classifyLocalLink(doc, s)
}

function classifyLocalLink(doc: MockDoc, s: string): ResolvedLink {
  const hashIndex = s.indexOf('#')
  let pathPart: string
  let anchor: string | undefined
  try {
    pathPart = decodeURIComponent((hashIndex >= 0 ? s.slice(0, hashIndex) : s).split('?')[0] ?? '').replace(/\\/g, '/')
    anchor = hashIndex >= 0 ? decodeURIComponent(s.slice(hashIndex + 1)) : undefined
  } catch { return { kind: 'blocked', reason: 'invalid-path' } }
  if (pathPart.startsWith('/') || pathPart.includes(':') || pathPart.includes('\0')) return { kind: 'blocked', reason: 'outside-scope' }
  const parts = relativeParts(pathPart)
  if (!parts) return { kind: 'blocked', reason: 'outside-scope' }
  const directory = doc.meta.path.includes('/') ? doc.meta.path.slice(0, doc.meta.path.lastIndexOf('/') + 1) : ''
  pathPart = directory + parts.join('/')

  if (/\.(md|markdown|mdown|mkd)$/i.test(pathPart)) {
    const found = fixtureFor(pathPart) !== undefined
    if (!found) return { kind: 'blocked', reason: 'target-not-found' }
    return anchor !== undefined
      ? { kind: 'localMd', absPath: pathPart, anchor }
      : { kind: 'localMd', absPath: pathPart }
  }

  if (fixtureFor(pathPart) !== undefined) {
    return { kind: 'asset', absPath: pathPart }
  }
  return { kind: 'blocked', reason: 'target-not-found' }
}

function relativeParts(path: string): string[] | null {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (!parts.length) return null; parts.pop() }
    else parts.push(part)
  }
  return parts
}

export const mockBridge: IpcBridge = {
  async openDocument(path) {
    return openMock(path)
  },

  async readDocument(docId) {
    const doc = requireDoc(docId)
    return new TextEncoder().encode(doc.text)
  },

  async readDocumentMeta(docId) {
    return requireDoc(docId).meta
  },

  async closeDocument(docId) {
    const doc = docs.get(docId)
    if (!doc) return
    byPath.delete(doc.meta.path)
    docs.delete(docId)
  },

  async resolveAssets(_docId, raws) {
    return raws.map((raw): ResolvedAsset => {
      if (/^https?:/i.test(raw)) return { raw, verdict: 'outside' }
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return { raw, verdict: 'invalid' }
      if (/^\.\.\//.test(raw)) return { raw, verdict: 'outside' }
      return { raw, verdict: 'ok', absPath: raw }
    })
  },

  async resolveLink(docId, href) {
    return classifyLink(docId, href)
  },

  async revealDocument() {
        // mock 下无操作
  },

  async openUrl(url) {
    mockOpenedUrls.push(url)
  },

  async openPathWithSystem(_docId, absPath) {
    mockOpenedPaths3rdParty.push(absPath)
  },

  async getStartupPaths() {
    return []
  },

  async getEnvInfo(): Promise<EnvInfo> {
    return {
      appVersion: '0.1.0-mock',
      tauriVersion: 'mock',
      rustVersion: 'mock',
      os: 'mock',
      osVersion: 'mock',
      webviewVersion: 'mock',
      locale: 'zh-CN',
    }
  },
}

// E2E 断言用：记录被交外部的 URL 与本地路径。
export const mockOpenedUrls: string[] = []
export const mockOpenedPaths3rdParty: string[] = []

// 模拟 Rust 侧事件（文件变更 / 删除）。
// 仅 mock 环境可用；生产环境由 Tauri `listen` 提供。
type MockEventHandler = (payload: unknown) => void
const listeners = new Map<string, Set<MockEventHandler>>()

export function mockOn(event: string, handler: MockEventHandler): () => void {
  const set = listeners.get(event) ?? new Set()
  set.add(handler)
  listeners.set(event, set)
  return () => set.delete(handler)
}

function emit(event: string, payload: unknown): void {
  for (const handler of listeners.get(event) ?? []) handler(payload)
}

// 模拟外部修改：递增版本并广播 `doc:changed`。E2E-11/E2E-12 使用。
export function mockEmitChanged(docId: string, text?: string): void {
  const doc = docs.get(docId)
  if (!doc) return
  doc.gone = false
  if (text !== undefined) doc.text = text
  doc.meta = { ...doc.meta, version: nextVersion(), size: new TextEncoder().encode(doc.text).byteLength }
  const payload: DocChangedPayload = { docId, version: doc.meta.version, kind: 'modify' }
  emit(DOC_CHANGED, payload)
}

// 模拟文件被删除：广播 `doc:gone`。E2E-13 使用。
export function mockEmitGone(docId: string): void {
  const doc = docs.get(docId)
  if (!doc) return
  doc.gone = true
  doc.meta = { ...doc.meta, version: nextVersion() }
  const payload: DocGonePayload = { docId, version: doc.meta.version }
  emit(DOC_GONE, payload)
}
