import { invoke } from '@tauri-apps/api/core'
import type { IpcBridge } from './bridge'
import type { DocMeta, EnvInfo, ResolvedAsset, ResolvedLink } from './contract'

/** 生产实现。Tauri 侧命令名与入参字段见 docs/design/07-ipc-contract.md §2。 */
export const tauriBridge: IpcBridge = {
  async openDocument(path) {
    return invoke<DocMeta>('open_document', { path })
  },

  async readDocument(docId) {
    // 优先走 tauri::ipc::Response 的 ArrayBuffer 通道（避免 JSON 数组膨胀）
    const buf = await invoke<ArrayBuffer>('read_document', { docId })
    return new Uint8Array(buf)
  },

  async readDocumentMeta(docId) {
    return invoke<DocMeta>('read_document_meta', { docId })
  },

  async closeDocument(docId) {
    return invoke<void>('close_document', { docId })
  },

  async resolveAssets(docId, raws) {
    return invoke<ResolvedAsset[]>('resolve_assets', { docId, raws })
  },

  async resolveLink(docId, href) {
    return invoke<ResolvedLink>('resolve_link', { docId, href })
  },

  async revealDocument(docId) {
    return invoke<void>('reveal_document', { docId })
  },

  async openUrl(url) {
    return invoke<void>('open_url', { url })
  },

  async openPathWithSystem(docId, absPath) {
    return invoke<void>('open_path_with_system', { docId, path: absPath })
  },

  async getStartupPaths() {
    return invoke<string[]>('get_startup_paths')
  },

  async getEnvInfo() {
    return invoke<EnvInfo>('get_env_info')
  },
}
