// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runNativeProbe } from '@/bench/nativeProbe'
import type { M0Hooks } from '@/bench/protocol'

interface FixtureReport { name: string; imagesLoaded: number }
const native = vi.hoisted(() => ({ reports: [] as { fixtures: FixtureReport[]; complete?: boolean }[] }))

// Only the native boundary is replaced; run the probe's real DOM and report flow.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args?: { report?: typeof native.reports[number] }) => {
    if (command === 'read_document') return new ArrayBuffer(4)
    if (command === 'write_m0_report' && args?.report) { native.reports.push(structuredClone(args.report)); return }
    throw new Error(`Unexpected native command: ${command}`)
  },
}))
vi.mock('@/core/ipc', () => ({ bridge: {
  getEnvInfo: async () => ({ appVersion: 'test', tauriVersion: '2', rustVersion: 'test', os: 'windows', osVersion: 'test', webviewVersion: 'test', locale: 'zh-CN' }),
  openDocument: async (path: string) => ({ docId: path, path, dir: '/fixtures/generated', name: 'fixture.md', size: 4, mtimeMs: 0, encoding: 'utf-8', hadBom: false, version: 1, tooLarge: false }),
  closeDocument: async () => {},
} }))

const hooks: M0Hooks = {
  openText: async () => { throw new Error('Unexpected text open') },
  close: async () => {}, renderAll: async () => ({ visitedSegments: 1, totalSegments: 1,
    graphs: { done: 0, error: 0, pending: 0 }, cancelled: false }), stats: () => ({ parseCount: 1, parseMs: 1 }),
}

function basicFixture(images: HTMLImageElement[]): (path: string) => Promise<boolean> {
  return async (path) => {
    const article = document.createElement('article')
    article.className = 'md-doc'
    article.innerHTML = '<h1>Fixture</h1>'
    if (path.endsWith('/basic.md')) article.append(...images)
    document.body.replaceChildren(article)
    return true
  }
}

function pendingImage(raw: string) {
  const image = document.createElement('img')
  image.dataset.mdImage = '1'
  image.dataset.mdSrc = raw
  return image
}

function basicReport() {
  return native.reports.at(-1)?.fixtures.find((fixture) => fixture.name === 'basic.md')
}

describe('原生探针等待图片实际终态', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1 })
    native.reports.length = 0
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports cumulative diagrams from traversal rather than only the final resident DOM', async () => {
    const completedHooks: M0Hooks = { ...hooks, renderAll: async () => ({ visitedSegments: 6, totalSegments: 6,
      graphs: { done: 5, error: 1, pending: 0 }, cancelled: false }) }
    await runNativeProbe({ fixtureRoot: '/fixtures', reportPath: '/report.json' }, completedHooks, basicFixture([]))
    expect(basicReport()).toMatchObject({ mermaidDone: 5, mermaidErrors: 1, mermaidPending: 0, visitedSegments: 6, totalSegments: 6 })
  })

  it('首次打开时等待迟到的授权 src 和 load，避免把合法图片记成未加载', async () => {
    const image = pendingImage('resources/sample.png')
    let loaded = false
    Object.defineProperties(image, { complete: { get: () => loaded }, naturalWidth: { get: () => loaded ? 160 : 0 } })
    const finished = runNativeProbe({ fixtureRoot: '/fixtures', reportPath: '/report.json' }, hooks, basicFixture([image]))
    await vi.advanceTimersByTimeAsync(0)
    expect(basicReport()).toBeUndefined()
    image.src = 'http://asset.localhost/sample.png'
    await vi.advanceTimersByTimeAsync(0)
    expect(basicReport()).toBeUndefined()
    expect(image.loading).toBe('eager')
    loaded = true
    image.dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(0)
    await finished
    expect(basicReport()?.imagesLoaded).toBe(1)
    expect(native.reports.at(-1)?.complete).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('空地址和资源不可用占位不等不存在的 load 事件', async () => {
    const blocked = pendingImage('../outside.png')
    const empty = pendingImage('')
    const finished = runNativeProbe({ fixtureRoot: '/fixtures', reportPath: '/report.json' }, hooks, basicFixture([blocked, empty]))
    await vi.advanceTimersByTimeAsync(0)
    expect(basicReport()).toBeUndefined()
    blocked.alt = '越界图（资源不可用）'
    await vi.advanceTimersByTimeAsync(0)
    await finished
    expect(basicReport()?.imagesLoaded).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('资源授权一直没有终态时有界退出，不让测量永远挂起', async () => {
    const image = pendingImage('resources/sample.png')
    const finished = runNativeProbe({ fixtureRoot: '/fixtures', reportPath: '/report.json' }, hooks, basicFixture([image]))
    await vi.advanceTimersByTimeAsync(2499)
    expect(basicReport()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await finished
    expect(basicReport()?.imagesLoaded).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
