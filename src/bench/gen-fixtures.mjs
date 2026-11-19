#!/usr/bin/env node
// 夹具生成脚本 —— 确定性生成，可重复运行，结果字节一致。
//
// 用法：
//   node src/bench/gen-fixtures.mjs              # 生成全部
//   node src/bench/gen-fixtures.mjs --only tabs  # 只生成 tabs
//   node src/bench/gen-fixtures.mjs --out <dir>  # 自定义输出目录（默认仓库根）
//
// 生成物：
//   fixtures/tabs/{a..t}.md          20 个多标签测试文件
//   fixtures/generated/{100kb,1mb,10mb,50mb}.md
//   fixtures/generated/mermaid-100.md
//   fixtures/generated/code-heavy.md
//   fixtures/generated/math-heavy.md
//
// 大文件默认不提交（见 .gitignore 的 fixtures/generated/）。

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

// 固定种子 PRNG（mulberry32），保证每次生成的随机内容一致。
function makeRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LOREM = [
  '渲染管线分为解析、增强与序列化三个阶段，每个阶段都有明确的输入输出契约。',
  '大文件不应阻塞主线程，因此解析在 Web Worker 中完成，主线程只负责 DOM 操作。',
  '标签切换时若内容未变化，必须复用已缓存的结果，不得重新解析。',
  '外部编辑器保存文件时可能采用临时文件加原子替换的方式，因此必须监听父目录。',
  '链接点击需要按类型分流：页内锚点、本地文档、本地附件、外部链接与拦截。',
  '安全策略采用纵深防御：前端消毒、CSP 限制、Rust 侧路径与 URL 校验三重保障。',
  '主题切换不应重新解析正文，代码高亮通过 CSS 变量完成双主题切换。',
  '内存管理需要预算与逐出策略，非活动标签只保留轻量数据而非完整 DOM。',
]

const CODE_SNIPPETS = [
  ['js', 'export function greet(name) {\n  return `Hello, ${name}!`\n}'],
  ['ts', 'interface DocMeta {\n  docId: string\n  version: number\n}'],
  [
    'python',
    'def fib(n: int) -> int:\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a',
  ],
  ['rust', 'pub fn is_within(root: &Path, p: &Path) -> bool {\n    p.starts_with(root)\n}'],
  ['sql', 'SELECT doc_id, version FROM documents WHERE stale = 1;'],
  ['bash', 'pnpm --dir src/ui build'],
  ['json', '{ "appTheme": "dark", "mdTheme": "paper" }'],
  ['css', '.md-doc { --md-measure: 46rem; }'],
]

const MATH_SNIPPETS = [
  'E = mc^2',
  'a^2 + b^2 = c^2',
  '\\frac{1}{2}',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}',
  '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
]

const MERMAID_KINDS = [
  (i) =>
    `graph TD\n  A${i}[开始 ${i}] --> B${i}{判断}\n  B${i} -->|是| C${i}[执行]\n  B${i} -->|否| D${i}[结束]`,
  (i) =>
    `sequenceDiagram\n  participant U as 用户\n  participant A as 应用${i}\n  U->>A: 请求 ${i}\n  A->>U: 响应 ${i}`,
  (i) =>
    `classDiagram\n  class Doc${i} {\n    +string docId\n    +number version\n  }\n  class Tab${i} {\n    +string status\n  }\n  Tab${i} --> Doc${i}`,
  (i) => `pie title 分布 ${i}\n  "单元" : 40\n  "组件" : 25\n  "E2E" : 20\n  "手工" : 15`,
  (i) =>
    `stateDiagram-v2\n  [*] --> Idle${i}\n  Idle${i} --> Loading${i}\n  Loading${i} --> Ready${i}\n  Ready${i} --> [*]`,
]

const TABS_NAMES = [
  'a',
  'B',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
]
const CN_NUM = [
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
]

function genTab(name, index) {
  const n = index + 1
  const mark = `TAB-MARKER-${name.toUpperCase()}`
  const anchor = `章节${CN_NUM[index] ?? String(n)}`
  const listItems = Array.from({ length: n }, (_, k) => `- 列表项 ${k + 1}：用于制造长度差异`).join(
    '\n',
  )
  const extra = n % 3 === 0 ? '该文档的章节数较多，用于验证 TOC 层级与滚动高亮。' : '普通子节内容。'
  const mermaidBlock = n % 4 === 0 ? `\n\`\`\`mermaid\ngraph LR\n  Doc${n} --> Check\n\`\`\`\n` : ''

  return `# 文档 ${name}

这是多标签测试样本 ${name} / ${TABS_NAMES.length}。唯一标记：**${mark}**。

用于验证：标签打开、切换、关闭、重排、溢出、持久化，以及切换时不重新解析。

## ${anchor}

第 ${n} 个文档的第一节。内容按序号变化，用于让每个文件长度与结构略有差异：

${listItems}

### 子节

${extra}

${mermaidBlock}
## 第二节

段落内容 ${n}。滚动到此处后切换标签，再切回应能恢复位置。

> 引用块 ${n}，用于验证切换后样式与位置一致性。

---

文档 ${name} 结束。
`
}

function genLongBody(random, targetBytes) {
  const parts = []
  let bytes = 0
  let section = 0

  while (bytes < targetBytes) {
    section += 1
    const chunk = []
    chunk.push(`## 第 ${section} 节\n\n`)

    const paraCount = 3 + Math.floor(random() * 3)
    for (let p = 0; p < paraCount; p += 1) {
      const sentences = 2 + Math.floor(random() * 3)
      const para = Array.from(
        { length: sentences },
        () => LOREM[Math.floor(random() * LOREM.length)],
      ).join('')
      chunk.push(`${para}\n\n`)
    }

    if (section % 5 === 0) {
      const [lang, code] = CODE_SNIPPETS[Math.floor(random() * CODE_SNIPPETS.length)]
      chunk.push(`\`\`\`${lang}\n${code}\n\`\`\`\n\n`)
    }

    if (section % 7 === 0) {
      chunk.push('| 指标 | 值 | 说明 |\n|---|---|---|\n')
      chunk.push(`| 场景 ${section} | ${Math.floor(random() * 1000)} | 生成数据 |\n`)
      chunk.push(`| 场景 ${section + 1} | ${Math.floor(random() * 1000)} | 生成数据 |\n\n`)
    }

    if (section % 11 === 0) {
      chunk.push(`> 引用：${LOREM[Math.floor(random() * LOREM.length)]}\n\n`)
    }

    if (section % 13 === 0) {
      chunk.push(`- 列表项 A ${section}\n- 列表项 B ${section}\n  - 嵌套项 ${section}\n\n`)
    }

    if (section % 17 === 0) {
      chunk.push(`行内公式 $${MATH_SNIPPETS[Math.floor(random() * MATH_SNIPPETS.length)]}$。\n\n`)
    }

    const piece = chunk.join('')
    parts.push(piece)
    bytes += Buffer.byteLength(piece, 'utf8')
  }

  return `# 大型文档样本\n\n自动生成，用于性能测试。目标大小约 ${Math.round(targetBytes / 1024)} KB。\n\n${parts.join('')}`
}

function genMermaid100() {
  const blocks = []
  for (let i = 1; i <= 100; i += 1) {
    const kind = MERMAID_KINDS[i % MERMAID_KINDS.length]
    blocks.push(`### 图表 ${i}\n\n\`\`\`mermaid\n${kind(i)}\n\`\`\`\n`)
  }
  return `# 100 个 Mermaid 图表\n\n用于验证按需渲染、任务队列与 CPU 峰值。\n\n${blocks.join('\n')}`
}

function genCodeHeavy() {
  const blocks = []
  const blockCount = 200
  const bytesPerBlock = Math.ceil((2 * 1024 * 1024) / blockCount)
  for (let i = 1; i <= blockCount; i += 1) {
    const [lang, code] = CODE_SNIPPETS[i % CODE_SNIPPETS.length]
    const prefix = `### 代码块 ${i}（${lang}）\n\n\`\`\`${lang}\n`
    const suffix = `// 块编号 ${i}\n\`\`\`\n`
    const snippet = `${code}\n\n`
    const overhead = Buffer.byteLength(prefix + suffix, 'utf8')
    const repeats = Math.max(1, Math.ceil((bytesPerBlock - overhead) / Buffer.byteLength(snippet, 'utf8')))
    blocks.push(prefix + snippet.repeat(repeats) + suffix)
  }
  return `# 代码密集文档\n\n200 个代码块，总计约 2 MiB。用于验证 Shiki 高亮的性能与内存。\n\n${blocks.join('\n')}`
}

function genMathHeavy() {
  const blocks = []
  for (let i = 1; i <= 250; i += 1) {
    const inline = MATH_SNIPPETS[i % MATH_SNIPPETS.length]
    const block = MATH_SNIPPETS[(i + 2) % MATH_SNIPPETS.length]
    blocks.push(`### 公式组 ${i}\n\n行内：$${inline}$\n\n块级：\n\n$$\n${block}\n$$\n`)
  }
  return `# 公式密集文档\n\n500 个公式（250 行内 + 250 块级）。用于验证 KaTeX 输出的体积膨胀与渲染性能。\n\n${blocks.join('\n')}`
}

async function writeIfChanged(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return Buffer.byteLength(content, 'utf8')
}

async function main() {
  const args = process.argv.slice(2)
  const onlyIndex = args.indexOf('--only')
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null
  const outIndex = args.indexOf('--out')
  const outRoot = outIndex >= 0 ? resolve(args[outIndex + 1]) : REPO_ROOT

  const want = (name) => only === null || only === name

  let total = 0

  if (want('tabs')) {
    for (let i = 0; i < TABS_NAMES.length; i += 1) {
      const name = TABS_NAMES[i]
      const bytes = await writeIfChanged(
        join(outRoot, 'fixtures', 'tabs', `${name}.md`),
        genTab(name, i),
      )
      total += bytes
    }
    console.log(`tabs: ${TABS_NAMES.length} files`)
  }

  if (want('large')) {
    const specs = [
      ['100kb.md', 100 * 1024, 1001],
      ['1mb.md', 1024 * 1024, 2002],
      ['10mb.md', 10 * 1024 * 1024, 3003],
      ['50mb.md', 50 * 1024 * 1024, 4004],
    ]
    for (const [file, size, seed] of specs) {
      const random = makeRandom(seed)
      const bytes = await writeIfChanged(
        join(outRoot, 'fixtures', 'generated', file),
        genLongBody(random, size),
      )
      total += bytes
      console.log(`${file}: ${(bytes / 1024).toFixed(1)} KB`)
    }
  }

  if (want('special')) {
    total += await writeIfChanged(
      join(outRoot, 'fixtures', 'generated', 'mermaid-100.md'),
      genMermaid100(),
    )
    total += await writeIfChanged(
      join(outRoot, 'fixtures', 'generated', 'code-heavy.md'),
      genCodeHeavy(),
    )
    total += await writeIfChanged(
      join(outRoot, 'fixtures', 'generated', 'math-heavy.md'),
      genMathHeavy(),
    )
    console.log('special: mermaid-100 / code-heavy / math-heavy')
  }

  console.log(`\n合计 ${(total / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
