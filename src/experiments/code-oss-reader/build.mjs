import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const uiRequire = createRequire(new URL('../../ui/package.json', import.meta.url))
const { build } = await import(pathToFileURL(uiRequire.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(uiRequire.resolve('@vitejs/plugin-vue')).href)
const alias = [{ find: /^vue$/, replacement: uiRequire.resolve('vue/dist/vue.runtime.esm-bundler.js') }]

await build({ configFile: false, root, base: './', plugins: [vue()], resolve: { alias },
  build: { outDir: 'dist/webview', target: 'chrome120', emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'webview/main.ts'), output: { entryFileNames: 'main.js', assetFileNames: 'assets/[name]-[hash][extname]' } },
    cssCodeSplit: false, assetsInlineLimit: 0 }, logLevel: 'warn' })
await build({ configFile: false, root, ssr: { noExternal: true },
  build: { ssr: resolve(root, 'parse-worker.mjs'), outDir: 'dist/worker', target: 'node22', emptyOutDir: true, minify: false,
    rollupOptions: { external: [/^node:/], output: { entryFileNames: 'parse-worker.mjs', chunkFileNames: '[name]-[hash].mjs' } } }, logLevel: 'warn' })
process.stdout.write('Code OSS reader webview and Node parser worker built.\n')
