import { invoke } from '@tauri-apps/api/core'
import type { WorkspaceState } from '../documents/workspaceState'

const key = 'md-preview.workspace.v1'
export const stateBridge = {
  async load(): Promise<unknown> {
    if (import.meta.env.VITE_IPC_MOCK !== '1') return invoke('load_workspace_state')
    const saved = localStorage.getItem(key)
    if (!saved) return null
    try { return JSON.parse(saved) } catch { return null }
  },
  async save(state: WorkspaceState): Promise<void> {
    if (import.meta.env.VITE_IPC_MOCK === '1') localStorage.setItem(key, JSON.stringify(state))
    else await invoke('save_workspace_state', { state })
  },
}
