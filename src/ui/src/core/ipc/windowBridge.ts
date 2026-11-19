import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export interface NativeWindowHandle {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  onResized(callback: () => void): Promise<() => void>
}

export interface WindowBridge {
  readonly available: boolean
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  watchMaximized(onChange: (maximized: boolean) => void, onError: (cause: unknown) => void): () => void
}

export function createWindowBridge(native: NativeWindowHandle | null): WindowBridge {
  const unavailable = () => Promise.reject(new Error('窗口控制仅在桌面应用中可用'))
  return {
    available: native !== null,
    minimize: () => native ? native.minimize() : unavailable(),
    toggleMaximize: () => native ? native.toggleMaximize() : unavailable(),
    close: () => native ? native.close() : unavailable(),
    watchMaximized(onChange, onError) {
      if (!native) return () => undefined
      let active = true
      let version = 0
      let unlisten: (() => void) | undefined
      const refresh = async () => {
        const request = ++version
        try {
          const value = await native.isMaximized()
          if (active && version === request) onChange(value)
        } catch (cause) { if (active && version === request) onError(cause) }
      }
      void (async () => {
        try {
          const stop = await native.onResized(() => { void refresh() })
          if (!active) { stop(); return }
          unlisten = stop
          await refresh()
        } catch (cause) { if (active) onError(cause) }
      })()
      return () => {
        if (!active) return
        active = false
        unlisten?.()
        unlisten = undefined
      }
    },
  }
}

export const windowBridge = createWindowBridge(isTauri() ? getCurrentWindow() : null)
