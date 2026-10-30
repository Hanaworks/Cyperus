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
  return new MarkdownIt('commonmark', {
    html: true,          // 原始 HTML 放行,由 DOMPurify 按需消毒(见 ADR / 06)
    xhtmlOut: false,
    breaks: false,       // 不做「单换行=硬换行」,保持 CommonMark 语义
    langPrefix: 'language-',
    linkify: true,
    typographer: false,  // 关闭智能引号,避免破坏中文排版与代码片段
    quotes: '“”‘’',
    maxNesting: 100,
  })
}
```

**为什么 `typographer: false`**:智能引号会把 `'` `"` 替换成弯引号,在中文技术文档里会破坏代码片段与 CJK 标点混排;GitHub 本身也不做 typographer 替换。

**`breaks` 决策**:保持 `false`。需求文档 AC 未要求 Slack 式换行;若后续用户反馈强烈,作为设置项加入,而非改默认。

---

## 3. 插件链

### 3.1 装配顺序(顺序不可随意调整)

```ts
md.use(footnote)                       // 1. 脚注:先建立 footnote 引用解析
md.use(anchor, { slugify, permalink }) // 2. 锚点:依赖 heading_open token
md.use(githubAlerts)                   // 3. Alerts:blockquote 变换
md.use(katexPlugin, { katex, throwOnError: false, errorColor: '#cc0000' }) // 4. 数学
md.use(await shikiPlugin({ themes: { light, dark } }))                     // 5. 高亮
md.use(taskListPlugin)                 // 6. 自研任务列表
```

### 3.2 各插件细节

#### 脚注 — `markdown-it-footnote@4.0.0`

- 产出 `<sup class="footnote-ref">` / `<section class="footnotes">`。
- 需在 CSS 中提供 `.footnotes` 样式(Markdown Theme 内)。
- 回链锚点依赖 `markdown-it-anchor` 的 id 规则,**两者 slugify 必须同源**。

#### 锚点 — `markdown-it-anchor@10.0.0` + `github-slugger@2.0.0`

```ts
import GithubSlugger from 'github-slugger'

function slugify(text: string): string {
  // 每次渲染新建 slugger,保证同一文档内去重一致
  return new GithubSlugger().slug(text)
}
```

- **CJK 支持必须验证**:`github-slugger` 保留 Unicode 字母,中文标题会生成中文 id。需在 `fixtures/cjk-typography.md` 中覆盖:
  - 纯中文标题
  - 中英混排标题
  - 含标点/全角符号标题
  - 重复标题(依赖 slugger 的 `-1`/`-2` 后缀)
- 若 slugger 行为不符合预期,改用自研 slug:去空白 → 保留 `[\p{L}\p{N}_-]` → 小写 → 冲突加后缀。

#### GitHub Alerts — `markdown-it-github-alerts@1.0.1`

- 语法:`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`
- 输出容器带 `markdown-alert markdown-alert-<type>` 类。
- 需随包引入其 `styles/*` 并在 Markdown Theme 中做深浅色适配。

#### 数学 — `@vscode/markdown-it-katex@1.1.2` + `katex@0.19.1`

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
- 未预载语言:先以 `<pre><code>` 纯文本输出并记 `unknownLangs`,同时异步 `highlighter.loadLanguage(lang)`;下次渲染该语言即生效。
- Shiki 高亮器是 **Worker 内长生命周期单例**,不得在渲染函数内反复创建。

#### 任务列表 — 自研 `rules/taskList.ts`

不引入 `markdown-it-task-lists@2.1.1`(2022-06 后无维护)。自研规则要点:

1. 在 `block` ruler 的 `list` 之后插入规则,遍历 `list_item_open` 后面的第一个 `inline` token。
2. 匹配行首 `[ ]` / `[x]` / `[X]`(后接空白),剥离这 3~4 个字符并重写 `token.content`。
3. 给 `list_item_open` 加 `class="task-list-item"`,给父 `bullet_list_open` 加 `class="contains-task-list"`。
4. 在该 inline token 前插入一个 `html_inline` token:`<input type="checkbox" class="task-list-checkbox" disabled checked?>`。
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
    if (!token.nesting) continue           // 只要 open token
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

### 4.2 `augment_mermaid` — 图表占位

```ts
md.core.ruler.push('augment_mermaid', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'fence') continue
    const info = (token.info || '').trim().split(/\s+/)[0]
    if (info !== 'mermaid') continue
    token.type = 'html_block'
    token.content =
      `<div class="md-mermaid" data-mermaid-id="${id}" ` +
      `data-src-line="${token.map?.[0] ?? 0}" ` +
      `data-code="${escapeAttr(toBase64(token.content))}"></div>`
  }
})
```

- **解析期绝不渲染图表**:Mermaid 需 DOM 且开销大,必须延后到主线程 IntersectionObserver。
- 源码用 base64 放在 `data-code`,避免 HTML 属性转义地狱,也便于错误占位时还原源码展示。
- `mermaidCount` 累加进 `ParseResult`,用于调度决策(100 图表场景,NFR-002)。

### 4.3 `augment_unknown_lang`

- 在 Shiki 高亮回调中:捕获 `lang` 未加载 / 加载失败 → 返回 `''`(让 markdown-it 走默认 `<pre><code>` 渲染),并把语言名推入 `unknownLangs`(去重)。
- 状态栏提示:「1 个代码块语言未识别:foo」,点击展开详情。
- **不抛错,不阻塞**。

### 4.4 `augment_external_link`

```ts
md.core.ruler.push('augment_external_link', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'link_open') continue
    const href = token.attrGet('href') ?? ''
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      token.attrSet('rel', 'noopener noreferrer')
      token.attrSet('data-md-external', '1')
    }
  }
})
```

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

`hasRawHtml` 的判定:

```ts
const hasRawHtml = md.parse(text, env).some(
  t => t.type === 'html_block' || t.type === 'html_inline'
)
```
为避免重复解析,实际实现放在 `core.ruler` 的最后一个规则里累加到 `state.env.hasRawHtml`,一次遍历完成。

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

## 10. 待实测项(必须在 M0 关闭)

| 项 | 验证方式 | 失败时的退路 |
|---|---|---|
| `markdown-it-anchor@10` / `footnote@4` / `alerts@1` / `@shikijs/markdown-it@4.5` 与 `markdown-it@15` 兼容性 | 任务 6:逐个 `.use()` + 渲染夹具断言 | 锁定 `markdown-it@14.3.3` |
| `github-slugger` 的中文 id 是否稳定、是否与页内链接匹配 | `fixtures/cjk-typography.md` golden 快照 | 换自研 slug |
| KaTeX 输出是否能通过 DOMPurify 白名单 | `fixtures/extended.md` 公式区断言 `document.querySelectorAll('.katex').length > 0` | 扩充 `ALLOWED_ATTR` |
| Shiki 双主题 CSS 变量在 WebView2 156 上正确 | 视觉回归截图 | 改为 `defaultColor` 单主题 + 重解析 |
| Mermaid 12.2 在 WebView2 156 的渲染与 `securityLevel:'strict'` 行为 | 渲染 6 类图表 | 锁 `mermaid@11.x` |
