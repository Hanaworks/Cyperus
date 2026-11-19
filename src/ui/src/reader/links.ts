import type { IpcBridge } from '../core/ipc/bridge'
import { LINK_BLOCKED_REASONS } from '../core/ipc/contract'

interface Context { docId: string | null; sessionId: string }
interface Actions { local(path: string, anchor: string | undefined, activate: boolean): void; anchor(id: string): void; error(message: string): void; hover?(target: string): void }
export function bindReaderLinks(root: HTMLElement, bridge: IpcBridge, context: () => Context | null, actions: Actions): () => void {
  let disposed = false
  const click = (event: MouseEvent) => {
    if (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0) return
    const link = (event.target as Element | null)?.closest('a[href]')
    if (!link || !root.contains(link)) return
    event.preventDefault()
    event.stopPropagation()
    const from = context()
    if (!from) return
    const href = link.getAttribute('href') ?? ''
    void (async () => {
      if (!from.docId) {
        if (href.startsWith('#')) actions.anchor(decodeURIComponent(href.slice(1)))
        else actions.error('请从本地路径打开文档后使用文件链接。')
        return
      }
      const result = await bridge.resolveLink(from.docId, href)
      if (disposed) return
      const same = context()?.sessionId === from.sessionId
      switch (result.kind) {
        case 'anchor': if (same) actions.anchor(result.anchor); break
        case 'localMd': actions.local(result.absPath, result.anchor, same && !event.ctrlKey && !event.metaKey && event.button !== 1); break
        case 'asset': await bridge.openPathWithSystem(from.docId, result.absPath); break
        case 'external': await bridge.openUrl(result.url); break
        case 'blocked': actions.error(LINK_BLOCKED_REASONS[result.reason] ?? '无法打开此链接'); break
      }
    })().catch((error: unknown) => {
      if (!disposed) actions.error(error && typeof error === 'object' && 'message' in error ? String(error.message) : '无法打开此链接')
    })
  }
  root.addEventListener('click', click)
  root.addEventListener('auxclick', click)
  const target = (event: Event) => {
    const link = (event.target as Element | null)?.closest('a[href]')
    actions.hover?.(link && root.contains(link) ? link.getAttribute('href') ?? '' : '')
  }
  const leave = (event: MouseEvent | FocusEvent) => {
    const next = event.relatedTarget
    const link = next instanceof Element ? next.closest('a[href]') : null
    actions.hover?.(link && root.contains(link) ? link.getAttribute('href') ?? '' : '')
  }
  root.addEventListener('mouseover', target)
  root.addEventListener('focusin', target)
  root.addEventListener('mouseout', leave)
  root.addEventListener('focusout', leave)
  return () => {
    disposed = true
    root.removeEventListener('click', click); root.removeEventListener('auxclick', click)
    root.removeEventListener('mouseover', target); root.removeEventListener('focusin', target)
    root.removeEventListener('mouseout', leave); root.removeEventListener('focusout', leave)
    actions.hover?.('')
  }
}
