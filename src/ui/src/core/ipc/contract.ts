// IPC 契约 —— 前端唯一真源。
//
// 与 Rust 侧 `src/host/src/ipc/dtos.rs` 一一对应。
// 两侧通过 `src/host/tests/snapshots/*.json` 做字段集合一致性断言，
// 任何一侧改动都会让 CI 立刻失败（见 docs/design/07-ipc-contract.md §8）。

// 文档元数据。重复打开同一 canonical path 时返回同一 docId。
export interface DocMeta {
  docId: string
    // canonical 绝对路径
  path: string
  dir: string
    // basename，含扩展名
  name: string
  size: number
  mtimeMs: number
    // "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030" | ...
  encoding: string
  hadBom: boolean
  version: number
    // 超过分段阈值，前端应启用分段模式
  tooLarge: boolean
}

// 批量资源解析结果。verdict 为 ok 时 absPath 必有值。
export interface ResolvedAsset {
  raw: string
  verdict: 'ok' | 'outside' | 'notFound' | 'invalid'
  absPath?: string
}

// 链接分类结果 —— FR-019 的唯一真源在 Rust `resolve_link`。
// 前端不得自行判断 scheme 或扩展名，只能按 kind 分发。
export type ResolvedLink =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'localMd'; absPath: string; anchor?: string }
  | { kind: 'asset'; absPath: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked'; reason: string }

// 诊断面板所需的环境信息。
export interface EnvInfo {
  appVersion: string
  tauriVersion: string
  rustVersion: string
  os: string
  osVersion: string
  webviewVersion: string
  locale: string
}

export type ErrorCode =
  | 'E_FILE_NOT_FOUND'
  | 'E_FILE_ACCESS'
  | 'E_FILE_TOO_LARGE'
  | 'E_ENCODING'
  | 'E_PATH_FORBIDDEN'
  | 'E_DOC_UNKNOWN'
  | 'E_WATCH_FAILED'
  | 'E_ASSET_FORBIDDEN'
  | 'E_URL_BLOCKED'
  | 'E_INTERNAL'

export interface IpcError {
  code: ErrorCode
  message: string
  detail?: string
}

// ---------- 事件 payload（Rust → 前端） ----------

export interface DocChangedPayload {
  docId: string
  version: number
    // "modify" | "remove"
  kind: string
}

export interface DocGonePayload {
  docId: string
  version: number
}

export interface OpenFilesPayload {
  paths: string[]
}

export interface AppErrorPayload {
  code: string
  message: string
  detail?: string
}

export const EVENT = {
  DOC_CHANGED: 'doc:changed',
  DOC_GONE: 'doc:gone',
  APP_OPEN_FILES: 'app:open-files',
  APP_ERROR: 'app:error',
} as const

// 事件名单独导出，供 mockBridge 与 events.ts 直接引用。
export const DOC_CHANGED = EVENT.DOC_CHANGED
export const DOC_GONE = EVENT.DOC_GONE
export const APP_OPEN_FILES = EVENT.APP_OPEN_FILES
export const APP_ERROR = EVENT.APP_ERROR

// 链接被拦截时的中文提示（FR-019 §6）。
export const LINK_BLOCKED_REASONS: Readonly<Record<string, string>> = {
  empty: '链接地址为空',
  scheme: '出于安全考虑，不允许打开该类型链接',
  'unknown-scheme': '不支持的链接类型',
  'outside-scope': '目标位于当前文档目录之外，已被阻止',
  'target-not-found': '目标文件不存在',
  'invalid-path': '目标路径无效',
}
