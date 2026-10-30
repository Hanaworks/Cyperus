# 05 — 双主题系统

> 覆盖 FR-009 / FR-013(P1)/ UC-05 / AC-07 / 需求文档 §3.2。
> 代码落点:`src/ui/src/core/theme/**`、`src/ui/src/styles/**`、`src/ui/src/stores/settings.ts`。

---

## 1. 两套主题的边界(重申,防止实现时混)

| | App Theme | Markdown Theme |
|---|---|---|
| 控制对象 | 标题栏、工具栏、标签栏、侧栏、状态栏、设置、弹窗、滚动条 | 正文背景、标题、段落、列表、引用、表格、代码、公式、图表 |
| 挂载点 | `<html data-app-theme="dark">` | `<article class="md-doc" data-md-theme="paper">` |
| CSS 变量前缀 | `--app-*` | `--md-*` |
| 变量定义位置 | `:root[data-app-theme=…]` | `.md-doc[data-md-theme=…]` |
| 能否影响对方 | **不能** | **不能** |

**可自由组合**:深色外壳 + 浅色纸张正文(典型夜间阅读需求)。

---

## 2. 隔离方案(重要决策)

### 2.1 候选

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. Shadow DOM | 最强隔离 | KaTeX/Mermaid/Shiki 的 `<style>` 注入、`document.querySelector`、`Range`(搜索高亮)、`scrollIntoView` 全部要改造;WebView 差异 |
| B. 严格命名空间 + CSS 重置 | 零改造,搜索/滚动/KaTeX 全兼容 | 依赖纪律,需测试兜底 |
| C. iframe | 最强隔离 | 通信复杂、滚动同步困难、性能开销 |

### 2.2 决策:**B(命名空间)**

理由:

1. 搜索高亮使用 `CSS Custom Highlight API`,其 `Range` 服务于 Document,Shadow DOM 内元素产生的 Range 需额外处理。
2. Mermaid 需要在 `document.body` 之外的容器里渲染以测量尺寸,Shadow DOM 下测量与字体加载行为不一。
3. Shiki 与 KaTeX 通过 `<style>`/内联 style 注入,Shadow DOM 会阻断继承的 CSS 变量,反而增加复杂度。

强制约束:

```css
/* styles/base.css */
.md-doc {
  all: revert;                 /* 清空 app 样式对正文的影响 */
  font-family: var(--md-font-family);
  color: var(--md-text);
  background: var(--md-bg);
  /* ... */
}

/* App 侧任何选择器不得以 .md-doc 后代为作用对象 */
```

- 变量注入:`.md-doc` 只消费 `--md-*`;`.app-*` 只消费 `--app-*`。
- 跨主题的**唯一**共享变量是 Mermaid/Shiki 的主题名映射(见 §5)。
- 视觉回归测试:切换 App Theme 后,`.md-doc` 内截图必须**像素级不变**;反之亦然。

---

## 3. CSS 变量契约

### 3.1 App Theme

```css
/* styles/app-theme.css */
:root {
  --app-bg: #ffffff;
  --app-bg-elevated: #f6f8fa;
  --app-fg: #1f2328;
  --app-fg-muted: #59636e;
  --app-border: #d1d9e0;
  --app-accent: #0969da;
  --app-accent-fg: #ffffff;
  --app-hover: rgba(0, 0, 0, .04);
  --app-active: rgba(0, 0, 0, .08);
  --app-shadow: 0 1px 3px rgba(0, 0, 0, .12);
  --app-titlebar-h: 36px;
  --app-tabs-h: 36px;
  --app-sidebar-w: 260px;
  --app-statusbar-h: 24px;
  --app-font-ui: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}

:root[data-app-theme='dark'] {
  --app-bg: #0d1117;
  --app-bg-elevated: #161b22;
  --app-fg: #e6edf3;
  --app-fg-muted: #8d96a0;
  --app-border: #30363d;
  --app-accent: #2f81f7;
  /* ... */
}
```

首版内置 2 套 App Theme:`light` / `dark`。跟随系统:`system` → 监听 `matchMedia('(prefers-color-scheme: dark)')` 动态切换 `data-app-theme`。

### 3.2 Markdown Theme

```css
/* styles/md-base.css —— 只放结构,不放颜色 */
.md-doc {
  --md-font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
  --md-font-size: 16px;
  --md-line-height: 1.7;
  --md-measure: 46rem;          /* 正文最大宽度 */
  --md-paragraph-gap: 1em;
  --md-code-font: "Cascadia Code", Consolas, "Courier New", monospace;
  --md-radius: 6px;
}

/* styles/md-light.css */
.md-doc[data-md-theme='light'] {
  --md-bg: #ffffff;
  --md-text: #1f2328;
  --md-heading: #1f2328;
  --md-link: #0969da;
  --md-border: #d1d9e0;
  --md-quote-border: #d1d9e0;
  --md-quote-fg: #59636e;
  --md-code-bg: #f6f8fa;
  --md-code-border: #d1d9e0;
  --md-table-stripe: #f6f8fa;
  --md-mark-bg: #fff8c5;
}
```

首版内置 3 套 Markdown Theme:

| 名称 | 特征 |
|---|---|
| `light` | GitHub 风格,浅色 |
| `dark` | GitHub 深色 |
| `paper` | 米色纸张、衬线正文、稍窄行宽(长时间阅读) |

`paper` 需要衬线字体栈:

```css
--md-font-family: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, Georgia, serif;
```

> 注意:系统未装这些字体时会回落到 Georgia/SimSun。首版不打包字体(包体与许可问题);若 M2 决定内置,用 `@fontsource` 子集化,并在 `font-src 'self'` 下从本地加载。

---

## 4. 主题切换的实现

### 4.1 切换路径(必须不重解析)

```ts
// src/ui/src/core/theme/apply.ts
export function applyAppTheme(theme: AppTheme) {
  document.documentElement.dataset.appTheme = resolveSystem(theme)
  // 仅改一个属性,浏览器自动重算 CSS 变量
}

export function applyMarkdownTheme(theme: MarkdownThemeKey) {
  readerEl.dataset.mdTheme = theme
}
```

- **普通 Markdown 内容**:只改 `data-md-theme`,`<html>` 上已有全部 HTML,零 JS 重绘。
- **代码块**:Shiki 用 `defaultColor: false` 输出 `--shiki-light`/`--shiki-dark` 双变量,样式表按主题选取:

```css
.md-doc[data-md-theme='dark'] .shiki,
.md-doc[data-md-theme='dark'] .shiki span {
  color: var(--shiki-dark) !important;
  background-color: var(--shiki-dark-bg) !important;
}
.md-doc[data-md-theme='light'] .shiki span,
.md-doc[data-md-theme='paper'] .shiki span {
  color: var(--shiki-light) !important;
  background-color: var(--shiki-light-bg) !important;
}
```

- **KaTeX**:纯 CSS,`--md-text` 驱动,无需重绘。
- **Mermaid**:**需要重绘**。见 §5。

### 4.2 切换耗时预算

| 内容 | 目标 |
|---|---|
| 纯文本 + 代码 + 公式 | < 50 ms |
| 含 10 个 Mermaid | < 800 ms(异步,不阻塞正文) |

---

## 5. Mermaid 主题映射

Mermaid 不能通过 CSS 变量完全换肤(它把颜色写进 SVG 的 `style`/`fill`)。因此:

```ts
// src/ui/src/core/render/mermaid.ts
const THEME_MAP: Record<MarkdownThemeKey, MermaidTheme> = {
  light: 'default',
  dark: 'dark',
  paper: 'neutral',
}

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: THEME_MAP[activeMdTheme],
  fontFamily: 'var(--md-font-family)',
  flowchart: { htmlLabels: false, useMaxWidth: true },
})
```

- `securityLevel: 'strict'`:HTML 标签被编码,点击禁用(防 XSS)。
- `htmlLabels: false`:使用 SVG `<text>` 而非 `<foreignObject>`,避免 HTML 注入面,也让截图/导出更稳。
- **缓存**:`Map<`${hash(code)}:${theme}`, string /* svg */>`;切换主题时,先用缓存填充,未命中的按可见性重新渲染。
- **重绘编排**:

```text
applyMarkdownTheme(next)
  → 遍历当前已渲染的 .md-mermaid 元素
  → 对每个: 查缓存(hash, next) → 命中则 innerHTML = svg
                           → 未命中则清空 → 交给 IntersectionObserver
  → 未在视口内的图不立即渲染(NFR-002)
```

---

## 6. 设置持久化

```ts
// src/ui/src/stores/settings.ts
export interface Settings {
  appTheme: 'light' | 'dark' | 'system'
  mdTheme: 'light' | 'dark' | 'paper'
  mdFontSize: number          // px, 12..24
  mdLineHeight: number        // 1.4..2.2
  mdMeasure: number           // rem, 32..72
  mdCodeFontSize: number      // px, 11..20
  sidebarVisible: boolean
  sidebarWidth: number
  tocVisible: boolean
  allowRemoteImages: boolean
  allowAbsoluteAssetPaths: boolean
  restoreOnStartup: 'session' | 'empty' | 'lastFile'
  zoom: number                // 0.8..1.6
}
```

- 存 `tauri-plugin-store`(`settings.json`)。
- 写入去抖 300 ms;`beforeunload` 强制落盘一次。
- 读取失败(损坏 JSON)→ 回落默认值 + 备份损坏文件为 `settings.corrupt.json`,不阻塞启动。
- 版本号 `schemaVersion`,为未来迁移预留。

---

## 7. 缩放与字号

| 概念 | 实现 | 影响范围 |
|---|---|---|
| **应用缩放** `zoom` | `<html style="zoom: …">` 或 WebView 的 `setZoom` | 全部 UI |
| **正文正文字号** `mdFontSize` | `--md-font-size` | 仅 `.md-doc` |
| **行宽** `mdMeasure` | `--md-measure`(max-width) | 仅 `.md-doc` |

`Ctrl +` / `Ctrl -` 默认调**正文正文字号**(阅读场景更常用);`Ctrl + Shift +` 调应用缩放。

---

## 8. 自定义 CSS(P1,FR-013 的评估项)

首版**不做**。若做,设计要求(现在记录以免将来返工):

1. 用户 CSS 写入 `user.css`,通过 `<link>` 加载(受 `style-src 'self'` 允许)。
2. 作用域限制:只允许 `:root` 与 `.md-doc` 相关选择器,禁止 `@import` 与 `url()`(防外链)。
3. 必须在独立文件、可一键禁用。
4. **不能**与主题变量体系冲突:提供 `--md-*` 的覆盖入口即可,不鼓励任意选择器。

---

## 9. 视觉回归测试

- 工具:Playwright `toHaveScreenshot()`。
- 用例矩阵:`3 个 mdTheme × 2 个 appTheme × {basic, extended, theme}` = 18 张基准图。
- 阈值:`maxDiffPixelRatio: 0.001`。
- 隔离性用例:
  - 切 App Theme,对 `.md-doc` 截图 → 必须与基准**完全一致**。
  - 切 Markdown Theme,对侧栏/工具栏截图 → 必须**完全一致**。
- 字体差异会导致跨机不一致 → 基准图只在 CI 的固定镜像上生成与比对,本地跑用 `--update-snapshots` 手动更新。

---

## 10. 待实测项

| 项 | 验证方式 |
|---|---|
| `CSS.highlights` 与 `.md-doc` 命名空间方案的兼容 | 搜索功能 E2E |
| Shiki 双主题 CSS 变量在 WebView2 156 正确覆盖 | 截图比对 |
| Mermaid `fontFamily: 'var(--md-font-family)'` 是否生效(它可能不解析 CSS 变量) | 渲染中文标签图,测量文本宽度;不生效则传入真实字体名 |
| `paper` 主题在无衬线字体机器上的回落观感 | 手工 |
| 18 张基准图的渲染稳定性(同一机器两次跑是否 0 diff) | CI 连续两次 |
