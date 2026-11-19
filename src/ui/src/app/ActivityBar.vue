<script setup lang="ts">
type WorkbenchPanel = 'files' | 'search' | 'outline'

defineProps<{ active: WorkbenchPanel | null }>()
const emit = defineEmits<{ select: [panel: WorkbenchPanel] }>()

const panels: { id: WorkbenchPanel; label: string; paths: string[] }[] = [
  { id: 'files', label: '文件', paths: ['M8 3h8l4 4v14H8z', 'M16 3v5h4', 'M4 7v14h10'] },
  { id: 'search', label: '搜索', paths: ['M20 20l-5-5', 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'] },
  { id: 'outline', label: '大纲', paths: ['M9 5h12M9 12h12M9 19h12', 'M3 5h1M3 12h1M3 19h1'] },
]
</script>

<template>
  <nav class="activity-bar" aria-label="工作台面板">
    <button v-for="panel in panels" :key="panel.id" type="button" class="activity-button"
      :class="{ selected: active === panel.id }" :aria-label="panel.label" :title="panel.label"
      :aria-pressed="active === panel.id" :data-testid="`activity-${panel.id}`"
      @click="emit('select', panel.id)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path v-for="path in panel.paths" :key="path" :d="path" />
      </svg>
    </button>
  </nav>
</template>

<style scoped>
.activity-bar {
  display: flex;
  flex: 0 0 48px;
  flex-direction: column;
  align-items: center;
  width: 48px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: var(--app-rail-bg);
}
.activity-button {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 48px;
  height: 48px;
  margin: 0;
  padding: 12px;
  border: 0;
  border-radius: 0;
  color: var(--app-rail-fg);
  background: transparent;
  cursor: pointer;
}
.activity-button svg { width: 24px; height: 24px; }
.activity-button:hover { color: var(--app-rail-active); background: var(--app-rail-hover); }
.activity-button.selected { color: var(--app-rail-active); background: var(--app-rail-selection); }
.activity-button.selected::before { position: absolute; inset: 8px auto 8px 0; width: 2px; border-radius: 0 1px 1px 0; background: var(--app-rail-indicator); content: ''; }
.activity-button:focus-visible { outline: 1px solid var(--app-rail-focus); outline-offset: -3px; }
</style>
