// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, shallowRef } from 'vue'
import { mockBridge } from '@/core/ipc/mockBridge'
import type { ParseResult } from '@/core/render/contract'
import ReaderView from '@/reader/ReaderView.vue'

const { renderSvg } = vi.hoisted(() => ({ renderSvg: vi.fn(async () => ({ svg: '<svg><text>graph</text></svg>' })) }))
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: renderSvg } }))
// SVG sanitization runs in Chromium tests; happy-dom does not implement that parser correctly.
vi.mock('@/reader/svg', () => ({ sanitizeSvg: (svg: string) => svg }))
beforeEach(() => vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }))
afterEach(() => { vi.unstubAllGlobals(); renderSvg.mockReset(); renderSvg.mockResolvedValue({ svg: '<svg><text>graph</text></svg>' }) })

async function mountedReader() {
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = Number(this.closest<HTMLElement>('[data-segment]')?.dataset.segment ?? 0) * 100
    return { top, bottom: top + 100, height: 100 } as DOMRect
  })
  const result = shallowRef<ParseResult>({ ok: true, jobId: 1, generation: 1, html: '', toc: [], blocks: [],
    mermaidCount: 6, unknownLangs: [], hasRawHtml: false, htmlBytes: 100, parseMs: 0,
    segments: Array.from({ length: 6 }, (_, index) => ({ html: `<div class="md-mermaid" data-mermaid-id="md-mermaid-${index + 1}" data-code="${btoa(`graph ${index + 1}`)}"></div>`, anchors: [], line: index + 1, endLine: index + 1 })) })
  const reader = ref<InstanceType<typeof ReaderView> | null>(null)
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(() => h(ReaderView, { ref: reader, result: result.value, docId: null,
    bridge: mockBridge, markdownTheme: 'light', assetUrl: () => '', sessionId: String(result.value.jobId) }))
  app.mount(container)
  await nextTick()
  await reader.value?.whenReady()
  return { reader, result, container, close: () => { app.unmount(); container.remove(); geometry.mockRestore() } }
}

it('reports cumulative graph completion across segments after distant DOM has been released', async () => {
  const mounted = await mountedReader()
  try {
    const completed = await mounted.reader.value?.renderAll()
    expect(mounted.container.querySelectorAll('.md-mermaid').length).toBeLessThan(6)
    expect(completed).toEqual({ visitedSegments: 6, totalSegments: 6, graphs: { done: 6, error: 0, pending: 0 }, cancelled: false })
  } finally { mounted.close() }
})

it('waits for diagrams remounted while restoring the original reading segment', async () => {
  const mounted = await mountedReader()
  try {
    await mounted.reader.value?.renderAll()
    const states = [...mounted.container.querySelectorAll<HTMLElement>('.md-mermaid')].map((node) => node.dataset.state)
    expect(states.length).toBeGreaterThan(0)
    expect(states.every((state) => state === 'done')).toBe(true)
  } finally { mounted.close() }
})

it('returns an explicit cancelled completion after the document changes during traversal', async () => {
  const mounted = await mountedReader()
  let release: (value: { svg: string }) => void = () => {}
  renderSvg.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  try {
    const completing = mounted.reader.value?.renderAll()
    await vi.waitFor(() => expect(renderSvg).toHaveBeenCalled())
    mounted.result.value = { ...mounted.result.value, jobId: 2, html: '<p>new document</p>', segments: [], mermaidCount: 0 }
    await nextTick()
    await mounted.reader.value?.whenReady()
    release({ svg: '<svg/>' })
    expect(await completing).toMatchObject({ cancelled: true, totalSegments: 6 })
    expect(mounted.container.querySelector('article')?.textContent).toBe('new document')
    expect(mounted.container.querySelector('article')?.dataset.allSegmentsVisited).toBeUndefined()
  } finally { release({ svg: '<svg/>' }); mounted.close() }
})
