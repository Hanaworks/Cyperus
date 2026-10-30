# 10 — 界面布局、导航、搜索与快捷键

> 覆盖 FR-010 / FR-012(P1)/ UC-03 / UC-07 / AC-06 / AC-08。
> 代码落点:`src/ui/src/app/**`、`src/ui/src/reader/**`、`src/ui/src/core/search/**`。
>
> **标签栏与链接跳转有独立规格,本文不再重复:**
> - 多标签界面:**`13-tabs.md`**(FR-020,AC-16..19)
> - 链接点击跳转:**`14-link-navigation.md`**(FR-019,AC-13..15)
> 本文的布局图与快捷键表已按标签栏形态更新。

---

## 1. 布局

```text
┌──────────────────────────────────────────────────────────────┐
│ TitleBar  [☰] a.md — Markdown 预览            [⚙] [—][□][×]  │ 36px
├──────────────────────────────────────────────────────────────┤
│ TabBar    [a.md ×][b.md ● ×][+ ………………………………][🔍]           │ 36px
├───────────────┬──────────────────────────────────────────────┤
│ Sidebar       │ ReaderView                                   │
│  ┌─────────┐  │  ┌────────────────────────────────────────┐  │
│  │ 目录 ▾  │  │  │  <article class="md-doc">              │  │
│  │  H1     │  │  │    正文                                 │  │
│  │   H2    │  │  │  </article>                            │  │
│  │   H3    │  │  └────────────────────────────────────────┘  │
│  └─────────┘  │                                              │
│  (260px,可折叠)│                                              │
├───────────────┴──────────────────────────────────────────────┤
│ StatusBar  UTF-8 · 已同步 · 12 个标题 · 3 个图表 · 1240 行    │ 24px
└──────────────────────────────────────────────────────────────┘
```

- **不做**侧栏文件树/工作区(违背产品定位 §1.2)。
- 侧栏只有两种内容:目录(TOC)、搜索面板。二者互斥,同时只显示一个。
- 侧栏可拖拽宽度(200–480 px),状态持久化。
- `< 900px` 宽度时侧栏自动折叠为抽屉。

### 1.1 空状态

无打开文档时,阅读区显示:

```text
        Markdown 本地预览

   [ 打开文件(Ctrl+O)]

   最近
   · D:\docs\a.md
   · D:\docs\b.md
```

最近列表来自 `settings.recent`(上限 20),不存在的路径置灰并标注「文件不存在」。

---

## 2. 组件树

```text
App.vue
├── TitleBar.vue
│   ├── AppMenuButton.vue       (仅紧凑模式)
│   └── WindowControls.vue      (仅 macOS 需要自绘;Windows 用系统装饰)
├── TabBar.vue                  ← 规格见 13-tabs.md
│   ├── TabItem.vue             (标题/状态图标/关闭按钮/拖拽源)
│   ├── TabOverflowList.vue     (超出时下拉,带过滤)
│   └── TabContextMenu.vue      (关闭其他/右侧/全部/重排/恢复最近关闭)
├── Body
│   ├── Sidebar.vue
│   │   ├── TocPanel.vue
│   │   │   └── TocNode.vue     (递归)
│   │   └── SearchPanel.vue
│   ├── SidebarResizer.vue
│   └── MainPane.vue
│       ├── ReaderView.vue
│       │   ├── DocumentBody.vue  (innerHTML 容器,链接委托在此层之下)
│       │   ├── ImagePlaceholder.vue
│       │   ├── MermaidCard.vue
│       │   └── SearchOverlayHud.vue
│       ├── EmptyState.vue
│       └── ErrorBanner.vue
└── StatusBar.vue
```

- `DocumentBody.vue` 的根元素持 `data-md-theme` 与 `innerHTML`,不把 Markdown 内容变成子组件(禁止在渲染路径上创建大量 Vue 组件)。
- Mermaid 卡片是先由 innerHTML 生成的占位 `<div>`,再由 `MermaidCard` 通过 `Teleport` 或直接 DOM 操作填充 SVG。选择**直接 DOM 操作**(避免每个图表一个 Vue 实例)。
- 链接点击**不在 `DocumentBody.vue` 内部逐元素绑定**,而是在 `ReaderView.vue` 的容器上做一次事件委托(见 `14-link-navigation.md` §3.1),因此组件树中无「Link」子组件。

---

## 3. 目录(TOC)

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

关闭搜索时按记录**逆序还原**;还原失败则重新渲染当前文档 HTML(保底,代价是一次 innerHTML)。

### 4.3 搜索行为

| 项 | 设计 |
|---|---|
| 触发 | `Ctrl+F` 打开搜索面板并聚焦输入框 |
| 去抖 | 150 ms |
| 匹配 | 大小写不敏感;`Aa` 按钮切换;支持全词(可选,Phase 3) |
| 范围 | 仅 `.md-doc` 内文本节点,跳过 `<script>`/`<style>`/`<pre>` 内的?**包含代码块**,跳过隐藏节点(`display:none`) |
| 计数 | 「第 3 / 共 17」 |
| 导航 | `Enter` 下一个,`Shift+Enter` 上一个,`Esc` 关闭并清除高亮 |
| 上限 | 2000 个匹配(超出提示「结果过多,仅显示前 2000 个」),防止卡死 |
| 性能 | 10 MB 文档搜索目标 < 300 ms(需实测) |

### 4.4 与滚动位置的关系

- 搜索跳转到匹配项 → 记住搜索前的位置 → `Esc` 关闭时**不**回跳(用户期望停在当前位置)。
- 搜索面板打开时,滚动位置捕获仍然工作(便于用户切标签后回来继续搜索)。

---

## 5. 快捷键

| 快捷键 | 动作 |
|---|---|
| `Ctrl+O` | 打开文件 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Shift+T` | 恢复最近关闭的标签 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下/上一个标签 |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 同上(备用) |
| `Ctrl+1..8` | 跳到第 N 个标签 |
| `Ctrl+9` | 跳到最后一个标签 |
| `Ctrl+F` | 搜索 |
| `F3` / `Shift+F3` | 下一个/上一个匹配 |
| `Ctrl+T` | 显示/隐藏目录 |
| `Ctrl+B` | 显示/隐藏侧栏 |
| `Ctrl+=` / `Ctrl+-` | 正文字号 ± |
| `Ctrl+0` | 重置正文字号 |
| `Ctrl+Shift+=/-` | 应用缩放 |
| `Ctrl+R` | 强制重新载入当前文档 |
| `Ctrl+Shift+C` | 复制文件路径 |
| `F11` | 全屏 |
| `Esc` | 关闭搜索/设置/退出全屏 |

链接相关的修饰键(不属于全局快捷键,由正文委托处理):

| 组合 | 动作 |
|---|---|
| `Ctrl` + 点击本地 Markdown 链接 | 后台新标签(不激活) |
| 中键点击本地 Markdown 链接 | 后台新标签(不激活) |
| `Tab` / `Shift+Tab` | 在正文链接间移动焦点 |
| `Enter`(焦点在链接上) | 激活链接 |

冲突处理:

- 在 `<input>`/`<textarea>` 聚焦时,除 `Esc` 与 `F3` 外全部让位给输入框。
- 全部快捷键集中定义在 `src/ui/src/app/shortcuts.ts`,便于将来支持自定义。

---

## 6. 状态栏

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
window.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy' })
window.addEventListener('drop', async e => {
  e.preventDefault()
  const paths = Array.from(e.dataTransfer!.files).map(f => (f as any).path as string)
  await openMany(paths.filter(isMarkdownPath))
})
```

- 只接受 `.md/.markdown/.mdown/.mkd`。
- 非 Markdown 文件拖入 → toast 提示「仅支持 Markdown 文件」,不尝试打开。
- 拖入多个文件 → 按顺序打开标签,激活第一个。

> WebView2 中 `File.path` 可用性需实测;若不可用,改用 Tauri 的 `onDragDropEvent`(Rust 侧提供拖放路径)。

---

## 10. 待实测项

| 项 | 验证 |
|---|---|
| `CSS.highlights` 在 WebView2 156 的支持 | 功能探测 + E2E |
| 10 MB 文档搜索耗时 | 基准 |
| WebView2 中 `dataTransfer.files[].path` | 手工 |
| `<dialog>` 在 WebView2 的 `::backdrop` 样式 | 截图 |
| 150%/200% DPI 下 24px 状态栏与 36px 标签栏的可用性 | 手工 |
