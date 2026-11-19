# 01 — 渲染管线

> 覆盖 FR-002 / FR-003 / FR-004 / FR-005 / NFR-001 / NFR-009。
> 代码落点:`src/ui/src/core/markdown/**`、`src/ui/src/workers/parse.worker.ts`、`src/ui/src/core/sanitize/policy.ts`。

---

## 1. 管线总览

```text
text
 │
 ├─[Worker] markdown-it(commonmark preset + 语义选项)
 │     ├─ 插件链: footnote → anchor → alerts → katex → shiki
 │     └─ 自研规则: taskList
 │
 ├─[Worker] token 增强(core rule,按序)
 │     1 augment/blocks      顶层 block 注入 data-src-line
 │     2 augment/mermaid     fence(mermaid) → 占位 div,不在解析期渲染
 │     3 augment/unknownLang 未知语言 → 纯文本代码块 + warning
 │     4 augment/externalLink 外链 → rel + data-md-external
 │     5 augment/lazyImage   图片 → loading/decoding
 │
 ├─[Worker] renderer.render(tokens) → html
 ├─[Worker] 提取 toc / blocks / flags
 │
 ├─[主线程] hasRawHtml ? DOMPurify.sanitize(html, POLICY) : html
 ├─[主线程] innerHTML
 ├─[主线程] Mermaid 懒渲染(IntersectionObserver)
 └─[主线程] 锚点索引 / 搜索索引 / TOC 高亮
```

---

## 2. markdown-it 配置

```ts
// src/ui/src/core/markdown/preset.ts
import MarkdownIt from 'markdown-it'

export function createMarkdownIt(): MarkdownIt {
  // ⚠️ 必须用 'default' preset，不能用 'commonmark'。
  // 实测（T05，markdown-it@15.0.3）：'commonmark' preset 的 block/inline 规则集
  // 不包含 table、strikethrough，且会禁用 linkify —— 与 FR-003 要求的 GFM 能力冲突。
  //   commonmark: table=false strike=false linkify=false rawhtml=true
  //   default:    table=true  strike=true  linkify=true  rawhtml=true
  // 我们需要的正是「default 的规则集 + 显式的 html/breaks/typographer 选项」。
  return new MarkdownIt('default', {
    html: true,          // 原始 HTML 放行，由 DOMPurify 按需消毒（见 06-security.md）
    xhtmlOut: false,
    breaks: false,       // 不做「单换行=硬换行」，保持 CommonMark 换行语义
    langPrefix: 'language-',
    linkify: true,       // 依赖 'default' preset，'commonmark' 下此项无效
    typographer: false,  // 关闭智能引号，避免破坏中文排版与代码片段
    quotes: '“”‘’',
    maxNesting: 100,
  })
}
```

**为什么不是 `'commonmark'` presets**：`commonmark` 的组件规则表是**硬编码子集**，只启用 CommonMark 规范内的规则。它明确排除了表格与删除线（GFM 扩展），并且 `linkify` 选项在 `commonmark` 下不生效。若要 GFM，只能：

- （选用）用 `'default'` preset —— 它包含 table / strikethrough / linkify 的规则；
- 或手工 `md.enable(['table', 'strikethrough'])` 并自行管理规则集。

选 `'default'` 的理由：规则表由 markdown-it 维护，不会因为我们漏 enable 某个规则而静默缺失；且实测其 CommonMark 核心行为一致。

**CommonMark 纯合规性**：本项目不承诺"严格 CommonMark-only"，需求 FR-003 明确要求 GFM。用 `'default'` 是满足需求的最短路径。

**为什么 `typographer: false`**：智能引号会把 `'` `"` 替换成弯引号，在中文技术文档里会破坏代码片段与 CJK 标点混排；GitHub 本身也不做 typographer 替换。

**`breaks` 决策**：保持 `false`。需求文档 AC 未要求 Slack 式换行；若后续用户反馈强烈，作为设置项加入，而非改默认。

### 2.1 附带实测数据（T05，2026-10-29）

| preset | table | strikethrough | linkify | raw HTML |
|---|---|---|---|---|
| `commonmark` | ❌ | ❌ | ❌ | ✅ |
| `default` | ✅ | ✅ | ✅ | ✅ |
| `zero` | ❌ | ❌ | ❌ | ❌ |

来源：`src/ui/tests/unit/plugin-compat.spec.ts` 的 `markdown-it 15 核心能力` 用例组。

---

## 3. 插件链

### 3.1 装配顺序(顺序不可随意调整)

```ts
md.use(footnote)                       // 1. 脚注:先建立 footnote 引用解析
installHeadingAnchors(md)              // 2. 自研稳定锚点
if (opts.alerts) md.use(githubAlerts)   // 3. Alerts:blockquote 变换
if (opts.math) md.use(katexPlugin, { katex, throwOnError: false }) // 4. 数学
installTaskList(md)                    // 5. 自研只读任务列表
installHighlighter(md, highlightContext) // 6. 安全高亮与未知语言降级
installAugmentRules(md, { mermaid: opts.mermaid }) // 7. 元数据与安全标记
```

T06 的生产入口为 `await renderMarkdown(text, opts)`：等待复用的高亮器初始化后，同步完成单次解析和 HTML 输出，返回 `ParseResult`。`parseMs` 不包含高亮器初始化时间；Worker 消息调度在 T24 接入。

**各包的导入形式（T05 实测，2026-10-29）**

| 包 | 正确导入 | 备注 |
|---|---|---|
| `markdown-it-footnote` | `import footnote from 'markdown-it-footnote'` | default 导出 |
| ~~`markdown-it-anchor`~~ | **不采用** | 见 §3.2（有状态 slugger 缺陷） |
| `markdown-it-github-alerts` | `import githubAlerts from 'markdown-it-github-alerts'` | **只有 default 导出，没有 `full` 命名导出**（README 与包内容不一致，以 `dist/index.d.mts` 为准）；样式在 `markdown-it-github-alerts/styles/*` |
| `@vscode/markdown-it-katex` | `import katexPlugin from '@vscode/markdown-it-katex'` | default 导出；需同时装 `katex` 并传 `{ katex }` |
| `@shikijs/markdown-it` | `import Shiki from '@shikijs/markdown-it'` | default 导出，**异步工厂**：`await Shiki(opts)` |

### 3.2 各插件细节

#### 脚注 — `markdown-it-footnote@4.0.0`

- 产出 `<sup class="footnote-ref">` / `<section class="footnotes">`。
- 需在 CSS 中提供 `.footnotes` 样式(Markdown Theme 内)。
- 回链锚点使用 `footnote` 自带的 `fn1`/`fnref1` 命名，与标题锚点互不干扰。

#### 锚点 — **自研** `core/markdown/anchors.ts`

**不使用 `markdown-it-anchor`。** 理由（T05 实测，详见 `findings-plugin-compat.md` §2.2）：

它的 `slugify` 选项挂在 MarkdownIt **实例**上，而实例跨文档、跨渲染复用。
若传入有状态 slugger（`github-slugger` 实例或返回闭包的工厂），计数永不重置：

```text
第一次渲染： id="重复标题", id="重复标题-1"
第二次渲染： id="重复标题-2", id="重复标题-3"   ← 漂移
```

后果：目录跳转 100% 失效、切换标签后锚点漂移、视觉回归无故失败。

**本项目的实现**（`src/ui/src/core/markdown/anchors.ts`）：

```ts
// 1. slugify 是无状态纯函数
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')  // 先移除非法字符（保留空白）
    .replace(/\s+/g, '-')                // 空白 → 连字符
    .replace(/-{2,}/g, '-')              // 合并连续连字符
    .replace(/^-+|-+$/g, '')             // 去首尾连字符
}

// 2. 在每次 core rule 执行时收集标题并调用纯函数 dedupeIds(bases)。
// 去重状态局限于本次调用，不保存在模块、解析器或 env 中。
```

同一文档重复解析的 id 保持一致，即使调用方复用 env 也不会漂移。去重同时防止自然标题和自动后缀相撞，例如 `foo / foo / foo-1`；纯标点标题使用 `section` 基础 id。统一入口仍为每次渲染新建 env，使元数据保持独立。

**CJK 支持已验证**（`fixtures/cjk-typography.md`）：
- 纯中文标题 → `id="纯中文标题"`
- 中英混排 → `id="中英混排标题-english-mixed-标题"`
- 含全角标点 → `id="含标点的标题逗号句号顿号括号全角"`
- emoji → `id="emoji-与符号-目标"`
- 重复标题 → `重复标题`、`重复标题-1`、`重复标题-2`
#### GitHub Alerts — `markdown-it-github-alerts@1.0.1`

- 语法:`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`
- 输出容器带 `markdown-alert markdown-alert-<type>` 类。
- 需随包引入其 `styles/*` 并在 Markdown Theme 中做深浅色适配。

#### 数学 — `@vscode/markdown-it-katex@1.1.2` + `katex@0.16.47`

```ts
md.use(katexPlugin, { katex, throwOnError: false, errorColor: '#cc0000' })
```

- `throwOnError: false` 保证公式错误不中断整篇渲染(FR-011)。
- KaTeX 默认输出 `htmlAndMathml` → 生成大量 `<span class="katex">` 与 MathML 节点:
  - **HTML 体积放大约 8–20 倍**(与公式数量相关),这是大文件内存预算必须计入的部分。
  - MathML 部分是给屏幕阅读器与复制用的,DOMPurify 必须放行 `math/semantics/mrow/...` 标签。
- 需引入 `katex/dist/katex.min.css`(随包,不走 CDN,NFR-007)。

#### 代码高亮 — `@shikijs/markdown-it@4.5.0`

```ts
import Shiki from '@shikijs/markdown-it'

md.use(await Shiki({
  themes: { light: 'github-light', dark: 'github-dark' },
  defaultColor: false,   // 输出 --shiki-light / --shiki-dark CSS 变量
  langs: COMMON_LANGS,   // 显式预载,避免默认全量
}))
```

- `defaultColor: false` 使代码 token 颜色变成 CSS 变量,**主题切换只改 CSS,不重解析**(FR-009 要求)。
- `COMMON_LANGS` 首批 24 种:`bash, c, cpp, csharp, css, diff, go, html, ini, java, javascript, json, jsx, kotlin, lua, markdown, php, python, ruby, rust, shell, sql, toml, tsx, typescript, xml, yaml`。
- **未知语言必须自己兜住**:实测(T05)`@shikijs/markdown-it@4.5.0` 在遇到 `langs` 白名单之外的语言时会抛
  `ShikiError: Language 'xxx' not found`。因此必须在把源码交给 Shiki **之前**判断语言是否已加载:

  ```ts
  const isKnown = (lang: string) => highlighter.getLoadedLanguages().includes(lang as never)

  md.options.highlight = (code, lang) => {
    if (!lang || !isKnown(lang)) {
      unknownLangs.add(lang || '(none)')
      return ''            // 返回空串 → markdown-it 走默认 <pre><code> 纯文本渲染
    }
    return highlighter.codeToHtml(code, { lang, themes: { light, dark } })
  }
  ```

  这比"捕获异常再降级"更可靠:异常发生在 Shiki 内部，包在 try/catch 里仍会污染渲染流程。
- 未预载语言：先以 `<pre><code>` 纯文本输出并记 `unknownLangs`，同时异步 `highlighter.loadLanguage(lang)`；下次渲染该语言即生效。
- Shiki 高亮器是 **Worker 内长生命周期单例**，不得在渲染函数内反复创建。

#### 任务列表 — 自研 `rules/taskList.ts`

不引入 `markdown-it-task-lists@2.1.1`(2022-06 后无维护)。自研规则要点:

1. 在 core ruler 的 `inline` 之后注册规则，只识别 `list_item_open` 紧随首段的 `inline`。
2. 匹配行首 `[ ]` / `[x]` / `[X]`(后接空白)，移除前缀并保留已解析的行内 token，避免重复登记脚注。
3. 给 `list_item_open` 加 `class="task-list-item"`，给直接父级无序或有序列表加 `class="contains-task-list"`。
4. 在 inline children 起始插入专用 `md_task_checkbox` token，由 renderer 生成 `<input type="checkbox" class="task-list-checkbox" disabled checked?>`。不使用 `html_inline`，避免把内部控件误计为作者 HTML。
   - **必须 `disabled`**:首版只读,不做写回(NFR-008 非破坏性)。
   - 用 `aria-checked` 承载状态,便于样式与无障碍。
5. 单测覆盖:嵌套任务列表、任务列表内含强调、任务列表内 `[ ]` 出现在第二行时不应误判。

---

## 4. Token 增强规则

所有增强规则以 `md.core.ruler.push(...)` 注册,**顺序由 rule 名称前缀保证可读性**。

### 4.1 `augment_blocks` — 源码行锚点

**这是滚动恢复、TOC 同步、搜索定位、分段渲染的共同基础,优先级最高。**

```ts
md.core.ruler.push('augment_blocks', (state) => {
  for (const token of state.tokens) {
    if (token.level !== 0) continue
    if (!token.map) continue
    if (token.hidden) continue
    const atomic = ['fence', 'code_block', 'hr', 'math_block'].includes(token.type)
    if (token.nesting !== 1 && !atomic) continue
    token.attrSet('data-src-line', String(token.map[0] + 1))  // 1-based
    if (token.map[1] != null) {
      token.attrSet('data-src-end', String(token.map[1]))
    }
  }
})
```

约束:
- 仅标注 `level === 0` 的顶层块,避免 DOM 爆炸。
- 行号 = `token.map[0] + 1`(markdown-it 的 map 是 0-based)。
- `blocks[]` 提取时复用同一份数据,不二次扫描 DOM。
- fence/缩进代码块映射为外层 `pre`，块公式映射为实际的 `p.katex-block`；这些插件 renderer 必须把源码行属性写在真实外层元素上。

### 4.2 `augment_mermaid` — 图表占位

```ts
md.core.ruler.push('augment_mermaid', (state) => {
  let number = 0
  for (const token of state.tokens) {
    if (token.type !== 'fence') continue
    const info = (token.info || '').trim().split(/\s+/)[0]
    if (info !== 'mermaid') continue
    token.type = 'md_mermaid'
    token.tag = 'div'
    token.attrJoin('class', 'md-mermaid')
    token.attrSet('data-mermaid-id', `md-mermaid-${++number}`)
    token.attrSet('data-code', toBase64Utf8(token.content))
  }
})
```

- 使用专用 renderer 输出占位 `div`，不伪装为作者 `html_block`。关闭 Mermaid 时保留转义后的代码块。
- 顶层图表沿用 §4.1 的 1-based 源码行；嵌套图表由父级块承载定位标记。
- **解析期绝不渲染图表**:Mermaid 需 DOM 且开销大,必须延后到主线程 IntersectionObserver。
- 源码用 base64 放在 `data-code`,避免 HTML 属性转义地狱,也便于错误占位时还原源码展示。
- `mermaidCount` 累加进 `ParseResult`,用于调度决策(100 图表场景,NFR-002)。

### 4.3 `augment_unknown_lang`

- 在 Shiki 高亮回调中:捕获 `lang` 未加载 / 加载失败 → 返回 `''`(让 markdown-it 走默认 `<pre><code>` 渲染),并把语言名推入 `unknownLangs`(去重)。
- 状态栏提示:「1 个代码块语言未识别:foo」,点击展开详情。
- **不抛错,不阻塞**。

### 4.4 `augment_external_link`

递归遍历 `state.tokens` 及其 `children`，对 `link_open` 的 `http:` / `https:` / `mailto:` 链接设置 `rel="noopener noreferrer"` 和 `data-md-external="1"`。只遍历顶层 token 无法覆盖正文内的链接。

点击一律在主线程被委托拦截(见 `04-assets-and-links.md`),这里的属性只用于样式与调试。

### 4.5 `augment_lazy_image`

```ts
// image renderer 覆写
const defaultImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  token.attrSet('data-md-image', '1')
  return defaultImage(tokens, idx, options, env, self)
}
```

---

## 5. Worker 契约

文件:`src/ui/src/core/render/contract.ts`(前端唯一真源)

```ts
export interface ParseOptions {
  html: boolean
  math: boolean
  alerts: boolean
  mermaid: boolean
  shikiThemeLight: string
  shikiThemeDark: string
}

export interface ParseRequest {
  jobId: number
  docId: string
  generation: number
  text: string
  opts: ParseOptions
}

export interface TocEntry {
  level: number      // 1..6
  text: string       // 纯文本,已剥离内联标记
  id: string         // slugger 结果
  line: number       // 1-based
}

export interface BlockEntry {
  line: number       // 1-based 起始行
  endLine: number
  tag: string        // h1..h6 / p / ul / ol / blockquote / table / pre / div
}

export interface ParseResult {
  ok: true
  jobId: number
  generation: number
  html: string
  toc: TocEntry[]
  blocks: BlockEntry[]
  mermaidCount: number
  unknownLangs: string[]
  hasRawHtml: boolean
  htmlBytes: number
  parseMs: number
}

export interface ParseFailure {
  ok: false
  jobId: number
  generation: number
  message: string
  stack?: string
  parseMs: number
}

export type ParseResponse = ParseResult | ParseFailure
```

**Worker 内职责边界**

| 做 | 不做 |
|---|---|
| markdown-it 解析 | DOMPurify(需 DOM) |
| Shiki 高亮 | Mermaid(需 DOM) |
| KaTeX 渲染 | 任何 DOM 查询 |
| TOC / blocks 提取 | 图片解码 |
| `hasRawHtml` 判定 | 滚动/搜索索引 |

`hasRawHtml` 在增强规则的第一步递归检查作者 `html_block` / `html_inline`，无需再次解析。任务列表和 Mermaid 使用内部 token，不触发该标记；Alerts 提取到 `meta.title` 的作者 HTML 也必须检查。关闭原始 HTML 时，Alert 自定义标题转义为文本；开启时，含 HTML 的标题要求消毒。所有统计每次 parse 重置。

---

## 6. 高亮器生命周期

```ts
// src/ui/src/workers/highlighter.ts —— Worker 内单例
let highlighterPromise: Promise<Highlighter> | null = null

export function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [THEME_LIGHT, THEME_DARK],
    langs: COMMON_LANGS,
    engine: createOnigurumaEngine(() => import('shiki/wasm')),
  })
  return highlighterPromise
}
```

- 使用 fine-grained bundle(`shiki/core` + `@shikijs/langs/*` + `@shikijs/themes/*`),避免打包全部语言。
- `markdown-it` 本身**不支持异步 highlight 回调**;因此插件必须在 worker 启动时 `await` 初始化完成后才能接收渲染请求。
- 因此 Worker 有明确的生命周期:`spawn → init(await highlighter) → ready → 接收 ParseRequest`。
- 主线程在 `ready` 之前不发请求;若 3 秒未 ready,降级为无高亮模式并提示。

---

## 7. 主线程渲染

```ts
// src/ui/src/reader/renderInto.ts
export function renderInto(el: HTMLElement, res: ParseResult, policy: SanitizePolicy) {
  const html = res.hasRawHtml ? DOMPurify.sanitize(res.html, policy) : res.html
  el.innerHTML = html
}
```

顺序说明:

1. **先消毒再插入**,绝不「先插入再清理」。
2. `innerHTML` 一次性替换,不逐节点插入;避免大量 layout thrashing。
3. 替换后立即:
   - `querySelectorAll('[data-src-line]')` → 建 `Map<number, HTMLElement>`(用于锚点恢复与 TOC 高亮)。
   - `querySelectorAll('.md-mermaid')` → 交给 `MermaidLayer` 的 IntersectionObserver。
   - 绑定一次事件委托到容器(`click` / `keydown`),不逐元素 `addEventListener`。

---

## 8. HTML 消毒策略

文件:`src/ui/src/core/sanitize/policy.ts`

```ts
export const POLICY: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'a','abbr','b','blockquote','br','caption','code','col','colgroup','dd','del','details',
    'div','dl','dt','em','figcaption','figure','h1','h2','h3','h4','h5','h6','hr','i','img',
    'input','kbd','li','mark','ol','p','pre','q','rp','rt','ruby','s','samp','section','small',
    'span','strong','sub','summary','sup','table','tbody','td','tfoot','th','thead','tr','u',
    'ul','var','wbr',
    // KaTeX MathML
    'math','semantics','mrow','mi','mo','mn','ms','mtext','msup','msub','msubsup','mfrac',
    'msqrt','mroot','mover','munder','munderover','mtable','mtr','mtd','mspace','mpadded',
    'mphantom','menclose','mstyle','annotation','annotation-xml',
  ],
  ALLOWED_ATTR: [
    'href','src','alt','title','class','id','colspan','rowspan','align','start','reversed',
    'type','checked','disabled','open','datetime','lang','dir','rel','target',
    // KaTeX 必需
    'style','aria-hidden','encoding','display','mathvariant','stretchy','fence','separator',
    'accent','accentunder','columnalign','rowspacing','columnspacing','scriptlevel',
    // 内部标记
    'data-src-line','data-src-end','data-md-external','data-md-image','data-mermaid-id','data-code',
  ],
  ALLOW_DATA_ATTR: false,          // 上面已显式列出所需 data-*
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_TAGS: ['script','style','iframe','object','embed','form','link','meta','base'],
  FORBID_ATTR: ['onerror','onload','onclick','onmouseover','onfocus','srcdoc','formaction'],
  KEEP_CONTENT: true,
}
```

**关键设计:按需消毒**

- `hasRawHtml === false` → **完全跳过 DOMPurify**。绝大多数技术文档不含原始 HTML,这条路径零成本。
- `hasRawHtml === true` → 整篇消毒。
- KaTeX 输出即便来自 `$...$` 也会带入 `style` 与 MathML;白名单已放行,**必须**用 `fixtures/extended.md` 的公式区做回归,防止升级 DOMPurify 后公式被削平。
- Mermaid 输出 SVG 在主线程二次插入前,同样经 `DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })`。

---

## 9. 失败与降级矩阵

| 失败点 | 表现 | 恢复 |
|---|---|---|
| markdown-it 抛异常 | Worker 返回 `ParseFailure` → 主线程显示 `<pre>` 源码视图 + 错误条 | 用户可「重试渲染」 |
| 插件初始化失败 | 该插件被跳过,记 warning,其余功能正常 | 状态栏提示「公式/图表不可用」 |
| Shiki 初始化超时(>3s) | 无高亮模式,代码块纯文本 | 后台继续初始化,完成后下次渲染生效 |
| 单个语言加载失败 | 该代码块纯文本 + `unknownLangs` | 自动重试一次 |
| KaTeX 单公式错误 | 该公式显示红色原文(`throwOnError:false`) | 无 |
| Mermaid 单图错误 | 占位卡片 + 可展开源码 + 错误信息 | 「重试」按钮 |
| 消毒后 HTML 为空 | 视为异常,回退到未消毒前的「纯文本安全视图」 | 记录日志 |

---

## 10. 待实测项（已部分关闭）

### 10.1 已关闭（T05，2026-10-29）

| 项 | 结论 | 证据 |
|---|---|---|
| 第三方插件与 markdown-it@15 兼容性 | ✅ **全部可用**，无需回退 14.3.3 | `findings-plugin-compat.md` §1 |
| 中文标题 id 稳定性 | ✅ 自研 anchors.ts 已解决，且无跨渲染漂移 | `markdown-core.spec.ts`「标题锚点 id 稳定性」 |
| `commonmark` preset 的 GFM 能力 | ❌ 不支持 table/strike/linkify → 改用 `default` | `findings-plugin-compat.md` §2.6 |
| Shiki 未知语言中断渲染 | ✅ 自接管 fence 渲染已解决 | `fixtures-render.spec.ts`「未知语言不中断」 |
| katex 版本冲突 | ✅ 锁定 0.16.47 | `findings-plugin-compat.md` §2.4 |
| 中文锚点百分号编码 | ✅ 已记录，前端需 decodeURIComponent | `14-link-navigation.md` §3.3 |

### 10.2 仍待实测

| 项 | 验证方式 | 失败时的退路 |
|---|---|---|
| KaTeX 输出能否通过 DOMPurify 白名单 | `fixtures/extended.md` 公式区断言 `.katex` 数量 > 0（T25） | 扩充 `ALLOWED_ATTR` |
| Shiki 双主题 CSS 变量在 WebView2 156 正确 | 视觉回归截图（T32） | 改为单主题 + 重解析 |
| Mermaid 12.2 在 WebView2 156 的渲染与 `securityLevel:'strict'` | 渲染 6 类图表（T11） | 锁 `mermaid@11.x` |
| Shiki WASM 引擎是否需要 CSP `'wasm-unsafe-eval'` | T09 起 Tauri 后实测 | 改用 `createJavaScriptRegexEngine` |
