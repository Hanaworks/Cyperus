// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import * as storage from '@/core/render/segmentStore'
import { captureAnchor } from '@/reader/scrollAnchor'
import { SegmentedSearch } from '@/reader/segmentSearch'
import { SegmentView } from '@/reader/segments'

function setup() {
  const viewport = document.createElement('div')
  const article = document.createElement('article')
  viewport.append(article)
  const segments = Array.from({ length: 12 }, (_, index) => ({ html: `<h2 id="s${index}" data-src-line="${index * 10 + 1}">Section ${index}</h2><p>nee<strong>dle</strong></p><img alt="needle"><script>needle</script>`, line: index * 10 + 1, endLine: index * 10 + 10, anchors: [`s${index}`] }))
  // Real DOMPurify behavior is covered in Chromium; happy-dom has known parser gaps.
  const view = new SegmentView(article, viewport, segments, false)
  return { view, article, viewport }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

it('mounts neighbors, reaches distant named anchors, and releases remote DOM', async () => {
  const { view, article } = setup()
  await view.show(0)
  expect(article.querySelectorAll('h2'), article.outerHTML).toHaveLength(2)
  expect(article.querySelector('#s10')).toBeNull()
  const target = await view.anchor('s10')
  expect(target?.id).toBe('s10')
  expect(article.querySelector('#s0')).toBeNull()
  expect(article.querySelectorAll('h2')).toHaveLength(3)
  expect(article.querySelector('[data-segment="0"]')?.getAttribute('data-placeholder')).toBe('true')
})

it('counts actual rendered text across all segments and reveals distant matches', async () => {
  const { view, article } = setup()
  await view.show(0)
  const search = new SegmentedSearch(view)
  expect(await search.update('needle', 1, false)).toEqual({ count: 12, current: 1 })
  expect(await search.move(-1)).toEqual({ count: 12, current: 12 })
  expect(article.querySelector('#s11')).not.toBeNull()
  search.clear()
})

it('discards a storage read failure after its document was closed', async () => {
  const { view, article } = setup()
  let rejectRead: (error: Error) => void = () => {}
  const read = vi.spyOn(storage, 'readSegmentHtml').mockImplementationOnce(() => new Promise((_, reject) => { rejectRead = reject }))
  const showing = view.show(0)
  view.dispose()
  rejectRead(new Error('document storage released'))
  try {
    await expect(showing).resolves.toBe(false)
    expect(article.querySelectorAll('h2')).toHaveLength(0)
  } finally { read.mockRestore() }
})

it('a slow previous search cannot replace the latest matches or mount its old target segment', async () => {
  const { view, article } = setup()
  view.segments.forEach((segment, index) => { segment.html = `<p>${index === 10 ? 'alpha' : index === 0 ? 'beta' : 'body'}</p>` })
  await view.show(0)
  const search = new SegmentedSearch(view)
  const reading = deferred<void>()
  const complete = deferred<string>()
  let reads = 0
  const read = vi.spyOn(storage, 'readSegmentHtml').mockImplementation((segment) => {
    if (segment === view.segments[9] && ++reads === 2) { reading.resolve(); return complete.promise }
    return Promise.resolve(segment.html)
  })
  try {
    const previous = search.update('alpha')
    await reading.promise
    expect(await search.update('beta')).toEqual({ count: 1, current: 1 })
    expect(article.querySelector('.md-search-current')?.textContent).toBe('beta')
    complete.resolve(view.segments[9]?.html ?? '')
    await previous
    expect(view.current).toBe(0)
    expect(article.querySelector('.md-search-current')?.textContent).toBe('beta')
  } finally { read.mockRestore(); search.clear(); view.dispose() }
})

it('a delayed legacy-anchor scan cannot evict a newer navigation target', async () => {
  const { view, article } = setup()
  const first = view.segments[0]
  if (!first) throw new Error('Missing first segment')
  first.html += "<a name='legacy'></a>"
  await view.show(10)
  const complete = deferred<string>()
  const read = vi.spyOn(storage, 'readSegmentHtml').mockImplementationOnce(() => complete.promise)
  try {
    const previous = view.anchor('legacy')
    expect((await view.anchor('s5'))?.id).toBe('s5')
    complete.resolve(first.html)
    await previous
    expect(view.current).toBe(5)
    expect(article.querySelector('#s5')).not.toBeNull()
    expect(article.querySelector("a[name='legacy']")).toBeNull()
  } finally { read.mockRestore(); view.dispose() }
})

it('scrolling into an unmounted nearby segment preserves that shell position', async () => {
  const { view, article, viewport } = setup()
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = Number(this.closest<HTMLElement>('[data-segment]')?.dataset.segment ?? 0)
    const top = this === viewport ? 0 : index * 100 - viewport.scrollTop
    return { top, bottom: top + 100, height: 100 } as DOMRect
  })
  try {
    await view.show(0)
    viewport.scrollTop = 350
    expect(captureAnchor(article, viewport)).toBeUndefined()
    await view.updateViewport()
    expect(view.current).toBe(3)
    expect(viewport.scrollTop).toBe(350)
  } finally { geometry.mockRestore(); view.dispose() }
})
