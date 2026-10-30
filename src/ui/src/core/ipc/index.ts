import type { IpcBridge } from './bridge'
import { mockBridge } from './mockBridge'
import { tauriBridge } from './tauriBridge'

// 桥接选择器。
//
// VITE_IPC_MOCK=1 时使用 mockBridge（Vitest / Playwright / 纯浏览器预览），
// 否则使用 tauriBridge（生产 Tauri 环境）。
//
// 用 import.meta.env 而不是运行期探测 window.__TAURI__，
// 因为生产构建已设置 withGlobalTauri: false，该全局对象不存在。
export const isMock = import.meta.env.VITE_IPC_MOCK === '1'

export const bridge: IpcBridge = isMock ? mockBridge : tauriBridge

export * from './contract'
export type { IpcBridge }
