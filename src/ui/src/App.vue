<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { EnvInfo } from '@/core/ipc'
import { bridge, isMock } from '@/core/ipc'
import { mockAvailableFixtures } from '@/core/ipc/mockBridge'

const env = ref<EnvInfo | null>(null)
const fixtures = ref<string[]>([])
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    env.value = await bridge.getEnvInfo()
    // mockBridge 由 index.ts 静态引入，这里直接用，避免重复动态导入告警
    if (isMock) fixtures.value = mockAvailableFixtures()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})
</script>

<template>
  <div class="app-shell">
    <header class="titlebar">
      <span class="title">Markdown 预览</span>
      <span class="badge">骨架 · IPC {{ isMock ? 'mock (fixtures)' : 'Tauri host' }}</span>
    </header>

    <main class="content">
      <p class="hint">Phase 0 / T02 骨架已就绪。阅读区、标签栏与链接跳转在 T24b / T24c 接入。</p>

      <p v-if="error" class="error">IPC 探测失败：{{ error }}</p>

      <section v-if="env" class="panel">
        <h2>环境</h2>
        <dl>
          <dt>appVersion</dt>
          <dd>{{ env.appVersion }}</dd>
          <dt>tauriVersion</dt>
          <dd>{{ env.tauriVersion }}</dd>
          <dt>rustVersion</dt>
          <dd>{{ env.rustVersion }}</dd>
          <dt>webviewVersion</dt>
          <dd>{{ env.webviewVersion }}</dd>
          <dt>locale</dt>
          <dd>{{ env.locale }}</dd>
        </dl>
      </section>

      <section v-if="fixtures.length" class="panel">
        <h2>可用夹具（{{ fixtures.length }}）</h2>
        <ul>
          <li v-for="f in fixtures" :key="f">{{ f }}</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--app-titlebar-h);
  padding: 0 12px;
  border-bottom: 1px solid var(--app-border);
  background: var(--app-bg-elevated);
  flex: 0 0 auto;
}

.title {
  font-weight: 600;
}

.badge {
  color: var(--app-fg-muted);
  font-size: 11px;
}

.content {
  flex: 1 1 auto;
  overflow: auto;
  padding: 16px;
}

.hint {
  color: var(--app-fg-muted);
  margin: 0 0 16px;
}

.error {
  color: #cf222e;
}

.panel {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-bg-elevated);
}

.panel h2 {
  margin: 0 0 8px;
  font-size: 13px;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
}

dt {
  color: var(--app-fg-muted);
}

dd {
  margin: 0;
}

ul {
  margin: 0;
  padding-left: 20px;
}
</style>
