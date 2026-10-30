import type { DocMeta, EnvInfo, ResolvedAsset, ResolvedLink } from './contract'

// 前端唯一 IPC 入口。
//
// `core/**`、`workers/**` 不得直接 import `@tauri-apps/api`，
// 一律经此接口访问（由 Biome `noRestrictedImports` 强制）。
//
// 两个实现：
// - tauriBridge：生产环境，包装 `invoke`
// - mockBridge：Vitest / Playwright / 纯浏览器预览，基于 fixtures
export interface IpcBridge {
  openDocument(path: string): Promise<DocMeta>
    // 返回原始字节，解码在前端按 DocMeta.encoding 完成
  readDocument(docId: string): Promise<Uint8Array>
  readDocumentMeta(docId: string): Promise<DocMeta>
  closeDocument(docId: string): Promise<void>

    // 批量解析资源路径，上限 500 条/次，超出由调用方分批
  resolveAssets(docId: string, raws: string[]): Promise<ResolvedAsset[]>
    // 链接分类（FR-019），Rust 为唯一真源
  resolveLink(docId: string, href: string): Promise<ResolvedLink>

  revealDocument(docId: string): Promise<void>
    // 仅 http/https/mailto，Rust 侧二次校验
  openUrl(url: string): Promise<void>
    // 本地附件交系统默认程序，Rust 侧再次经 path_guard 校验
  openPathWithSystem(docId: string, absPath: string): Promise<void>

  getStartupPaths(): Promise<string[]>
  getEnvInfo(): Promise<EnvInfo>
}

// 把所有底层异常规整为带 code 的结构化错误，避免上层处理裸字符串。
export function toIpcError(err: unknown): { code: string; message: string; detail?: string } {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code: string; message: string; detail?: string }
    return e
  }
  if (err instanceof Error) {
    const out: { code: string; message: string; detail?: string } = {
      code: 'E_INTERNAL',
      message: err.message,
    }
    if (err.stack !== undefined) out.detail = err.stack
    return out
  }
  return { code: 'E_INTERNAL', message: String(err) }
}
