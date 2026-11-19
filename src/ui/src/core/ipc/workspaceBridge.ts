import { invoke } from '@tauri-apps/api/core'
import { FIXTURE_PATHS } from './fixture-manifest.generated'

export interface FolderRoot { rootId: string; path: string; name: string }
export interface FolderEntry { name: string; path: string; kind: 'directory' | 'markdown' | 'file' }
export interface DirectoryListing { entries: FolderEntry[]; truncated: boolean }
export interface WorkspaceBridge {
  selectFiles(): Promise<string[]>
  selectFolder(): Promise<string | null>
  openFolder(path: string): Promise<FolderRoot>
  listDirectory(rootId: string, path: string): Promise<DirectoryListing>
  closeFolder(rootId: string): Promise<void>
}

export const tauriWorkspaceBridge: WorkspaceBridge = {
  selectFiles: () => invoke<string[]>('select_files'),
  selectFolder: () => invoke<string | null>('select_folder'),
  openFolder: (path) => invoke<FolderRoot>('open_folder', { path }),
  listDirectory: (rootId, path) => invoke<DirectoryListing>('list_directory', { rootId, path }),
  closeFolder: (rootId) => invoke<void>('close_folder', { rootId }),
}

function normalizedFixturePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized.startsWith('/') || normalized.includes(':') || normalized.includes('\0') ||
    normalized.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw { code: 'E_PATH_FORBIDDEN', message: '目录路径无效' }
  }
  return normalized
}

export function createMockWorkspaceBridge(paths: readonly string[] = FIXTURE_PATHS.map((path) => `fixtures/${path}`)): WorkspaceBridge {
  const files = paths.map(normalizedFixturePath)
  const roots = new Map<string, FolderRoot>()
  let sequence = 0
  const forbidden = () => ({ code: 'E_PATH_FORBIDDEN', message: '目录未打开或超出允许范围' })
  const isDirectory = (path: string) => files.some((file) => file.startsWith(`${path}/`))
  return {
    async selectFiles() { return files.filter((path) => /\.(md|markdown|mdown|mkd)$/i.test(path)).slice(0, 2) },
    async selectFolder() { return files.length ? 'fixtures' : null },
    async openFolder(input) {
      const path = normalizedFixturePath(input)
      if (!isDirectory(path)) throw forbidden()
      const root = { rootId: `mock-folder-${++sequence}`, path, name: path.split('/').pop() ?? path }
      roots.set(root.rootId, root)
      return root
    },
    async listDirectory(rootId, input) {
      const root = roots.get(rootId)
      const path = normalizedFixturePath(input)
      if (!root || (path !== root.path && !path.startsWith(`${root.path}/`)) || !isDirectory(path)) throw forbidden()
      const entries = new Map<string, FolderEntry>()
      for (const file of files) {
        if (!file.startsWith(`${path}/`)) continue
        const relative = file.slice(path.length + 1)
        const name = relative.split('/')[0] ?? ''
        const kind = relative.includes('/') ? 'directory' : /\.(md|markdown|mdown|mkd)$/i.test(name) ? 'markdown' : 'file'
        entries.set(name, { name, path: `${path}/${name}`, kind })
      }
      const sorted = [...entries.values()].sort((a, b) =>
        Number(a.kind !== 'directory') - Number(b.kind !== 'directory') ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name))
      return { entries: sorted.slice(0, 2000), truncated: sorted.length > 2000 }
    },
    async closeFolder(rootId) { roots.delete(rootId) },
  }
}
export const mockWorkspaceBridge = createMockWorkspaceBridge()
export const workspaceBridge = import.meta.env.VITE_IPC_MOCK === '1' ? mockWorkspaceBridge : tauriWorkspaceBridge
