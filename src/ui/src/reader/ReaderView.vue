<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ReadingAnchor } from '../core/documents/workspaceState'
import type { IpcBridge } from '../core/ipc/bridge'
import type { ParseResult } from '../core/render/contract'
import type { MarkdownTheme } from '../core/theme/apply'
import { bindReaderLinks } from './links'
import { MermaidLayer } from './MermaidLayer'
import { type RenderCompletion, RenderProgress } from './renderCompletion'
import { renderInto } from './renderInto'
import { captureAnchor, restoreAnchor } from './scrollAnchor'
import { DocumentSearch, type SearchSummary } from './search'
import { SegmentedSearch } from './segmentSearch'
import { findNamedAnchor, SegmentView, yieldToReader } from './segments'

const props = defineProps<{ result: ParseResult | null; docId: string | null; bridge: IpcBridge;
  markdownTheme: MarkdownTheme; assetUrl: (path: string) => string; initialScrollTop?: number;
  sessionId?: string; searchQuery?: string; searchCurrent?: number; fontSize?: number; initialAnchor?: ReadingAnchor | null | undefined }>()
const emit = defineEmits<{ ready: []; active: [id: string]; error: [message: string]; position: [top: number, sessionId: string];
  matches: [summary: SearchSummary, sessionId: string, query: string]; link: [path: string, anchor: string | undefined, activate: boolean];
  anchor: [anchor: ReadingAnchor | undefined, sessionId: string]; hover: [target: string] }>()
const article = ref<HTMLElement | null>(null)
const scroll = ref<HTMLElement | null>(null)
let layer: MermaidLayer | undefined
let generation = 0
let frame = 0
let headings: HTMLElement[] = []
let search: DocumentSearch | undefined
let renderTask: Promise<void> = Promise.resolve()
let rendering = false
let renderedSessionId = ''
let unbindLinks: (() => void) | undefined
let segments: SegmentView | undefined
let segmentSearch: SegmentedSearch | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined
let navigating = 0
let navigationPending = false
let traversal = 0
let traversing = false
const segmentNotice = computed(() => !props.result?.segments ? '' : props.result.segments.some((part) => part.oversized)
  ? '长文档分段显示；包含无法拆分的大型结构，该段加载可能较慢。搜索覆盖全文。'
  : '长文档分段显示，搜索覆盖全文。')

function reportMatches(summary: SearchSummary): void {
  emit('matches', summary, renderedSessionId, props.searchQuery ?? '')
}

function observe(task: Promise<unknown>): void {
  const version = generation
  void task.catch((error: unknown) => {
    if (version === generation) emit('error', String(error))
  })
}

async function refreshViewport(version: number): Promise<boolean> {
  if (traversing) return false
  try { if (!navigationPending) await segments?.updateViewport() }
  catch (error) { if (version === generation) emit('error', String(error)); return false }
  return version === generation && !rendering && !traversing
}

function updateActive(): void {
  if (frame || rendering || traversing) return
  frame = requestAnimationFrame(async () => {
    frame = 0
    if (!article.value || !scroll.value) return
    const version = generation
    if (!await refreshViewport(version) || !article.value || !scroll.value) return
    emit('position', scroll.value.scrollTop, renderedSessionId)
    emit('anchor', captureAnchor(article.value, scroll.value), renderedSessionId)
    const top = scroll.value.getBoundingClientRect().top + 60
    let low = 0
    let high = headings.length - 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const heading = headings[middle]
      if (heading && heading.getBoundingClientRect().top <= top) low = middle + 1
      else high = middle - 1
    }
    const active = headings[Math.max(0, high)]
    if (active) emit('active', active.id)
  })
}

async function resolveImages(target: HTMLElement, current: number): Promise<void> {
  const images = [...target.querySelectorAll<HTMLImageElement>('img[data-md-image]')]
  const raws = [...new Set(images.map((image) => image.dataset.mdSrc ?? ''))]
  for (let offset = 0; offset < raws.length; offset += 500) {
    const group = raws.slice(offset, offset + 500)
    const assets = props.docId ? await props.bridge.resolveAssets(props.docId, group) : []
    if (generation !== current) return
    for (const image of images) {
      const raw = image.dataset.mdSrc ?? ''
      if (!group.includes(raw)) continue
      const asset = assets.find((item) => item.raw === raw)
      // 无文档目录的临时文本也不能自动加载相对路径或远程资源。
      if (asset?.verdict === 'ok' && asset.absPath) image.src = props.assetUrl(asset.absPath)
      else { image.removeAttribute('src'); image.alt = `${image.alt || '图片'}（资源不可用）` }
      image.onerror = () => { image.alt = `${image.alt || '图片'}（无法显示）` }
    }
  }
}

function mountSegments(result: ParseResult, current: number): SegmentView | undefined {
  if (!article.value || !scroll.value || !result.segments?.length) return undefined
  article.value.dataset.segmentCount = String(result.segments.length)
  return new SegmentView(article.value, scroll.value, result.segments, result.hasRawHtml, {
    changing: () => segmentSearch?.clearHighlight(),
    mount: (root) => {
      void resolveImages(root, current).catch((error: unknown) => emit('error', String(error)))
    },
    changed: () => {
      headings = [...(article.value?.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]') ?? [])]
      segmentSearch?.refresh()
      layer?.refresh()
    },
  })
}

const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function restorePosition(anchor: ReadingAnchor | null | undefined, current: number): Promise<void> {
  if (!article.value || !scroll.value || current !== generation) return
  if (anchor && (props.initialScrollTop ?? 0) > 0) {
    if (segments) await segments.restore(anchor, () => current === generation)
    else restoreAnchor(article.value, scroll.value, anchor)
  } else await segments?.updateViewport()
}

async function renderDocument(result: ParseResult | null): Promise<void> {
  // Capture before replacing DOM: external edits can arrive between scroll events.
  const previousAnchor = props.sessionId === renderedSessionId && article.value && scroll.value
    ? captureAnchor(article.value, scroll.value) : undefined
  const current = ++generation
  cancelTraversal()
  navigating += 1
  navigationPending = false
  rendering = true
  cancelAnimationFrame(frame)
  frame = 0
  search?.clear()
  search = undefined
  segmentSearch?.clear(); segmentSearch = undefined
  segments?.dispose(); segments = undefined
  emit('hover', '')
  layer?.dispose()
  layer = undefined
  await nextTick()
  if (!article.value || current !== generation) return
  renderedSessionId = props.sessionId ?? ''
  if (!result) { article.value.replaceChildren(); headings = []; rendering = false; reportMatches({ count: 0, current: 0 }); return }
  delete article.value.dataset.allSegmentsVisited
  segments = mountSegments(result, current)
  if (segments) {
    await segments.show(0)
    if (current !== generation) return
    segmentSearch = new SegmentedSearch(segments)
    layer = new MermaidLayer(article.value, props.markdownTheme)
  } else {
    delete article.value.dataset.segmentCount
    renderInto(article.value, result)
    search = new DocumentSearch(article.value)
    layer = new MermaidLayer(article.value, props.markdownTheme)
    void resolveImages(article.value, current).catch((error: unknown) => emit('error', String(error)))
  }
  headings = [...article.value.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')]
  if (scroll.value) scroll.value.scrollTop = props.initialScrollTop ?? 0
  const anchor = previousAnchor ?? props.initialAnchor
  await restorePosition(anchor, current)
  await painted()
  if (current !== generation) return
  // content-visibility resolves offscreen intrinsic heights after the first
  // scroll. Refit the semantic block against that completed layout.
  if (anchor) { await restorePosition(anchor, current); await painted() }
  if (current === generation) {
    rendering = false
    observe(updateSearch(props.searchQuery ?? '', props.searchCurrent ?? 1, false))
    updateActive(); emit('ready')
  }
}
async function updateSearch(query: string, current = 1, reveal = true): Promise<void> {
  cancelTraversal()
  const version = generation
  if (segmentSearch && query) reportMatches({ count: 0, current: 0, pending: true })
  const summary = segmentSearch ? await segmentSearch.update(query, current, reveal) : search?.update(query, current, reveal)
  if (summary && version === generation && query === (props.searchQuery ?? '')) reportMatches(summary)
}
watch(() => props.result, (result) => {
  const task = renderDocument(result)
  const current = generation
  renderTask = task.catch((error: unknown) => { if (current === generation) { rendering = false; emit('error', String(error)) } })
}, { immediate: true })
watch(() => props.searchQuery, (query, previous) => {
  if (rendering || (!search && !segmentSearch)) return
  const restoring = !previous && (props.searchCurrent ?? 0) > 0
  observe(updateSearch(query ?? '', restoring ? props.searchCurrent : 1, !restoring))
})

watch(() => props.markdownTheme, () => {
  layer?.dispose()
  if (!article.value || !props.result) return
  for (const node of article.value.querySelectorAll<HTMLElement>('.md-mermaid')) {
    node.replaceChildren()
    delete node.dataset.state
  }
  layer = new MermaidLayer(article.value, props.markdownTheme)
})

async function navigate(id: string): Promise<void> {
  cancelTraversal()
  const request = ++navigating
  const current = generation
  const view = segments
  const root = article.value
  const viewport = scroll.value
  const fresh = () => request === navigating && current === generation
  navigationPending = true
  try {
    if (!id) {
      await view?.show(0, false, fresh)
      if (fresh() && viewport) viewport.scrollTop = 0
      return
    }
    const target = view ? await view.anchor(id, fresh) : root ? findNamedAnchor(root, id) : null
    if (!fresh()) return
    if (!target) { emit('error', `未找到章节：${id}`); return }
    target.setAttribute('tabindex', '-1')
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
    root?.querySelector('.md-anchor-flash')?.classList.remove('md-anchor-flash')
    target.classList.add('md-anchor-flash')
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => target.classList.remove('md-anchor-flash'), 1200)
    emit('active', id)
  } catch (error) { if (fresh()) emit('error', String(error)) }
  finally { if (fresh()) navigationPending = false }
}

async function revealLine(line: number, preserveFocus = false): Promise<boolean> {
  if (!Number.isSafeInteger(line) || line < 1) return false
  const request = ++navigating
  const current = generation
  const fresh = () => request === navigating && current === generation
  await renderTask
  if (!fresh()) return false
  cancelTraversal()
  navigationPending = true
  try {
    if (segments) {
      const index = segments.segments.findIndex(part => part.endLine >= line)
      await segments.show(index < 0 ? segments.segments.length - 1 : index, false, fresh)
    }
    if (!fresh() || !article.value) return false
    const blocks = [...article.value.querySelectorAll<HTMLElement>('[data-src-line]')]
    const target = blocks.reduce<HTMLElement | undefined>((best, node) => {
      const start = Number(node.dataset.srcLine)
      return start <= line && (!best || start >= Number(best.dataset.srcLine)) ? node : best
    }, undefined) ?? blocks[0]
    if (!target) return false
    target.scrollIntoView({ block: 'start' })
    if (!preserveFocus) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }) }
    article.value.querySelector('.md-anchor-flash')?.classList.remove('md-anchor-flash')
    target.classList.add('md-anchor-flash')
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => target.classList.remove('md-anchor-flash'), 1200)
    await painted()
    return fresh()
  } finally { if (fresh()) { navigationPending = false; updateActive() } }
}

onMounted(() => {
  if (article.value) unbindLinks = bindReaderLinks(article.value, props.bridge,
    () => rendering ? null : { docId: props.docId, sessionId: renderedSessionId },
    { local: (path, anchor, activate) => emit('link', path, anchor, activate), anchor: (id) => { observe(navigate(id)) },
      error: (message) => emit('error', message), hover: (target) => emit('hover', target) })
})
onBeforeUnmount(() => {
  cancelTraversal()
  generation += 1; layer?.dispose(); search?.clear(); cancelAnimationFrame(frame)
  navigating += 1; segments?.dispose(); segmentSearch?.clear(); clearTimeout(flashTimer)
  unbindLinks?.()
})
function cancelTraversal(): void { traversal += 1; traversing = false }

async function restoreAfterTraversal(view: SegmentView | undefined, original: number,
  saved: ReadingAnchor | undefined, fresh: () => boolean): Promise<boolean> {
  if (!view) return fresh()
  if (!await view.show(original, false, fresh)) return false
  if (saved) await view.restore(saved, fresh)
  return fresh()
}

async function renderAll(): Promise<RenderCompletion> {
  const request = ++traversal
  const current = generation
  const view = segments
  const graphLayer = layer
  const root = article.value
  const total = view?.segments.length ?? (props.result ? 1 : 0)
  const progress = new RenderProgress(total, props.result?.mermaidCount ?? 0)
  const fresh = () => request === traversal && current === generation && graphLayer === layer && !view?.disposed
  if (!root) return progress.result(true)
  const saved = scroll.value ? captureAnchor(root, scroll.value) : undefined
  const original = view?.current ?? 0
  cancelAnimationFrame(frame); frame = 0
  traversing = true
  delete root.dataset.allSegmentsVisited
  try {
    for (let index = 0; index < total; index += 1) {
      if (!fresh()) return progress.result(true)
      if (view && !await view.show(index, false, fresh)) return progress.result(true)
      await graphLayer?.renderAll()
      if (!fresh()) return progress.result(true)
      view?.measure(index)
      progress.collect(root)
      progress.visit(index)
      await yieldToReader()
    }
    if (!await restoreAfterTraversal(view, original, saved, fresh)) return progress.result(true)
    await graphLayer?.renderAll()
    await painted()
    if (!fresh()) return progress.result(true)
    progress.collect(root)
    root.dataset.allSegmentsVisited = 'true'
    return progress.result()
  } finally {
    if (request === traversal) { traversing = false; updateActive() }
  }
}

async function moveMatch(delta: number): Promise<void> {
  cancelTraversal()
  if (rendering) return
  const current = generation
  const summary = segmentSearch ? await segmentSearch.move(delta) : search?.move(delta)
  if (summary && current === generation) reportMatches(summary)
}

defineExpose({ navigate: (id: string) => observe(navigate(id)), revealLine, renderAll,
  focus: () => scroll.value?.focus({ preventScroll: true }),
  whenReady: () => renderTask, getScrollTop: () => scroll.value?.scrollTop ?? 0,
  getPosition: () => rendering || !props.result || !scroll.value ? null : { sessionId: renderedSessionId, scrollTop: scroll.value.scrollTop,
    anchor: article.value ? captureAnchor(article.value, scroll.value) : undefined },
  moveMatch: (delta: number) => observe(moveMatch(delta)) })
</script>

<template>
  <div ref="scroll" class="reader-scroll" tabindex="-1" @scroll.passive="updateActive">
    <div v-if="segmentNotice" class="reader-segment-notice" role="status">{{ segmentNotice }}</div>
    <article ref="article" class="md-doc" :data-md-theme="markdownTheme" :style="fontSize ? { fontSize: fontSize + 'px', lineHeight: (fontSize * 1.6) + 'px' } : undefined" aria-label="Markdown 正文" />
  </div>
</template>

<style scoped>
.reader-segment-notice { padding: 6px 24px; font-size: 12px; color: var(--app-text-muted); }
:deep(.md-anchor-flash) { animation: anchor-flash 1.2s ease-out; }
@keyframes anchor-flash { from { outline: 2px solid var(--md-link); outline-offset: 4px; } to { outline-color: transparent; } }
</style>
