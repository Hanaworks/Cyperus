// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, shallowRef } from 'vue'
import { mockBridge } from '@/core/ipc/mockBridge'
import type { ParseResult } from '@/core/render/contract'
import ReaderView from '@/reader/ReaderView.vue'
import { SegmentView } from '@/reader/segments'

it('source-line navigation mounts a distant segment and preserves search focus', async () => {
  const result: ParseResult = { ok: true, jobId: 1, generation: 1, html: '', toc: [], blocks: [],
    mermaidCount: 0, unknownLangs: [], hasRawHtml: false, htmlBytes: 200, parseMs: 0,
    segments: Array.from({ length: 12 }, (_, i) => ({
      html: `<p data-src-line="${i * 10 + 1}">Paragraph ${i}</p>`, anchors: [], line: i * 10 + 1, endLine: i * 10 + 10,
    })) }
  const reader = ref<InstanceType<typeof ReaderView> | null>(null)
  const container = document.createElement('div')
  const searchInput = document.createElement('input')
  document.body.append(searchInput, container)
  const app = createApp(() => h(ReaderView, { ref: reader, result, docId: null,
    bridge: mockBridge, markdownTheme: 'light', assetUrl: () => '', sessionId: 'source-navigation' }))
  app.mount(container)
  await nextTick()
  await reader.value?.whenReady()
  try {
    expect(container.textContent).not.toContain('Paragraph 9')
    searchInput.focus()
    await reader.value!.revealLine(95, true)
    expect(container.querySelector('.md-anchor-flash')?.textContent).toBe('Paragraph 9')
    expect(document.activeElement).toBe(searchInput)
    await reader.value!.revealLine(15, false)
    expect(document.activeElement?.textContent).toBe('Paragraph 1')
  } finally { app.unmount(); container.remove(); searchInput.remove() }
})

it('a delayed top-anchor navigation never resets the newly opened document', async () => {
  const result = shallowRef<ParseResult>({ ok: true, jobId: 1, generation: 1, html: '', toc: [], blocks: [],
    mermaidCount: 0, unknownLangs: [], hasRawHtml: false, htmlBytes: 10, parseMs: 0,
    segments: [{ html: '<p data-src-line="1">old</p>', anchors: [], line: 1, endLine: 1 }] })
  const reader = ref<InstanceType<typeof ReaderView> | null>(null)
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(() => h(ReaderView, { ref: reader, result: result.value, docId: null,
    bridge: mockBridge, markdownTheme: 'light', assetUrl: () => '', sessionId: String(result.value.jobId) }))
  app.mount(container)
  await nextTick()
  await reader.value?.whenReady()
  let complete: () => void = () => {}
  const wait = new Promise<void>((resolve) => { complete = resolve })
  const show = vi.spyOn(SegmentView.prototype, 'show').mockImplementationOnce(async () => { await wait; return true })
  try {
    reader.value?.navigate('')
    result.value = { ...result.value, jobId: 2, html: '<p data-src-line="1">new document</p>', segments: [] }
    await nextTick()
    await reader.value?.whenReady()
    const scroll = container.querySelector<HTMLElement>('.reader-scroll')
    if (!scroll) throw new Error('Missing reader viewport')
    scroll.scrollTop = 321
    complete()
    await wait
    await Promise.resolve()
    expect(scroll.scrollTop).toBe(321)
    expect(container.querySelector('article')?.textContent).toBe('new document')
  } finally { show.mockRestore(); app.unmount(); container.remove() }
})
