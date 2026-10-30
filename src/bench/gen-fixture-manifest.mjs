import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 生成 mockBridge 使用的夹具清单。
//
// 为什么需要这一步：
// mockBridge 需要在纯浏览器环境（Vitest / Playwright / pnpm ui:dev）下拿到
// fixtures 的文本内容。直觉做法是用 import.meta.glob 匹配 ../../fixtures，
// 但 Vite 的 glob 不允许跳出项目根（root 是 src/ui），越界模式会静默匹配
// 到 0 个文件 —— 实测只拿到 basic.md 一个。
//
// 因此改在构建前扫描 fixtures 目录，把内容写成静态 TS 模块，mockBridge 直接 import。
// 优点：与 Vite root 无关、路径永远正确、生成物可被 TypeScript 检查、确定性输出。
//
// 大文件（generated/ 下的 10MB/50MB）与二进制资源不纳入清单，避免 dev server 内存爆炸。
//
// 用法：node src/bench/gen-fixture-manifest.mjs

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures')
const OUT_FILE = join(REPO_ROOT, 'src', 'ui', 'src', 'core', 'ipc', 'fixture-manifest.generated.ts')

const EXCLUDE_DIRS = new Set(['generated', 'resources'])
const MAX_BYTES = 2 * 1024 * 1024

async function collect(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      await collect(full, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!entry.name.toLowerCase().endsWith('.md')) continue

    const rel = relative(FIXTURES_DIR, full).replace(/\\/g, '/')
    if (rel === '') continue

    const st = await stat(full)
    if (st.size > MAX_BYTES) {
      console.log(`skip (too large): ${rel} (${(st.size / 1024 / 1024).toFixed(1)} MB)`)
      continue
    }

    out.push({ rel, full })
  }
  return out
}

function renderModule(contents) {
  const head = [
    '/**',
    ' * 自动生成，请勿手动编辑。',
    ' *',
    ' * 由 node src/bench/gen-fixture-manifest.mjs 生成。',
    ' * 内容来源：仓库根 fixtures/ 下的 Markdown 文件',
    ' * （排除 generated/ 与二进制资源，单文件上限 2 MB）。',
    ' *',
    ' * 用途：让 mockBridge 在无文件系统访问的环境',
    ' * （Vitest / Playwright / 纯浏览器 dev）下也能拿到夹具原文。',
    ' */',
    '',
    '/** 夹具相对路径 → 文件原文。键统一使用正斜杠。 */',
    'export const FIXTURE_MANIFEST: Readonly<Record<string, string>> = {',
  ]

  const body = contents.map(({ rel, text }) => `  ${JSON.stringify(rel)}: ${JSON.stringify(text)},`)

  const tail = [
    '}',
    '',
    '/** 全部可用夹具的相对路径（已排序）。 */',
    'export const FIXTURE_PATHS: readonly string[] = Object.keys(FIXTURE_MANIFEST).sort()',
    '',
  ]

  return [...head, ...body, ...tail].join('\n')
}

async function main() {
  const entries = await collect(FIXTURES_DIR)
  entries.sort((a, b) => a.rel.localeCompare(b.rel))

  const contents = []
  for (const entry of entries) {
    contents.push({ rel: entry.rel, text: await readFile(entry.full, 'utf8') })
  }

  await mkdir(dirname(OUT_FILE), { recursive: true })
  await writeFile(OUT_FILE, renderModule(contents), 'utf8')

  console.log(`生成 ${contents.length} 个夹具 -> ${relative(REPO_ROOT, OUT_FILE)}`)
  for (const c of contents) {
    console.log(`  ${c.rel} (${c.text.length} chars)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
