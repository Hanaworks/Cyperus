<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { IpcBridge } from '../../../ui/src/core/ipc/bridge'
import type { ParseResult } from '../../../ui/src/core/render/contract'
import type { MarkdownTheme } from '../../../ui/src/core/theme/apply'
import { normalizeReadingAnchor, type ReadingAnchor } from '../../../ui/src/core/documents/workspaceState'
import ReaderView from '../../../ui/src/reader/ReaderView.vue'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void }
const api = acquireVsCodeApi()
const chinese = document.documentElement.lang === 'zh-CN'
const restoredValue = api.getState()
const restoredState = restoredValue && typeof restoredValue === 'object' && !Array.isArray(restoredValue)
  ? restoredValue as Record<string, unknown> : undefined
const result = shallowRef<ParseResult | null>(null)
const theme = ref<MarkdownTheme>('light')
const query = ref('')
const scrollTop = ref(0)
const readingAnchor = shallowRef<ReadingAnchor>()
const error = ref('')
const reader = ref<InstanceType<typeof ReaderView> | null>(null)
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
let serial = 0
let anchor = ''
let performanceProbe = false
let renderedGeneration = -1
let sourceSelection: { line: number; preserveFocus: boolean } | undefined
const session = computed(() => `document-${result.value?.generation ?? 0}`)
function rpc(method: string, args: unknown[]): Promise<unknown> {
  const id = ++serial
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('宿主请求超时')) }, 15000)
    pending.set(id, { resolve, reject, timer }); api.postMessage({ type: 'rpc', id, method, args })
  })
}
const bridge = new Proxy({} as IpcBridge, { get: (_target, method) => (...args: unknown[]) => rpc(String(method), args) })
function savePosition(top: number) {
  scrollTop.value = top
  readingAnchor.value = reader.value?.getPosition()?.anchor
  const state = { scrollTop: top, query: query.value, anchor: readingAnchor.value }
  api.setState(state); api.postMessage({ type: 'state', state })
}
async function applySourceSelection() {
  const selection = sourceSelection
  if (!selection || !reader.value || renderedGeneration !== result.value?.generation) return
  const generation = result.value.generation
  try {
    const completed = await reader.value.revealLine(selection.line, selection.preserveFocus)
    if (completed && sourceSelection === selection && generation === result.value?.generation) {
      sourceSelection = undefined; savePosition(reader.value.getScrollTop())
    }
  } catch (reason) { error.value = String(reason) }
}
async function ready() {
  await nextTick()
  renderedGeneration = result.value?.generation ?? -1
  if (anchor) { reader.value?.navigate(anchor); anchor = '' }
  await applySourceSelection()
  api.postMessage({ type: 'rendered', generation: result.value?.generation, ...(performanceProbe ? { renderedAt: new Date().toISOString() } : {}) })
}
async function measureReader(id: number) {
  if (!performanceProbe || !reader.value) return
  try {
    const start = performance.now()
    const completion = await reader.value.renderAll()
    const fullTraversalMs = performance.now() - start
    const completedAt = new Date().toISOString()
    const frames: number[] = []
    const scroller = document.querySelector<HTMLElement>('.reader-scroll')
    for (let step = 0; step < 30; step++) {
      const before = performance.now()
      if (scroller) scroller.scrollTop = step * Math.max(1, scroller.scrollHeight - scroller.clientHeight) / 29
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      frames.push(performance.now() - before)
    }
    frames.sort((a, b) => a - b)
    api.postMessage({ type: 'benchmark', id, completion, completedAt, fullTraversalMs,
      scrollRafP95Ms: frames[Math.ceil(frames.length * 0.95) - 1],
      mountedElements: document.querySelector('article.md-doc')?.querySelectorAll('*').length ?? 0,
      viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio } })
  } catch (error) { api.postMessage({ type: 'benchmark', id, error: String(error) }) }
}
function message(event: MessageEvent) {
  const value = event.data
  if (!value || typeof value !== 'object') return
  switch (value.type) {
    case 'render': {
      performanceProbe = value.performanceProbe === true
      const hostState = value.state && typeof value.state === 'object' && !Array.isArray(value.state) ? value.state : undefined
      // Parsing can finish before the host receives our ready message. Use the
      // persisted position for that first empty render; a same-generation replay
      // changes initial props without remounting the already rendered reader.
      const state = !result.value && !Object.keys(hostState ?? {}).length ? restoredState : hostState
      error.value = ''; query.value = typeof state?.query === 'string' ? state.query.slice(0, 1024) : ''
      scrollTop.value = Number.isFinite(state?.scrollTop) ? Math.max(0, state.scrollTop) : 0
      readingAnchor.value = normalizeReadingAnchor(state?.anchor)
      theme.value = value.theme ?? 'light'; anchor = value.anchor ?? ''
      if (result.value?.generation !== value.result.generation) result.value = value.result
      else if (anchor) { reader.value?.navigate(anchor); anchor = '' }
      break
    }
    case 'error': error.value = value.error; break
    case 'sourceSelection':
      if (Number.isSafeInteger(value.line) && value.line > 0) {
        sourceSelection = { line: value.line, preserveFocus: value.preserveFocus === true }
        void applySourceSelection()
      }
      break
    case 'search': query.value = value.query; savePosition(scrollTop.value); break
    case 'moveMatch': reader.value?.moveMatch(value.delta); break
    case 'navigate': if (result.value) reader.value?.navigate(value.anchor); else anchor = value.anchor; break
    case 'theme': theme.value = value.theme; break
    case 'benchmark': if (Number.isSafeInteger(value.id)) void measureReader(value.id); break
    case 'response': {
      const request = pending.get(value.id)
      if (request) { clearTimeout(request.timer); pending.delete(value.id); value.error ? request.reject(Error(value.error)) : request.resolve(value.value) }
      break
    }
  }
}
window.addEventListener('message', message)
api.postMessage({ type: 'ready', state: restoredState })
onBeforeUnmount(() => { window.removeEventListener('message', message); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('阅读页已关闭')) }; pending.clear() })
</script>

<template>
  <div v-if="error" class="reader-error" role="alert">{{ error }}</div>
  <div v-if="!result && !error" class="reader-loading" role="status">{{ chinese ? '正在读取文档…' : 'Loading document…' }}</div>
  <ReaderView v-if="result" ref="reader" :result="result" doc-id="current" :session-id="session"
    :bridge="bridge" :markdown-theme="theme" :asset-url="(uri: string) => uri" :search-query="query" :initial-scroll-top="scrollTop" :initial-anchor="readingAnchor"
    @position="savePosition" @ready="ready" @error="(message: string) => error = message"
    @matches="(summary) => api.postMessage({ type: 'matches', total: summary.count })"
    @link="(file, target, activate) => api.postMessage({ type: 'openLocal', file, anchor: target, activate })" />
</template>
