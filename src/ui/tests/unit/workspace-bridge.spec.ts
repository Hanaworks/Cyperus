import { describe, expect, it } from 'vitest'
import { createMockWorkspaceBridge } from '../../src/core/ipc/workspaceBridge'

describe('workspace fixtures', () => {
  it('enumerates only direct children, folders first and preserves unsupported files', async () => {
    const bridge = createMockWorkspaceBridge(['fixtures/z/a.md', 'fixtures/A.markdown', 'fixtures/b.png'])
    const root = await bridge.openFolder('fixtures')
    expect(root.name).toBe('fixtures')
    expect(await bridge.listDirectory(root.rootId, root.path)).toEqual({ truncated: false, entries: [
      { name: 'z', path: 'fixtures/z', kind: 'directory' },
      { name: 'A.markdown', path: 'fixtures/A.markdown', kind: 'markdown' },
      { name: 'b.png', path: 'fixtures/b.png', kind: 'file' },
    ] })
    expect((await bridge.listDirectory(root.rootId, 'fixtures/z')).entries).toEqual([
      { name: 'a.md', path: 'fixtures/z/a.md', kind: 'markdown' },
    ])
  })
  it('rejects escape paths and closed folder handles', async () => {
    const bridge = createMockWorkspaceBridge(['fixtures/a.md'])
    const root = await bridge.openFolder('fixtures')
    for (const path of ['fixtures/../other', 'fixtures-sibling', '/etc', 'fixtures/a.md']) {
      await expect(bridge.listDirectory(root.rootId, path)).rejects.toHaveProperty('code', 'E_PATH_FORBIDDEN')
    }
    await bridge.closeFolder(root.rootId)
    await expect(bridge.listDirectory(root.rootId, root.path)).rejects.toHaveProperty('code', 'E_PATH_FORBIDDEN')
  })
  it('bounds large fixture directories and provides both native-picker stand-ins', async () => {
    const bridge = createMockWorkspaceBridge(Array.from({ length: 2001 }, (_, i) => `fixtures/${i}.md`))
    const root = await bridge.openFolder('fixtures')
    const listing = await bridge.listDirectory(root.rootId, root.path)
    expect(listing.entries).toHaveLength(2000)
    expect(listing.truncated).toBe(true)
    expect(await bridge.selectFolder()).toBe('fixtures')
    expect((await bridge.selectFiles()).length).toBeGreaterThan(1)
  })
})
