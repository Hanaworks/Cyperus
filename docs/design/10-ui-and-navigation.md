# 10 — 界面布局、导航、搜索与快捷键

> 覆盖 FR-010 / FR-012(P1) / FR-021(P0) / UC-03 / UC-07 / UC-10 / AC-06 / AC-08 / AC-20..22。
> 代码落点:`src/ui/src/App.vue`、`src/ui/src/app/**`、`src/ui/src/reader/**`、`src/ui/src/core/ipc/workspaceBridge.ts`。
>
> **标签栏与链接跳转有独立规格,本文不再重复:**
> - 多标签界面:**`13-tabs.md`**(FR-020,AC-16..19)
> - 链接点击跳转:**`14-link-navigation.md`**(FR-019,AC-13..15)
> 2026-11-04：按用户确认的 VS Code 式阅读工作台更新；[15-reader-workbench.md](./15-reader-workbench.md) 覆盖旧版“不做文件树”的限制。当前实现与待完成规格见 [UX 执行记录](../dev/ux-workbench-progress.md)，本文中标注后续的交互不代表已交付。
> 2026-11-05：用户明确要求按照 VS Code 界面重做结构；此前蓝灰圆角卡片方案已被否定，仅作历史记录。以下布局以本轮连续、平面的工作台结构为准。

---

## 1. 布局

```text
┌───────────────────────────────────────────────────────────────────┐
│ ▣ 文件 查看 帮助       文档名 — Markdown 预览           ─  □  × │ 30px
├──────┬─────────────────┬──────────────────────────────────────────┤
│ 文件 │ 资源管理器      │ [a.md ×][b.md ×] … [+]                   │ 35px
│ 搜索 │ ▾ 打开的编辑器  ├──────────────────────────────────────────┤
│ 大纲 │   a.md / b.md   │                                          │
│      │ ▾ 当前根目录    │                                          │
│      │   按需展开树    │ ReaderView                               │
│      │                 │   <article class="md-doc">               │
│      │ 或搜索 / 大纲   │     平面渲染正文                         │
│      │                 │   </article>                             │
│      │ 默认 240px      │                                          │
│ 48px │ 可收起与调宽    │                                          │
├──────┴─────────────────┴──────────────────────────────────────────┤
│ ⓘ 文档路径       章节数 · 文档数量 · 编码 · 界面主题 · 正文主题   │ 22px
└───────────────────────────────────────────────────────────────────┘
```

- 按2026-11-06用户最新截图，顶部改为30 px单行：左侧图标和文件 / 查看 / 帮助菜单，中间文档 / 应用标题，右侧真实的最小化 / 最大化 / 关闭窗口控制，不设置顶部搜索入口。菜单与按钮不设拖动标记，标题和空白保留拖动与双击区域，原生实操验收边界见执行记录。下拉菜单采用直角、260 px最小宽、26 px行高与整行选中。打开文件与打开文件夹进入文件菜单，查看中的搜索及 Ctrl+F 打开左侧正文搜索。
- 最左活动栏宽48 px，按钮48×48 px、图标24 px，外边距0，专用浅色前景与焦点；文件/搜索/大纲同级。侧栏一次显示一个面板，再次点击当前入口可收起；大纲不嵌在文件树底部。
- 文件面板顶部为35 px的“资源管理器”标题，下方分为可折叠的“打开的编辑器”与当前根目录分组；列表复用标签会话。按2026-11-06 [设计基线](./16-ui-design-draft.md) 的历史版边距修订，树、分组、编辑器行高22 px、标题左20右8 px、每级缩进16 px，选中态覆盖整行。
- 文件面板显示用户选择的真实根目录，逐层展开时才读取子目录；Markdown 可点击打开，非支持文件置灰。提供空目录、不可访问、加载中、截断与重试提示。
- 目录浏览只读，不要求创建项目或配置工作区；切换面板保留目录展开状态，更换根目录保留已打开标签。枚举权限与正文图片 asset 授权分离。
- 侧栏默认 240 px，可拖拽或用分隔条方向键调宽，范围 180–480 px，并受可用阅读区宽度约束。侧栏宽度和面板的跨启动持久化、窄窗自动抽屉仍为后续规格。
- 35 px 标签栏位于阅读区顶部，标签直角连续排列，下方直接接正文。文件树点击与多文件选择均进入同一标签会话；切换缓存文档不重新解析，每标签保存会话内滚动位置。
- 正文为平面预览，基础字号15 px、行高24 px，左右26 px、上16下28 px，640宽时左右20下24 px；普通块间距16 px，代码/引用/提示/折叠/图表内边距12×16 px。一级/二级/三级标题28/22/18 px，代码13/21 px。底部状态栏22 px，界面和正文默认浅色，白色为主、紫色强调。
- 当前文档路径、未打开文件夹提示、加载状态、编码、章节与文档数统一放在底部状态栏。界面 / 正文主题直接通过底部常驻下拉切换，仍相互独立并保留纸张主题；环境信息可从状态栏信息按钮或帮助菜单打开，浮层从底部向上展开。
- 环境入口位于底部最左；长路径先省略目录，再省略超长文件名。侧栏键盘、指针与窗口缩小时共用180–min(480,窗口宽−340)约束。关闭活动或含焦点的标签项后交回活动标签，最后关闭后聚焦开始页打开入口；非活动项中键关闭保留阅读焦点。搜索重入选中原关键词，Escape将焦点交给可滚动阅读容器并保留关键词。
- 2026-11-06按用户确认的历史版参考统一边距：深灰活动栏、浅灰侧栏、白色内容与整条紫色状态栏。工作区外边距0、面板直角无阴影，侧栏边界1 px；侧栏标题与标签栏上下边界对齐，底栏文字12 px、控件水平内边距6 px，弹层使用中性表面。
- Git 为后续：仓库状态、变更列表、差异查看；提交与同步范围待定。本轮不显示无效 Git 入口。

### 1.1 空状态

无打开文档时,阅读区显示:

```text
        Markdown 本地预览

   [ 打开文件(Ctrl+O)] [ 打开文件夹(Ctrl+Shift+O)]

   从文件夹浏览文档，在标签间切换，继续阅读。
```

当前空状态提供文件和文件夹入口；“最近文件”列表、跨会话恢复属于 T33 / 完整 T24c 的后续范围。

---

## 2. 组件树

```text
App.vue
├── WorkbenchTitlebar.vue       独立标题栏 / 第二行菜单 / 原生窗口控制
├── ActivityBar.vue             文件 / 搜索 / 大纲
├── workbench-sidebar           用 v-show 保留面板会话状态
│   ├── ExplorerPanel.vue       打开的编辑器 / 懒枚举文件树，注入 WorkspaceBridge
│   ├── SearchPanel.vue         当前正文查询、计数与导航
│   └── Sidebar.vue             独立大纲，取活动标签的 toc
├── sidebar-resizer             指针与键盘调宽
├── reading-area
│   ├── DocumentTabs.vue        基础标签、关闭、横向滚动与键盘导航
│   ├── ReaderView.vue          唯一活动阅读 DOM、资源、搜索与位置恢复
│   └── 空状态 / 加载 / 错误提示
└── WorkbenchStatusbar.vue      文档路径 / 状态 / 双主题 / 环境信息
```

- 多文档数据由框架无关的 `core/documents/session.ts` 统一持有；`DocumentTabs.vue` 通过 props / events 操作，不建立第二份文档状态。完整重排 / 右键 / 恢复规格见 `13-tabs.md`，尚未全部实现。
- `ReaderView.vue` 的正文根元素持 `data-md-theme` 与 `innerHTML`,不把 Markdown 内容变成子组件(禁止在渲染路径上创建大量 Vue 组件)。
- Mermaid 卡片是先由 innerHTML 生成的占位 `<div>`,再由 `MermaidCard` 通过 `Teleport` 或直接 DOM 操作填充 SVG。选择**直接 DOM 操作**(避免每个图表一个 Vue 实例)。
- 链接点击设计为在 `ReaderView.vue` 容器上统一事件委托(见 `14-link-navigation.md` §3.1)，完整链接分流仍由 T24b 跟踪。

---

## 3. 大纲(TOC)

这里的“大纲”指当前文档标题导航，与浏览磁盘目录的“文件”面板分开；两者在活动栏同级。

### 3.1 数据来源

Worker 返回的 `toc: TocEntry[]`,无需二次扫 DOM。

```ts
interface TocEntry { level: number; text: string; id: string; line: number }
```

### 3.2 树化

```ts
export function buildTocTree(flat: TocEntry[]): TocNode[] {
  const root: TocNode[] = []
  const stack: TocNode[] = []
  for (const e of flat) {
    const node: TocNode = { ...e, children: [] }
    while (stack.length && stack[stack.length - 1].level >= e.level) stack.pop()
    ;(stack.length ? stack[stack.length - 1].children : root).push(node)
    stack.push(node)
  }
  return root
}
```

- 遇到跳跃层级(h1 → h3)按「父节点为上一条更低层级」处理,不补空节点。
- 标题深度 > 4 时,侧栏默认折叠到 3 级。

### 3.3 滚动高亮

```ts
const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter(e => e.isIntersecting)
  if (!visible.length) return
  activeId = visible[0].target.id
}, { root: scrollContainer, rootMargin: '-10% 0px -75% 0px', threshold: 0 })
```

- 观察所有 `[id]` 的标题元素。
- `rootMargin` 保证「顶部 10% 到 25% 区间内的第一个标题」被激活。
- 用户点击 TOC 后 300 ms 内暂停 observer 更新(避免平滑滚动过程中的闪跳)。

### 3.4 点击跳转

```ts
el.scrollIntoView({ block: 'start', behavior: preferReducedMotion ? 'auto' : 'smooth' })
```
并给目标加 `.md-anchor-flash` 类,1.2 s 后移除。

---

## 4. 正文搜索

### 4.1 主路径:CSS Custom Highlight API

```ts
const ranges: Range[] = []
const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
// …为每个匹配创建 Range
const hl = new Highlight(...ranges)
CSS.highlights.set('md-search', hl)
CSS.highlights.set('md-search-active', new Highlight(<当前一项的 Range>))
```

CSS:

```css
::highlight(md-search) { background-color: var(--md-mark-bg); }
::highlight(md-search-active) { background-color: #ffb703; color: #000; }
```

优点:**完全不修改 DOM**,因此不需要保存/还原原始 HTML,也不会与 Mermaid/KaTeX 内部节点冲突(它们在 DOM 中不可编辑)。

### 4.2 降级路径

若 `CSS.highlights` 不存在:

```ts
// 用 <mark> 包裹文本节点,并记录 [originalTextNode, parent, index]
const marks: Array<{ node: Text; parent: Node; index: number }> = []
```

当前实现的降级路径仅包裹命中的文本片段；关闭或更新搜索、替换活动文档时撤销 `<mark>`、归并文本节点并清除旧 Range，不改写公式与 SVG 结构。

### 4.3 搜索行为

| 项 | 设计 |
|---|---|
| 触发 | `Ctrl+F` 打开搜索面板并聚焦输入框 |
| 去抖 | 150 ms 为后续目标，当前随查询更新 |
| 匹配 | 当前为大小写不敏感的字面匹配；`Aa` / 全词选项后续 |
| 范围 | 当前活动 `.md-doc` 正文文本，包含代码块和跨行内节点匹配；跳过脚本、样式、SVG、Mermaid、KaTeX 及显式隐藏内容 |
| 计数 | 「第 3 / 共 17」 |
| 导航 | 已有按钮与 `Enter` / `Shift+Enter`；`Esc` 关闭为后续 |
| 上限 | 2000 个匹配与超出提示为后续保护规格，当前尚未接入 |
| 性能 | 10 MB 文档搜索目标 < 300 ms(需实测) |

### 4.4 与滚动位置的关系

- 搜索跳转到匹配项 → 记住搜索前的位置 → `Esc` 关闭时**不**回跳(用户期望停在当前位置)。
- 搜索面板打开时,滚动位置捕获仍然工作(便于用户切标签后回来继续搜索)。
- 2026-11-07：每标签独立保存查询和当前匹配序号，切换时重建高亮但保留阅读位置；离开搜索面板只清理高亮，重新打开恢复原匹配。完整搜索选项和跨启动恢复仍后续。

---

## 5. 快捷键

| 快捷键 | 动作 |
|---|---|
| `Ctrl+O` | 打开文件 |
| `Ctrl+Shift+O` | 打开文件夹 |
| `Ctrl+Shift+E` | 显示文件面板 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Shift+T` | 恢复最近关闭的标签 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下/上一个标签 |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 同上(备用) |
| `Ctrl+1..8` | 跳到第 N 个标签 |
| `Ctrl+9` | 跳到最后一个标签 |
| `Ctrl+F` | 搜索 |
| `F3` / `Shift+F3` | 下一个/上一个匹配 |
| `Ctrl+T` | 显示/隐藏大纲（后续） |
| `Ctrl+B` | 显示/隐藏侧栏 |
| `Ctrl+=` / `Ctrl+-` | 正文字号 ± |
| `Ctrl+0` | 重置正文字号 |
| `Ctrl+Shift+=/-` | 应用缩放 |
| `Ctrl+R` | 强制重新载入当前文档 |
| `Ctrl+Shift+C` | 复制文件路径 |
| `F11` | 全屏 |
| `Esc` | 关闭搜索/设置/退出全屏 |

已接入 `Ctrl+O` / `Ctrl+Shift+O` / `Ctrl+Shift+E` / `Ctrl+W` / `Ctrl+Shift+T` / `Ctrl+Tab` / `Ctrl+Shift+Tab` / `Ctrl+1..9` / `Ctrl+F` / `Ctrl+B`；标签内方向键、Home/End 和 Delete 也可操作。恢复关闭仅限当前会话的路径文档，最多15条，文件菜单提供同一入口；浏览器临时正文不保留关闭副本。表内其余快捷键是后续完整规格。

链接相关的修饰键(完整 T24b 规格，不属于全局快捷键,由正文委托处理):

| 组合 | 动作 |
|---|---|
| `Ctrl` + 点击本地 Markdown 链接 | 后台新标签(不激活) |
| 中键点击本地 Markdown 链接 | 后台新标签(不激活) |
| `Tab` / `Shift+Tab` | 在正文链接间移动焦点 |
| `Enter`(焦点在链接上) | 激活链接 |

冲突处理:

- 在 `<input>`/`<textarea>` 聚焦时,除 `Esc` 与 `F3` 外全部让位给输入框。
- 当前全局快捷键在 `App.vue`；后续 T45 统一到 `src/ui/src/app/shortcuts.ts` 并完善输入框冲突处理和自定义。

---

## 6. 状态栏

当前22 px状态栏左侧提供环境信息与文档路径，右侧提供章节数、文档数、编码和独立双主题切换；帮助菜单可进入同一环境弹层。以下同步 / 图表错误 / 资源详情仍为后续目标，真实watcher尚未接入。

```text
[编码 UTF-8] [已同步 / 已变更] [12 标题] [3 图表] [1240 行] [Mermaid 已阻止 2]
```

| 段 | 内容 | 点击行为 |
|---|---|---|
| 编码 | `DocMeta.encoding` 大写 | 弹编码详情(不可改,首版) |
| 同步 | `已同步`(绿)/ `外部已修改`(黄)/ `文件已移除`(红)/ `读取失败`(红) | 强制重载 |
| 标题数 | TOC 条目数 | 打开目录 |
| 图表数 | `mermaidCount`;有失败时 `3 图表 (1 失败)` | 定位第一个失败块 |
| 行数 | `blocks` 最后一行 | — |
| 提示 | 未知语言 / 阻止的远程图片 / 阻止的链接 | 展开详情 |

---

## 7. 图表与图片增强(FR-012,P1)

首版可先不做,但预留结构:

```text
点击 Mermaid/图片
  → 打开 Lightbox(同窗口覆盖层,不新开窗)
  → 滚轮缩放(0.25x–8x)、拖拽平移、双击复位
  → Esc / 点击背景关闭
  → 右下角 [适应窗口][1:1][在新窗口打开(图片)]
```

实现要点:

- Lightbox 用 `<dialog>` + `showModal()`,天然获得焦点陷阱与 `Esc` 语义。
- 缩放用 `transform: scale()`,不改变布局。
- 图表 SVG 通过 `cloneNode(true)` 复制进 Lightbox,与正文互不影响。

---

## 8. 无障碍

| 项 | 要求 |
|---|---|
| 语义 | 正文用 `<article>`,标题层级来自 Markdown 原文,不自造 |
| 焦点 | 所有交互元素可 Tab 达;`dialog` 用原生 `<dialog>` |
| 键盘 | 见 §5;TOC 支持方向键导航 |
| 对比度 | 正文 ≥ 7:1,次要文字 ≥ 4.5:1 |
| 动效 | 尊重 `prefers-reduced-motion`,关闭平滑滚动与闪烁 |
| 图表 | Mermaid SVG 输出带 `aria-label`(取图表标题或代码首行) |
| 图片 | 无 `alt` 时提示(开发期 warning),不自动生成文件名 alt |

---

## 9. 拖放

```ts
const unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
  if (event.payload.type === 'drop') {
    void openPaths(event.payload.paths.filter(isMarkdownPath))
  }
})
// 卸载时调用 unlisten，实际接入位于 App.vue。
```

- 只接受 `.md/.markdown/.mdown/.mkd`。
- 当前过滤非 Markdown 文件、不尝试打开；全为非支持文件时的专门提示属于后续反馈完善。
- 拖入多个文件 → 按顺序打开标签,激活第一个。

> 当前原生已使用 Tauri `onDragDropEvent` 提供真实路径，不依赖 WebView 的 `File.path`；浏览器 mock 通过多文件选择读取文本进入同一会话。

---

## 10. 待实测项

| 项 | 验证 |
|---|---|
| `CSS.highlights` 在 WebView2 156 的支持 | 功能探测 + E2E |
| 10 MB 文档搜索耗时 | 基准 |
| 原生多文件拖入的顺序与过滤 | 原生功能复验 |
| `<dialog>` 在 WebView2 的 `::backdrop` 样式 | 截图 |
| 150%/200% DPI 下 22px 状态栏与 35px 标签栏的可用性 | 手工 |
