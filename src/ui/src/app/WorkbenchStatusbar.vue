<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { EnvInfo } from '../core/ipc'
import type { AppTheme, MarkdownTheme } from '../core/theme/apply'

const props = defineProps<{
  appTheme: AppTheme
  markdownTheme: MarkdownTheme
  folderName: string
  folderPath: string
  documentLabel: string
  documentPath: string
  documentName: string
  encoding: string
  headingCount: number | null
  tabCount: number
  loadingName: string
  linkTarget?: string
  env: EnvInfo | null
}>()
const emit = defineEmits<{ 'update:appTheme': [theme: AppTheme]; 'update:markdownTheme': [theme: MarkdownTheme] }>()
const environmentOpen = ref(false)
const displayRatio = ref('')
const uiFont = ref('')
const environmentLabels: Record<string, string> = { appVersion: '应用版本', tauriVersion: 'Tauri 版本', rustVersion: 'Rust 版本',
  os: '系统平台', osVersion: '系统版本', webviewVersion: 'WebView 版本', locale: '区域语言', buildRevision: '构建标识', buildTime: '构建时间' }
function environmentValue(key: string, value: string | undefined): string {
  return key === 'buildTime' && value && /^\d{13}$/.test(value) ? new Date(Number(value)).toLocaleString() : value || '未知'
}
const documentDirectory = computed(() => props.documentLabel.endsWith(props.documentName) && props.documentName
  ? props.documentLabel.slice(0, -props.documentName.length) : '')
const closeButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

function closeEnvironment(restore = true): void {
  if (!environmentOpen.value) return
  environmentOpen.value = false
  if (restore) void nextTick().then(() => returnFocus?.focus())
}
function showEnvironment(): void {
  displayRatio.value = `${Math.round(window.devicePixelRatio * 100)}%`
  uiFont.value = getComputedStyle(document.body).fontFamily || '系统默认字体'
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  environmentOpen.value = true
  void nextTick().then(() => closeButton.value?.focus())
}
function toggleEnvironment(): void {
  if (environmentOpen.value) closeEnvironment()
  else showEnvironment()
}
function onPointerDown(event: PointerEvent): void {
  if (!environmentOpen.value || !(event.target instanceof Element)) return
  if (!event.target.closest('[data-status-environment-popup], [data-testid="status-environment"]')) closeEnvironment(false)
}
function onKeyDown(event: KeyboardEvent): void {
  if (environmentOpen.value && event.key === 'Escape') { event.preventDefault(); closeEnvironment() }
}
function themeChanged(event: Event, kind: 'app' | 'markdown'): void {
  const value = (event.target as HTMLSelectElement).value
  if (kind === 'app' && (value === 'light' || value === 'dark')) emit('update:appTheme', value)
  if (kind === 'markdown' && (value === 'light' || value === 'dark' || value === 'paper')) emit('update:markdownTheme', value)
}
onMounted(() => { document.addEventListener('pointerdown', onPointerDown); document.addEventListener('keydown', onKeyDown) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) })
defineExpose({ showEnvironment })
</script>

<template>
  <footer class="statusbar">
    <button type="button" class="status-environment" data-testid="status-environment" aria-label="环境信息" title="环境信息" :aria-expanded="environmentOpen" @click="toggleEnvironment"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7v5M8 4v1" /></svg></button>
    <div class="status-location">
      <span v-if="linkTarget" class="status-folder" role="status" aria-label="链接目标" :title="linkTarget">{{ linkTarget }}</span>
      <nav v-else-if="documentLabel" class="status-document-path" aria-label="文档路径" :title="documentPath"><span v-if="documentDirectory" class="status-path-directory">{{ documentDirectory }}</span><span class="status-path-filename">{{ documentName || documentLabel }}</span></nav>
      <span v-else class="status-folder" :title="folderPath">{{ folderName || '未打开文件夹' }}</span>
      <span v-if="loadingName" class="status-loading" role="status">正在打开 {{ loadingName }}…</span>
    </div>
    <span v-if="headingCount !== null" class="status-item">{{ headingCount }} 个章节</span>
    <span class="status-item">{{ tabCount }} 个文档</span>
    <span v-if="encoding" class="status-item">{{ encoding.toUpperCase() }}</span>
    <label class="status-theme"><span>界面</span><span class="status-select"><select :value="appTheme" data-testid="app-theme" aria-label="界面主题" @change="themeChanged($event, 'app')"><option value="dark">深色</option><option value="light">浅色</option></select><svg viewBox="0 0 12 8" fill="none" stroke="currentColor" aria-hidden="true"><path d="m2 2 4 4 4-4" /></svg></span></label>
    <label class="status-theme"><span>正文</span><span class="status-select"><select :value="markdownTheme" data-testid="md-theme" aria-label="正文主题" @change="themeChanged($event, 'markdown')"><option value="dark">深色</option><option value="light">浅色</option><option value="paper">纸张</option></select><svg viewBox="0 0 12 8" fill="none" stroke="currentColor" aria-hidden="true"><path d="m2 2 4 4 4-4" /></svg></span></label>
    <section v-if="environmentOpen" class="diagnostics" role="dialog" aria-label="环境信息" data-status-environment-popup>
      <div class="popup-heading"><span>环境信息</span><button ref="closeButton" type="button" aria-label="关闭环境信息" @click="closeEnvironment()">×</button></div>
      <dl v-if="env"><template v-for="(value, key) in env" :key="key"><dt>{{ environmentLabels[key] || key }}</dt><dd>{{ environmentValue(key, value) }}</dd></template><dt>显示比例</dt><dd>{{ displayRatio }}</dd><dt>界面字体</dt><dd>{{ uiFont }}</dd></dl><p v-else>正在读取环境信息…</p>
    </section>
    <slot />
  </footer>
</template>

<style scoped>
.statusbar { position: relative; z-index: 10; display: flex; flex: 0 0 var(--app-statusbar-h, 22px); align-items: center; gap: 0; min-width: 0; height: var(--app-statusbar-h, 22px); padding: 0 5px; color: var(--app-status-fg); background: var(--app-status-bg); font-size: 12px; white-space: nowrap; }
.status-location { display: flex; flex: 1; align-items: center; min-width: 0; height: 100%; padding: 0 6px; overflow: hidden; }
.status-document-path { display: flex; flex: 1; min-width: 0; overflow: hidden; }
.status-path-directory, .status-folder, .status-loading { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.status-path-directory { flex: 0 1 auto; color: var(--app-status-muted); }
.status-path-filename { flex: 0 0 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.status-loading { max-width: 60%; margin-left: 12px; color: var(--app-status-muted); }
.status-item { display: flex; flex: none; align-items: center; height: 100%; padding: 0 6px; }
.status-theme { display: flex; flex: none; align-items: center; gap: 4px; height: 100%; padding: 0 6px; color: var(--app-status-muted); }
.status-select { display: inline-flex; position: relative; height: 100%; color: var(--app-status-fg); }
.status-select svg { position: absolute; top: 7px; right: 4px; width: 10px; height: 8px; stroke-width: 1.2; pointer-events: none; }
.status-theme select { appearance: none; min-width: 45px; height: 100%; padding: 0 16px 0 0; border: 0; border-radius: 0; color: var(--app-status-fg); background: transparent; font: inherit; cursor: pointer; }
.status-theme option { color: var(--app-fg); background: var(--app-bg-elevated); }
.status-theme:hover, .status-environment:hover { background: var(--app-status-hover); }
.statusbar .status-theme select:focus-visible, .statusbar .status-environment:focus-visible { outline: 1px solid var(--app-status-fg); outline-offset: -2px; background: var(--app-status-hover); }
.status-environment { display: grid; flex: none; place-items: center; width: 26px; height: 100%; padding: 0 6px; border: 0; border-radius: 0; color: inherit; background: transparent; }
.status-environment svg { width: 14px; height: 14px; stroke-width: 1; }
.diagnostics { position: absolute; left: 5px; bottom: 25px; z-index: 60; width: min(440px, calc(100vw - 16px)); padding: 10px 16px 16px; border: 1px solid var(--app-border); border-radius: 5px; color: var(--app-fg); background: var(--app-sidebar-bg); box-shadow: 0 4px 16px #0003; white-space: normal; user-select: text; }
.popup-heading { display: flex; align-items: center; justify-content: space-between; height: 28px; margin-bottom: 8px; font-size: 13px; }
.popup-heading button { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 0; color: var(--app-fg-muted); background: transparent; font-size: 20px; line-height: 1; }
.popup-heading button:hover { color: var(--app-fg); background: var(--app-hover); }
.diagnostics dl { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 8px; margin: 0; font-size: 12px; }
.diagnostics dt { color: var(--app-fg-muted); }
.diagnostics dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 700px) { .statusbar { padding-inline: 3px; } .status-item, .status-location, .status-theme { padding-inline: 4px; } .status-theme { gap: 2px; } }
</style>
