// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { expect, test, vi } from 'vitest'
import ReaderApp from '../../../experiments/code-oss-reader/webview/App.vue'
import { SegmentView } from '@/reader/segments'

test('persisted position survives an empty first host render before the ready-state replay', async () => {
  const saved = { scrollTop: 1400, query: 'paragraph', anchor: { text: 'saved paragraph', line: 10, ratio: 0 } }
  const messages: any[] = []
  vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => structuredClone(saved), setState: () => {},
    postMessage: (value: unknown) => messages.push(structuredClone(value)) }))
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(ReaderApp)
  app.mount(container)
  const result = { ok: true, jobId: 1, generation: 1, html: '<p data-src-line="10">saved paragraph</p>', toc: [], blocks: [],
    mermaidCount: 0, unknownLangs: [], hasRawHtml: false, htmlBytes: 50, parseMs: 0 }
  try {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'render', result, state: {} } }))
    await vi.waitFor(() => expect(messages.some(item => item.type === 'rendered')).toBe(true))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'render', result, state: saved } }))
    await nextTick()
    container.querySelector('.reader-scroll')!.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(messages.filter(item => item.type === 'state').at(-1)?.state).toMatchObject(saved))
    expect((container.querySelector('.reader-scroll') as HTMLElement).scrollTop).toBe(1400)
  } finally { app.unmount(); container.remove(); vi.unstubAllGlobals() }
})

test('nonempty host state takes precedence and later empty renders do not replay the bootstrap position', async () => {
  const saved = { scrollTop: 1400, query: 'saved query', anchor: { text: 'saved paragraph', line: 10, ratio: 0 } }
  const messages: any[] = []
  vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => saved, setState: () => {},
    postMessage: (value: unknown) => messages.push(structuredClone(value)) }))
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(ReaderApp)
  app.mount(container)
  const render = (generation: number, state: object) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'render', state,
    result: { ok: true, jobId: generation, generation, html: '<p data-src-line="10">saved paragraph</p>', toc: [], blocks: [],
      mermaidCount: 0, unknownLangs: [], hasRawHtml: false, htmlBytes: 50, parseMs: 0 } } }))
  try {
    render(1, { query: 'host query' })
    await vi.waitFor(() => expect(messages.some(item => item.type === 'state' && item.state.query === 'host query')).toBe(true))
    expect(messages.filter(item => item.type === 'state').at(-1)?.state).toEqual({ scrollTop: 0, query: 'host query', anchor: undefined })
    render(2, {})
    await vi.waitFor(() => expect(messages.some(item => item.type === 'rendered' && item.generation === 2)).toBe(true))
    container.querySelector('.reader-scroll')!.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(messages.filter(item => item.type === 'state').at(-1)?.state).toEqual({ scrollTop: 0, query: '', anchor: undefined }))
  } finally { app.unmount(); container.remove(); vi.unstubAllGlobals() }
})

test('reading position with a semantic anchor can cross the real structured-clone boundary', async () => {
  const messages: any[] = []
  const failures: unknown[] = []
  vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: () => {},
    postMessage(message: unknown) { try { messages.push(structuredClone(message)) } catch (error) { failures.push(error) } } }))
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(ReaderApp)
  app.mount(container)
  try {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'render', state: { scrollTop: 100, query: 'paragraph' },
      result: { ok: true, jobId: 1, generation: 1, html: '<p data-src-line="10">saved paragraph</p>', toc: [], blocks: [],
        mermaidCount: 0, unknownLangs: [], hasRawHtml: false, htmlBytes: 50, parseMs: 0 } } }))
    await nextTick()
    await vi.waitFor(() => expect(messages.some(item => item.type === 'rendered')).toBe(true))
    container.querySelector('.reader-scroll')!.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(messages.some(item => item.type === 'state') || failures.length > 0).toBe(true))
    expect(failures).toEqual([])
    expect(messages.find(item => item.type === 'state')?.state.anchor).toMatchObject({ line: 10, text: 'saved paragraph' })
  } finally { app.unmount(); container.remove(); vi.unstubAllGlobals() }
})

test('a search selection is retried when an external save cancels the previous render', async () => {
  const messages: any[] = []
  vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: () => {}, postMessage: (value: unknown) => messages.push(structuredClone(value)) }))
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(ReaderApp)
  const render = (generation: number) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'render', state: {},
    result: { ok: true, jobId: generation, generation, html: '', toc: [], blocks: [], mermaidCount: 0, unknownLangs: [], hasRawHtml: false, htmlBytes: 300, parseMs: 0,
      segments: Array.from({ length: 12 }, (_, i) => ({ html: `<p data-src-line="${i * 10 + 1}">Generation ${generation} paragraph ${i}</p>`, anchors: [], line: i * 10 + 1, endLine: i * 10 + 10 })) } } }))
  app.mount(container)
  let release = () => {}
  let blocked = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const original = SegmentView.prototype.show
  const show = vi.spyOn(SegmentView.prototype, 'show').mockImplementation(async function (this: SegmentView, ...args) {
    if (args[0] === 9 && !blocked) { blocked = true; await gate }
    return original.apply(this, args)
  })
  try {
    render(1)
    await vi.waitFor(() => expect(messages.some(item => item.type === 'rendered' && item.generation === 1)).toBe(true))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'sourceSelection', line: 95, preserveFocus: true } }))
    await vi.waitFor(() => expect(blocked).toBe(true))
    render(2)
    await nextTick()
    release()
    await vi.waitFor(() => expect(messages.some(item => item.type === 'rendered' && item.generation === 2)).toBe(true))
    expect(container.querySelector('.md-anchor-flash')?.textContent).toBe('Generation 2 paragraph 9')
  } finally { release(); show.mockRestore(); app.unmount(); container.remove(); vi.unstubAllGlobals() }
})
