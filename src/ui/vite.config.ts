import { createReadStream, realpathSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'
// 用 vitest/config 的 defineConfig，才能在同一文件里声明 `test` 配置块。
// 直接 import vite 的 defineConfig 会因 UserConfigExport 不含 test 字段而类型报错。
import { defineConfig } from 'vitest/config'

function fixtureAssets(): Plugin {
  return {
    name: 'local-fixture-assets', apply: 'serve',
    configureServer(server) {
      const root = realpathSync(fileURLToPath(new URL('../../fixtures', import.meta.url)))
      server.middlewares.use('/__fixtures', (request, response) => {
        try {
          const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
          const path = realpathSync(resolve(root, `.${decodeURIComponent(pathname)}`))
          const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' }
          const mime = types[extname(path).toLowerCase()]
          if (!path.startsWith(root + sep) || !mime) { response.statusCode = 403; response.end(); return }
          response.setHeader('Content-Type', mime)
          createReadStream(path).pipe(response)
        } catch { response.statusCode = 404; response.end() }
      })
    },
  }
}

// 端口与 src/host/tauri.conf.json 的 devUrl 必须一致。
// strictPort: 端口被占用时立即失败，而不是静默换端口导致 Tauri 连错地址。
export default defineConfig({
  plugins: [vue(), fixtureAssets()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    headers: { 'Content-Security-Policy': "img-src 'self' data: blob:" },
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 构建产物与 gen 目录会高频变化，不参与前端 HMR 监听
      ignored: ['**/src/host/**', '**/target/**'],
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    // WebView2 156 对应 Chromium 140+，取保守值留出兼容余量
    target: 'chrome120',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vite 8 / Rolldown 要求 manualChunks 为函数形式，对象形式已不支持。
        // 目标：把体积大且首屏不需要的依赖拆成独立 chunk，保证首屏不加载。
        manualChunks(id: string) {
          if (id.includes('node_modules/mermaid') || id.includes('node_modules/@mermaid-js')) {
            return 'mermaid'
          }
          if (id.includes('node_modules/shiki') || id.includes('node_modules/@shikijs')) {
            return 'shiki'
          }
          if (
            id.includes('node_modules/katex') ||
            id.includes('node_modules/@vscode/markdown-it-katex')
          ) {
            return 'katex'
          }
          return undefined
        },
      },
    },
  },
  optimizeDeps: {
    // Vite 8 直接服务 Mermaid 的传递 CJS 依赖 dayjs 会缺少 default 导出。
    // 开发期预构建其依赖；生产代码仍保持动态导入。
    include: ['mermaid'],
  },
  test: {
    // 纯逻辑测试默认 node 环境（快）；需要 DOM 的测试在文件顶部用
    // `// @vitest-environment happy-dom` 指令切换。
    // Vitest 5 已移除 environmentMatchGlobs，改用 per-file 指令。
    environment: 'node',
    // 只收集单元/组件测试；e2e/** 是 Playwright 的，不能被 Vitest 拾取。
    include: ['tests/unit/**/*.spec.ts', 'tests/component/**/*.spec.ts'],
  },
})
