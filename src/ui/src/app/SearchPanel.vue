<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ query: string; count: number; current: number; hasDocument: boolean; pending?: boolean }>()
const emit = defineEmits<{ 'update:query': [value: string]; next: []; previous: []; returnToReader: [] }>()
const input = ref<HTMLInputElement | null>(null)
const canNavigate = computed(() => props.hasDocument && !props.pending && props.query.length > 0 && props.count > 0)
const matchLabel = computed(() => {
  if (!props.hasDocument || !props.query) return ''
  if (props.pending) return '正在搜索全文…'
  if (!props.count) return '0 个匹配'
  return `${Math.min(Math.max(props.current, 1), props.count)} / ${props.count}`
})

function updateQuery(event: Event): void {
  emit('update:query', (event.target as HTMLInputElement).value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('returnToReader')
    return
  }
  if (event.key !== 'Enter' || !canNavigate.value) return
  event.preventDefault()
  if (event.shiftKey) emit('previous')
  else emit('next')
}

function focus(): void {
  input.value?.focus()
  input.value?.select()
}

defineExpose({ focus })
</script>

<template>
  <section class="search-panel" aria-label="文档搜索">
    <h2>搜索</h2>
    <div class="search-field" :class="{ disabled: !hasDocument }">
      <svg class="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        stroke-width="1.2" stroke-linecap="round" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="4.5" /><path d="m10 10 4 4" />
      </svg>
      <input ref="input" type="text" :value="query" :disabled="!hasDocument"
        aria-label="搜索当前文档" placeholder="搜索当前文档" spellcheck="false"
        autocomplete="off" @input="updateQuery" @keydown="onKeydown">
      <button v-if="query" type="button" class="icon-button clear-search" aria-label="清除搜索"
        title="清除搜索" :disabled="!hasDocument" @click="emit('update:query', ''); input?.focus()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
      </button>
    </div>
    <div class="search-controls">
      <span class="match-count" data-testid="search-summary" role="status" aria-live="polite">{{ matchLabel }}</span>
      <button type="button" class="icon-button" aria-label="上一个匹配" title="上一个匹配（Shift+Enter）"
        :disabled="!canNavigate" @click="emit('previous')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 7 4-4 4 4M8 3v10" /></svg>
      </button>
      <button type="button" class="icon-button" aria-label="下一个匹配" title="下一个匹配（Enter）"
        :disabled="!canNavigate" @click="emit('next')">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 9 4 4 4-4M8 3v10" /></svg>
      </button>
    </div>
    <p v-if="!hasDocument" class="search-hint">打开文档后，可搜索正文内容。</p>
    <p v-else-if="!query" class="search-hint">搜索当前文档正文。按 Enter 跳转到下一个匹配。</p>
    <p v-else-if="!count && !pending" class="search-hint">没有找到匹配内容。请尝试其他关键词。</p>
  </section>
</template>

<style scoped>
.search-panel { padding: 0 12px 16px 20px; font-size: 13px; }
.search-panel h2 { height: var(--app-tabs-h); margin: 0; padding: 0; display: flex; align-items: center; font-size: 12px; font-weight: 400; color: var(--app-fg); }
.search-field { display: flex; align-items: center; gap: 4px; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid var(--app-input-border); border-radius: 3px; background: var(--app-input-bg); }
.search-field:focus-within { border-color: var(--app-accent); }
.search-field.disabled { opacity: .6; }
.search-icon { flex: 0 0 16px; width: 16px; height: 16px; color: var(--app-fg-muted); }
.search-field input { flex: 1; width: 100%; min-width: 0; padding: 0; border: 0; outline: none; color: var(--app-fg); background: transparent; font: inherit; user-select: text; }
.search-field input::placeholder { color: var(--app-fg-muted); }
.search-controls { display: flex; align-items: center; gap: 2px; min-height: 28px; }
.match-count { flex: 1; min-width: 0; color: var(--app-fg-muted); font-size: 12px; }
.icon-button { display: grid; flex: 0 0 auto; place-items: center; width: 22px; height: 22px; padding: 3px; border: 0; border-radius: 3px; color: var(--app-fg-muted); background: transparent; cursor: pointer; }
.icon-button svg { width: 16px; height: 16px; }
.clear-search { width: 20px; height: 20px; padding: 2px; }
.icon-button:hover:enabled { color: var(--app-fg); background: var(--app-hover, var(--app-bg-elevated)); }
.icon-button:focus-visible { outline: 1px solid var(--app-accent); outline-offset: -1px; }
.icon-button:disabled { opacity: .4; cursor: default; }
.search-hint { margin: 6px 0 0; color: var(--app-fg-muted); font-size: 12px; line-height: 20px; }
</style>
