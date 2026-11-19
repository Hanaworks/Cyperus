# 13 — 多标签界面

> 覆盖 **FR-020(P0)**、FR-007、**NFR-013**、UC-03、AC-06 / AC-16 / AC-17 / AC-18 / AC-19。
> 当前代码落点:`src/ui/src/app/DocumentTabs.vue`、`src/ui/src/core/documents/session.ts`、`src/ui/src/App.vue`、`src/ui/src/reader/ReaderView.vue`。
> 需求细则见需求文档 §3.5。

> **2026-11-07 最新状态**：主要标签交互现已接通拖动重排、右键关闭其他 / 右侧 / 全部、带过滤的溢出列表、Ctrl+PageUp/Down、跨文档后台链接、文件更新状态和跨启动恢复。持久化包含顺序、活动路径、像素阅读位置与搜索状态；最近关闭最多 15 条，仍限当前会话。首次打开期间外部保存、恢复期间用户关闭 / 打开其他文件、关闭后激活待更新邻居均已有回归。完整语义位置、LRU 及帧率目标仍未验收，见 [阅读流程完整性记录](../dev/reader-completion-plan.md)。以下早期进展段落保留历史，不代表当前缺口。

> 2026-11-04：基础多标签已接入 [阅读工作台](./15-reader-workbench.md)，T24c 仍为部分实现。已具备多选 / 多文件拖入 / 启动参数、路径去重、切换复用 ParseResult、每标签会话内滚动位置、关闭按钮 / 中键 / Ctrl+W、Ctrl+Tab / Ctrl+1..9、横向滚动与基础键盘导航。拖拽重排、右键菜单、溢出下拉、恢复最近关闭、跨会话持久化、每标签搜索上下文、watcher 状态与 T28 LRU 仍未完成。以下完整规格和量化目标不代表已通过验收；本轮验证见 [UX 执行记录](../dev/ux-workbench-progress.md)。

---

## 1. 为什么标签是一等需求

2026-11-07补充：本轮已完成每标签独立查询/匹配序号，以及文件菜单和Ctrl+Shift+T恢复最近关闭路径文档；最多15条，仅当前会话，恢复原标签顺序和阅读/搜索状态，并重新读取文件。临时浏览器正文不保留关闭副本；文件消失时提示并移除记录，不留下新错误空标签。跨启动持久化、完整右键/重排/溢出与watcher/LRU仍待完成。最新验证见 [功能推进记录](../dev/functional-progress-plan.md)，上方11月4日状态仅为历史。

原需求 FR-007 只说「支持同时打开多个文件、在文档间切换」,没有规定形态。若不明确,常见退化实现有:

- 单文档 + 「最近文件」列表(切换 = 重新打开,丢失滚动位置);
- 侧边栏文件列表(切换成本高,不适合"同时对照阅读");
- 多窗口(窗口管理成本高,用户容易迷失)。

因此明确为**阅读区顶部标签栏**,与 Chrome / VS Code 一致,并把它作为 `P0` 交互骨架。文件树承担浏览目录，标签栏承担已打开文档切换；文件 / 搜索 / 大纲是同级活动栏入口，大纲不附在文件树底部。

---

## 2. 视觉结构

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ TitleBar                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ [ a.md ×][ b.md ● ×][ c.md ⚠ ×][ d.md ×] …      [▾ 4]      [+]             │
│  ^active   ^外部已改  ^已失效                        ^溢出下拉  ^打开文件     │
├─────────────────────────────────────────────────────────────────────────────┤
```

### 2.1 尺寸

| 项 | 值 |
|---|---|
| 标签栏高度 | `var(--app-tabs-h)` = 36 px |
| 单标签最小宽度 | 96 px(仅图标 + 省略文件名,极端密集时) |
| 单标签基准宽度 | 180 px |
| 单标签最大宽度 | 260 px |
| 标签间距 | 2 px |
| 关闭按钮 | 16×16 命中区(视觉 12×12),`Ctrl+W` 为目标 24×24 内边距 |
| 溢出下拉按钮 | 32 px 宽 |

### 2.2 状态样式

| 状态 | 视觉 |
|---|---|
| 非活动 | 背景 `--app-bg-elevated`,文字 `--app-fg-muted` |
| 活动 | 背景 `--app-bg`,文字 `--app-fg`,顶部 2 px 强调色描边(或底部与正文连通) |
| 悬停 | 背景叠加 `--app-hover` |
| 键盘焦点 | 2 px 焦点环(`:focus-visible`),不依赖颜色 |
| 外部已修改 | 文件名右侧 8 px 圆点,`--app-accent-warning` |
| 已失效(删除/不可读) | 文件名加删除线 + 图标,文字 `--app-fg-muted` |
| 加载中 | 文件名右侧微型进度条或骨架闪烁(尊重 `prefers-reduced-motion`) |

**关键约束:状态必须不依赖颜色单一线索。** 圆点/图标/删除线必须同时存在,以便色觉障碍用户区分。

---

## 3. 数据结构

当前 `DocumentSession` 是框架无关的唯一会话控制器；`SessionTab` 保存 `id`、宿主 `meta`、`name`、`path`、`result: ParseResult | null`、`status: 'loading' | 'ready' | 'error'`、`error` 与 `scrollTop`。`activate` 直接使用已有解析结果，Vue 只同步视图；阅读区仅保留一个活动 DOM。

下面是完整 T24c / watcher / T28 需要逐步补齐的目标字段；沿现有 session 扩展，不另建一份独立 Pinia 标签状态。`scrollTop` 到源码行锚点的增强归 T29，当前会话内位置恢复不代表内容变化后的锚点恢复完成。

```ts
// 目标模型示意，尚未全部实现
export interface Tab {
  docId: string
  path: string            // canonical 绝对路径
  name: string            // basename
  title: string           // 显示名(name 去扩展名,过长时中间省略)
  version: number
  status: 'loading' | 'ready' | 'stale' | 'gone' | 'error'
  isActive: boolean       // 由 store 派生,不单独存储
  scrollAnchor: { line: number; ratio: number } | null
  lastAccessedAt: number
}

export interface TabsState {
  tabs: Tab[]
  activeId: string | null
  recentClosed: Array<{ path: string; index: number; closedAt: number }>  // 上限 15
}
```

### 3.1 不变量

1. `tabs` 中 `path` 唯一。
2. `activeId === null` 当且仅当 `tabs.length === 0`。
3. `recentClosed` 中的条目不入 `tabs`;恢复时按 `index` 插回原位置(若越界则追加到末尾)。
4. `scrollAnchor` 属于标签自身,关闭即丢弃(但可从 `recentClosed` 恢复时为空)。

### 3.2 状态转移

```text
          openPath
   ┌──────────────────► loading ──ok──► ready
   │                     │               │
 (空)                    │err            │doc:changed
   │                     ▼               ▼
   └── closeAll ◄────── error          stale ──activate──► ready
                                        │
                                doc:gone▼
                                       gone ──reload──► ready
```

`stale` 只存在于非活动标签。活动标签收到 `doc:changed` 立即转入刷新流程(`loading` → `ready`)。

---

## 4. 交互规格

### 4.1 新建

| 触发 | 行为 |
|---|---|
| `Ctrl+O` / `[+]` 按钮 | 打开文件对话框;单选或多选;多选时按顺序各建一个标签,激活第一个 |
| 拖入窗口 | 仅接受 `.md/.markdown/.mdown/.mkd`;多文件按顺序建标签 |
| 正文链接跳转 | 新标签并激活 |
| `Ctrl`+点击链接 / 中键点击链接 | 新标签但不激活 |
| 启动参数 / 文件关联 | 按 argv 顺序建标签,激活第一个 |
| 文件树点击 Markdown | 已打开则激活，否则新建；更换浏览根目录不关闭现有标签 |
| 从「最近文件」点击 | 已打开则激活,否则新建 |

**重复打开必须去重**:以 canonical path 为准。若目标已存在 → 只 `activate`,不新建。这需要 Rust 侧 `open_document` 返回同一 `docId`(见 `02-document-lifecycle.md` §3.5)。

### 4.2 切换

| 触发 | 行为 |
|---|---|
| 单击标签 | 激活 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 循环切换(按标签栏顺序,不按访问历史) |
| `Ctrl+1..8` | 激活第 1..8 个标签 |
| `Ctrl+9` | 激活**最后一个**标签(与 Chrome 一致) |
| `Ctrl+PageDown` / `Ctrl+PageUp` | 同 `Ctrl+Tab`(备用,适配习惯) |

切换时的执行序列(**顺序敏感**):

```text
1. 保存当前标签的 scrollAnchor(captureAnchor)
2. activeId = next
3. 若目标 status === 'stale' 或 html 已被预算逐出:
     → 显示骨架屏 → read + parse → 渲染
   否则:
     → 直接 renderInto(缓存的 html)   ← 不重新解析
4. restoreAnchor(目标.scrollAnchor)
5. 重建该标签的搜索高亮(若有保存的 query)
6. 重建该标签的 Mermaid 可见区渲染
```

**第 3 步是"切换不重新解析"的关键**:必须走缓存路径,不能无条件 `parse`。验收时断言解析调用计数 `parseCount` 不增加；仅比较上次解析耗时不足以证明没有重解析。

### 4.3 关闭

| 触发 | 行为 |
|---|---|
| 标签上的 `×` | 关闭该标签 |
| `Ctrl+W` | 关闭活动标签 |
| 中键点击标签 | 关闭该标签 |
| 右键 → 关闭 | 关闭该标签 |
| 右键 → 关闭其他 | 保留该标签 + 活动标签(若不同则保留两者,以点击的标签为准激活) |
| 右键 → 关闭右侧 | 关闭该标签右侧全部 |
| 右键 → 关闭全部 | 关闭全部 → 进入空状态 |

**关闭后的焦点转移**:

```ts
function nextActiveAfterClose(tabs: Tab[], closedIndex: number): string | null {
  if (tabs.length === 0) return null
  // 优先右侧(原索引位置现在的元素),其次左侧
  return (tabs[closedIndex] ?? tabs[closedIndex - 1])!.docId
}
```

**关闭时的资源释放(必须做,对应 NFR-002/003)**:

```ts
async function closeTab(id: string) {
  const tab = tabs.find(t => t.docId === id)
  if (!tab) return
  await bridge.closeDocument(id)        // Rust: 停 watcher、撤销 asset 授权、移除 registry
  mermaidCache.deleteByDoc(id)          // 清 SVG 缓存
  searchHighlight.clear(id)             // 清 CSS.highlights
  documents.releaseHtml(id)             // 释放 html 字符串
  recentClosed.push({ path: tab.path, index, closedAt: Date.now() })
  tabs.splice(index, 1)
}
```

**首版无编辑 → 关闭不需要"未保存"确认。** 该逻辑必须在未来引入编辑时补齐(在 `Tab` 上预留 `isDirty`)。

### 4.4 重排(拖拽)

后续完整 T24c 范围，当前尚未实现。

- 使用原生 HTML5 `draggable` + `dragover` 计算插入位置,**不引入拖拽库**。
- 拖拽时显示 2 px 插入指示线。
- 允许拖到标签栏两端。
- 重排结果立即持久化(去抖 500 ms)。
- `prefers-reduced-motion` 下禁用位移动画,仅显示指示线。

### 4.5 溢出

两种策略,首版二选一:

| 策略 | 说明 |
|---|---|
| A. 横向滚动 | 标签栏 `overflow-x: auto`,滚轮/`Shift+滚轮` 横向滚动,活动标签切换时自动滚入视野 |
| B. 溢出下拉 | 超出可用宽度时,尾部显示 `[▾ N]`,点击列出全部标签 |

**决策:同时支持 A + B。**
- 当前已提供 A 横向滚动与活动标签滚入视野，B 溢出下拉仍待实现。
- A 保证直观(可直接滚动到任意标签)。
- B 保证在 20+ 标签时仍可快速定位(下拉带搜索过滤,输入即筛)。
- 活动标签变化时必须 `scrollIntoView({ inline: 'nearest' })`。

### 4.6 右键菜单

后续完整 T24c 范围，当前尚未实现。

```text
┌────────────────────────┐
│ 关闭                   │
│ 关闭其他               │
│ 关闭右侧               │
│ 关闭全部               │
├────────────────────────┤
│ 复制文件路径           │
│ 在资源管理器中显示     │
├────────────────────────┤
│ 恢复最近关闭的标签  ▸  │  ← 子菜单列出 recentClosed
└────────────────────────┘
```

- 用自定义 DOM 菜单(便于样式一致),不用 `<select>`。
- 打开时聚焦第一项,`Esc` 关闭,方向键导航,`Enter` 执行。
- 菜单打开期间不改变活动标签(除非用户执行了切换类操作)。

### 4.7 恢复最近关闭

```ts
function reopenLastClosed() {
  const item = recentClosed.pop()
  if (!item) return
  // 若文件已不存在 → 提示并从列表移除,不建空标签
  const meta = await bridge.openDocument(item.path)
  insertTabAt(Math.min(item.index, tabs.length), meta)
}
```

- 上限 15 条,超出丢弃最旧。
- 关闭应用后**不保留**(会话内有效),避免跨启动的意外恢复。
- 快捷键 `Ctrl+Shift+T`。

2026-11-07实现：文件菜单也提供同一入口，无记录时禁用；存活的同路径标签直接激活，不覆盖它的新阅读/搜索状态。关闭记录仅存路径、索引、scrollTop和搜索上下文，不保留ParseResult或宿主句柄；临时文本和失败标签不纳入恢复记录。

---

## 5. 持久化

尚未实现；当前只在会话内保存各标签的解析结果和 `scrollTop`，不宣称重启后恢复。

```jsonc
// settings.json 片段
"tabs": {
  "order": [
    { "path": "D:\\docs\\a.md", "anchor": { "line": 412, "ratio": 0.33 } },
    { "path": "D:\\docs\\b.md", "anchor": null }
  ],
  "activeIndex": 0
}
```

- **只存路径与锚点,不存内容。**
- 写入时机:标签集合/顺序变化后去抖 500 ms;窗口 `CloseRequested` 时同步落盘一次。
- 启动恢复:
  - 逐条 `open_document`;文件不存在 → 跳过并记录到「最近文件」;
  - 全部失效 → 进入空状态;
  - 启动参数存在 → **忽略会话恢复**,只打开参数指定的文件;
  - 设置 `restoreOnStartup: 'empty'` 时跳过恢复;`'lastFile'` 只恢复活动标签。

---

## 6. 与其它功能的交互

| 功能 | 作用范围 | 说明 |
|---|---|---|
| Markdown 主题 / App 主题 | **全局** | 不随标签变化;切主题会影响所有标签(逐出标签按需重绘) |
| 文件树 | 当前选定根目录 | 显示当前文档；切换面板保留展开状态，更换根目录保留已开标签 |
| 大纲(TOC) | 活动标签 | 独立同级活动栏入口；数据来自该标签缓存的 `toc`,不重新解析 |
| 搜索 | 活动标签 | 当前工作台共享 `query` 并对活动正文重算；每标签独立保存查询与命中索引仍为后续规格 |
| 状态栏 | 活动标签 | 编码、行数、图表数、同步状态均取自活动标签 |
| 缩放 / 正文字号 | 全局 | 与标签无关 |
| 实时刷新 | 活动标签立即;非活动标签置 `stale` | 见 `03-live-reload.md` §4.4 |
| 诊断面板 | 全局 | — |

**当前每标签独立保存的项**:元数据、解析结果、打开状态 / 错误与会话内 `scrollTop`。**后续目标**:`scrollAnchor`、搜索 `query` 与索引、`stale` 状态、`version`。
**全局共享的项**:主题、字号、行宽、窗口尺寸、侧栏宽度与可见性、缩放。

---

## 7. 性能约束

> 对应 **NFR-013**:切换不得重新解析未变化文档;标签数增长不得导致切换延迟线性恶化。
> 下表为待验收目标。T28 LRU 尚未实现，当前保留已开标签的 ParseResult；用户本轮优先 UX，未重跑性能矩阵，原 M0 未达标项继续保留。

| 指标 | 目标 |
|---|---|
| 标签切换(已缓存) | < 50 ms 到内容可见 |
| 标签切换(需重解析,1 MB) | < 400 ms |
| 切换时的解析调用次数 | **0**(未变化的文档;E2E-29 断言 `parseCount` 不增加) |
| 打开 20 个标签耗时 | < 3 s(批量,串行解析) |
| 20 → 100 标签时切换延迟增长 | 不随数量线性增长(逐出后走重解析路径,但切换本身仍是 O(1) 查找) |
| 打开 100 个标签 | 不崩溃;仅最近 10 个保留 `html`,其余 `stale` |
| 标签栏重排/滚动 | 60 fps |
| 关闭标签后的资源释放 | 关闭后 1 s 内 RSS 可见下降(大文档时) |

**禁止**:为每个标签创建独立 Web Worker。Worker 全局一个,任务串行(见 `08-performance.md` §2)。

---

## 8. 无障碍

| 要求 | 实现 |
|---|---|
| 角色 | 标签栏 `role="tablist"`,标签 `role="tab"`,`aria-selected`,关闭按钮 `aria-label="关闭 <文件名>"` |
| 键盘 | 标签栏整体一个 Tab 停靠点,内部用左右方向键移动,`Enter`/`Space` 激活(roving tabindex) |
| 屏幕阅读器 | 状态变更通过 `aria-live="polite"` 播报「已切换到 b.md」 |
| 焦点可见 | `:focus-visible` 焦点环,对比度 ≥ 3:1 |
| 关闭按钮 | 必须可通过键盘到达(在标签内 `Tab` 或方向键 + `Delete`) |
| 拖拽替代 | 提供右键菜单「左移/右移」作为键盘可达的重排方式 |

---

## 9. 组件与文件

```text
src/ui/src/app/
└── DocumentTabs.vue      当前标签栏:展示、激活、关闭、横向滚动、键盘导航

src/ui/src/core/documents/session.ts   当前会话、去重、异步生命周期、缓存、位置
src/ui/src/App.vue                    打开来源、快捷键与活动文档集成
src/ui/src/reader/ReaderView.vue       单活动 DOM、搜索与滚动位置
```

后续可按完整功能拆出 `TabOverflowList.vue`、`TabContextMenu.vue`、纯重排函数、最近关闭栈与持久化适配；保持 `DocumentSession` 为唯一状态源。顺序操作保持纯函数，输入数组与操作、输出新数组，不触碰 DOM，方便独立测试。

---

## 10. 测试

### 10.1 单元(Vitest)

| 用例 | 断言 |
|---|---|
| `order.insertAt` | 边界索引(0 / length / 越界)正确 |
| `order.removeAt` | 返回新数组,原数组不被修改 |
| `order.move` | 前移/后移到自身索引为 no-op |
| `recent.push` | 超过 15 条丢弃最旧 |
| `recent.reopen` | 索引越界时追加末尾 |
| `nextActiveAfterClose` | 右侧优先、其次左侧、空数组返回 null |
| 去重 | 同一 canonical path 两次 open 只产生一个标签 |

### 10.2 组件(Vitest + happy-dom)

| 用例 | 断言 |
|---|---|
| 渲染 3 个标签 | 活动标签有 `aria-selected="true"` |
| 点击标签 | 触发 `activate(docId)` |
| 点击 `×` | 触发 `close(docId)`,不触发 `activate` |
| 中键点击 | 触发 `close` |
| 文件名过长 | 中间省略且保留扩展名 |
| 溢出 | 宽度不足时出现 `[▾ N]` |
| 右键菜单 | 打开后第一项聚焦;`Esc` 关闭 |

### 10.3 E2E(Playwright)

| 编号 | 用例 |
|---|---|
| E2E-21 | 打开 5 个文件 → 标签数 5 → 切换 → 内容变化 |
| E2E-22 | 重复打开同一文件 → 标签数不变,激活已有 |
| E2E-23 | `Ctrl+W` 关闭活动标签 → 激活右侧邻居 |
| E2E-24 | 关闭全部 → 空状态可见 |
| E2E-25 | 拖拽重排 → 顺序变化 → 刷新页面后顺序保持 |
| E2E-26 | 关闭 2 个后 `Ctrl+Shift+T` 两次 → 恢复且位置正确 |
| E2E-27 | 打开 20 个文件 → 溢出下拉可用 → 从下拉激活第 15 个 |
| E2E-28 | 滚动到 60% → 切标签 → 切回 → 位置仍在 60% ±5% |
| E2E-29 | 切回标签时 `parseCount` 不增加(仅测试模式通过 `window.__M0__.stats()` 读取) |
| E2E-30 | 关闭标签后 mock 记录 `closeDocument` 被调用一次 |

---

## 11. 待实测项

| 项 | 验证 |
|---|---|
| 20+ 标签时标签栏滚动性能 | 60 fps 检查 |
| 拖拽重排在 WebView2 的 `dragover` 触发频率 | 手工 + 日志 |
| 100 标签时 `Ctrl+Tab` 的循环切换延迟 | 基准 |
| 标签切换时 Mermaid 重建是否造成可见闪烁 | 视觉检查;必要时保留已渲染 SVG 并复用 |
| `aria-live` 在 WebView2 + 屏幕阅读器的实际播报 | 手工(NVDA) |
