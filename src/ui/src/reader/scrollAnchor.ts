import type { ReadingAnchor } from '../core/documents/workspaceState'

function blocks(article: HTMLElement): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>('[data-src-line]')]
}
const text = (node: HTMLElement) => (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 256)
function span(nodes: HTMLElement[], index: number): number {
  const node = nodes[index]
  if (!node) return 1
  const box = node.getBoundingClientRect()
  const next = nodes[index + 1]?.getBoundingClientRect().top
  return Math.max(1, next !== undefined ? next - box.top : box.height)
}

export function captureAnchor(article: HTMLElement, viewport: HTMLElement): ReadingAnchor | undefined {
  if (viewport.scrollTop <= 0) return undefined
  const nodes = blocks(article)
  const top = viewport.getBoundingClientRect().top
  let index = nodes.findIndex((node) => node.getBoundingClientRect().top > top) - 1
  if (index === -2) index = nodes.length - 1
  index = Math.max(0, index)
  const node = nodes[index]
  if (!node) return undefined
  const shell = node.closest<HTMLElement>('[data-segment]')
  if (shell) {
    const box = shell.getBoundingClientRect()
    if (top < box.top || top >= box.bottom) return undefined
  }
  return { ...(node.id ? { id: node.id } : {}), text: text(node), line: Number(node.dataset.srcLine) || 1,
    ratio: Math.min(1, Math.max(0, (top - node.getBoundingClientRect().top) / span(nodes, index))) }
}

export function findAnchorBlock(article: HTMLElement, anchor: ReadingAnchor, lineFallback = true): HTMLElement | undefined {
  const nodes = blocks(article)
  const sameText = nodes.filter((node) => text(node) === anchor.text)
  const sameId = anchor.id ? nodes.find((node) => node.id === anchor.id) : undefined
  if (sameId && (!sameText.length || sameText.includes(sameId))) return sameId
  const candidates = sameText.length ? sameText : lineFallback ? nodes : []
  return candidates.reduce<HTMLElement | undefined>((best, node) =>
    !best || Math.abs(Number(node.dataset.srcLine) - anchor.line) < Math.abs(Number(best.dataset.srcLine) - anchor.line) ? node : best, undefined)
}

export function restoreAnchor(article: HTMLElement, viewport: HTMLElement, anchor: ReadingAnchor): boolean {
  const node = findAnchorBlock(article, anchor)
  if (!node) return false
  const nodes = blocks(article)
  viewport.scrollTop += node.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    + Math.max(0, Math.min(1, anchor.ratio)) * span(nodes, nodes.indexOf(node))
  return true
}
