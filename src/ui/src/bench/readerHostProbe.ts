import { invoke } from '@tauri-apps/api/core'
import type { DocumentSession } from '../core/documents/session'
import { normalizeWorkspaceState } from '../core/documents/workspaceState'
import { bridge } from '../core/ipc'
import { stateBridge } from '../core/ipc/stateBridge'

/** Only called from the explicitly enabled native report mode. State is isolated by the host. */
export async function verifyReaderHost(fixtureRoot: string, session: DocumentSession, open: (path: string) => Promise<boolean>): Promise<Record<string, unknown>> {
  const source = session.active?.meta
  if (!source) throw new Error('No native source document')
  const linked = await bridge.resolveLink(source.docId, './tabs/a.md#%E7%AB%A0%E8%8A%82%E4%B8%80')
  const blocked = await bridge.resolveLink(source.docId, '../outside.md')
  if (linked.kind !== 'localMd' || linked.anchor !== '章节一' || blocked.kind !== 'blocked') throw new Error('Native link classification failed')
  const snapshot = normalizeWorkspaceState({ schemaVersion: 1, appTheme: 'dark', markdownTheme: 'paper',
    tabs: [{ path: source.path, scrollTop: 321, search: { query: 'native', current: 2 } }], activePath: source.path })
  await stateBridge.save(snapshot)
  const loaded = normalizeWorkspaceState(await stateBridge.load())
  if (JSON.stringify(loaded) !== JSON.stringify(snapshot)) throw new Error('Native workspace roundtrip failed')

  const path = `${fixtureRoot}/generated/reader-live.md`
  try { const document = await bridge.openDocument(path); await bridge.closeDocument(document.docId) }
  catch { return { links: true, persistence: true, liveRefresh: 'not-requested' } }
  if (!await open(path)) throw new Error('Native live fixture failed to open')
  const tab = session.active
  if (!tab) throw new Error('Missing live tab')
  const versions = [tab.meta?.version ?? 0]
  const waitFor = async (predicate: () => boolean) => {
    const deadline = performance.now() + 8000
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(`Native watcher timed out: ${tab.error}`)
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
  }
  for (const [stage, marker] of [
    ['reader-live-ready', 'READER-LIVE-UPDATED'],
    ['reader-live-updated', 'READER-LIVE-REPLACED'],
  ]) {
    await invoke('write_m0_report', { report: { stage } })
    await waitFor(() => tab.result?.html.includes(marker ?? '') === true)
    versions.push(tab.meta?.version ?? 0)
  }
  await invoke('write_m0_report', { report: { stage: 'reader-live-replaced' } })
  await waitFor(() => tab.error.includes('删除'))
  const retained = tab.result?.html.includes('READER-LIVE-REPLACED') === true
  await invoke('write_m0_report', { report: { stage: 'reader-live-gone' } })
  await waitFor(() => tab.result?.html.includes('READER-LIVE-RESTORED') === true && !tab.error)
  versions.push(tab.meta?.version ?? 0)
  await session.close(tab.id)
  if (!retained || !versions.every((value, index) => index === 0 || value > (versions[index - 1] ?? 0))) throw new Error('Native deletion/recovery invariants failed')
  return { links: true, persistence: true, liveRefresh: true, deletionRetained: retained, versions }
}
