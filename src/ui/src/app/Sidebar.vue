<script setup lang="ts">
import type { TocEntry } from '../core/render/contract'

defineOptions({ name: 'DocumentSidebar' })

withDefaults(defineProps<{ entries: TocEntry[]; activeId: string; hasDocument?: boolean }>(), { hasDocument: true })
defineEmits<{ navigate: [id: string] }>()
</script>
<template>
  <aside class="sidebar">
    <h2>大纲 <span>{{ entries.length }}</span></h2>
    <nav aria-label="文档目录">
      <button v-for="entry in entries" :key="entry.id" type="button"
        :style="{ paddingLeft: `${20 + (entry.level - 1) * 16}px` }"
        :aria-current="activeId === entry.id ? 'location' : undefined"
        :title="entry.text || '无标题章节'" @click="$emit('navigate', entry.id)">{{ entry.text || '无标题章节' }}</button>
    </nav>
    <p v-if="!entries.length" class="muted">{{ hasDocument ? '此文档没有标题' : '打开文档后显示大纲' }}</p>
  </aside>
</template>

<style scoped>
.sidebar { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 0; overflow: auto; font-size: 13px; }
.sidebar h2 { display: flex; flex: 0 0 var(--app-tabs-h); align-items: center; height: var(--app-tabs-h); margin: 0; padding: 0 8px 0 20px; color: var(--app-fg); font-size: 12px; font-weight: 400; }
.sidebar h2 span { margin-left: auto; color: var(--app-fg-muted); font-variant-numeric: tabular-nums; }
.sidebar nav { display: flex; flex-direction: column; }
.sidebar nav button { flex: 0 0 var(--app-sidebar-row-h); width: 100%; min-width: 0; height: var(--app-sidebar-row-h); min-height: var(--app-sidebar-row-h); overflow: hidden; padding: 0 8px 0 20px; border: 0; border-radius: 0; color: var(--app-fg); background: transparent; font: inherit; line-height: var(--app-sidebar-row-h); text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.sidebar nav button:hover { background: var(--app-hover); }
.sidebar nav button[aria-current] { color: var(--app-accent-strong); background: var(--app-selection); }
.sidebar nav button:focus-visible { outline: 1px solid var(--app-accent); outline-offset: -1px; }
.sidebar .muted { margin: 0; padding: 8px 20px; color: var(--app-fg-muted); font-size: 12px; line-height: 20px; }
</style>
