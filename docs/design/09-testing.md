# 09 — 测试策略

> 覆盖 NFR-005 / NFR-009 / NFR-013 / 需求文档 §7 验收 / AC-01..AC-19。
> 代码落点:`src/ui/tests/**`、`src/host/tests/**`、`src/bench/**`、`playwright.config.ts`。

---

## 1. 测试金字塔

```text
        ▲ 手工验收(AC-01..19,发布前)
       ███ E2E(Playwright,~25 用例)
      █████ 组件测试(Vitest + happy-dom,~40 用例)
    ███████ 单元测试(Vitest / cargo test,~200 用例)
  █████████ 快照测试(HTML golden / DTO JSON)
```

目标覆盖率:

| 范围 | 目标 |
|---|---|
| `src/ui/src/core/**` | ≥ 80% 行覆盖 |
| `src/ui/src/reader/**`、`app/**` | ≥ 50% |
| `src/host/src/security/**`、`documents/**`、`watcher/**` | ≥ 85% |
| 任意模块 | 不允许 0% |

---

## 2. 前端单元测试(Vitest,node 环境)

不需要 DOM 的纯逻辑,用默认 node 环境:

| 模块 | 用例 |
|---|---|
| `core/markdown/preset` | golden HTML:每个 fixture 渲染一次,与 `tests/golden/<name>.html` 比对 |
| `core/markdown/rules/taskList` | 嵌套列表、行内强调、误判防护(第二行 `[ ]`)、`[X]` |
| `core/markdown/augment` | `data-src-line` 正确性、mermaid 占位、未知语言、外链 rel |
| `core/markdown/toc` | 层级、去重 id、CJK 标题 |
| `core/documents/budget` | LRU 逐出顺序、活动标签不被逐出、总字节计算 |
| `core/render/jobQueue` | 代次守卫(旧结果丢弃)、同文档任务替换、串行执行 |
| `core/documents/linkResolver` | 5 种 `ResolvedLink` 分支 |
| `core/ipc/contract` | 与 Rust 快照 JSON 字段集合完全一致 |
| `core/sanitize/policy` | 需 jsdom/happy-dom,见组件测试 |

**golden HTML 的维护**:渲染结果变化时,`--update` 手动更新并 **code review diff**,防止无意中改变输出。

---

## 3. 前端组件测试(Vitest + happy-dom)

| 组件 | 用例 |
|---|---|
| `ReaderView` | 渲染 html、锚点建索引、Mermaid 占位存在、事件委托绑定一次 |
| `TabBar` | 激活/关闭/中键关闭、溢出滚动、脏标记 |
| `Sidebar`(TOC) | 层级缩进、点击滚动、滚动高亮跟随 |
| `SearchBar` | 计数、上下循环、无结果显示、`Esc` 关闭 |
| `SettingsDialog` | 各设置项双向绑定、恢复默认 |
| `ErrorBanner` | 三种状态(文件消失/读取失败/渲染降级) |
| `sanitize/policy` | `<script>` 移除、`onerror` 剥离、KaTeX 元素保留、Mermaid SVG 保留 |

`happy-dom` 版本 `21.0.4`。**不用 `jsdom`**(更慢,且 `CSS.highlights` 支持不佳)。

`CSS.highlights` 不可用时的降级路径用 jest-like mock 测试。

---

## 4. E2E(Playwright)

### 4.1 运行模式

```bash
# 纯浏览器模式(不启动 Tauri,用 mockBridge)
VITE_IPC_MOCK=1 pnpm --dir src/ui dev
pnpm exec playwright test
```

- `playwright.config.ts` 用 `webServer` 自动拉起 Vite。
- 浏览器:Chromium(`@playwright/test 1.64.1`)。
- **不依赖 Tauri**:所有 IPC 走 `mockBridge`,fixtures 通过 `?raw` 导入。

### 4.2 用例清单

| # | 用例 | 断言 |
|---|---|---|
| E2E-01 | 打开 `basic.md` | `.md-doc h1` 文本、`.task-list-item` 数量、图片存在 |
| E2E-02 | 打开 `extended.md` | 表格、Alerts 5 种、脚注、`.katex` > 0、Mermaid SVG 存在 |
| E2E-03 | 打开 `cjk-typography.md` | 中文标题有 id、点击 TOC 滚动、`#中文锚点` 可跳转 |
| E2E-04 | 打开 `html-safety.md` | 页面无 `window.__pwned`,`<script>` 未执行,`onerror` 未触发 |
| E2E-05 | 切换 App Theme | `.md-doc` 截图与基准一致;`html[data-app-theme]` 变化 |
| E2E-06 | 切换 Markdown Theme | 侧栏截图与基准一致;正文颜色变化 |
| E2E-07 | 多标签 | 打开 5 个 → 切换 → 关闭 → 激活相邻 |
| E2E-08 | 重复打开同一文件 | 标签数不增加,激活已有 |
| E2E-09 | 搜索 | 输入「渲染」→ 计数 > 0 → Enter 循环 → Esc 关闭,无高亮残留 |
| E2E-10 | 滚动位置恢复 | 滚到 60% → 切标签 → 切回 → 位置在 ±5% 内 |
| E2E-11 | 模拟外部修改 | `__mockEmit('doc:changed')` → 内容更新 → 滚动位置保持 |
| E2E-12 | 模拟连续修改 | 连发 5 次 changed → 只渲染最终版本,无闪烁 |
| E2E-13 | 模拟文件删除 | 黄条出现,旧内容保留 |
| E2E-14 | Mermaid 语法错 | 该块错误占位,其他内容正常 |
| E2E-15 | 图片缺失 | 占位元素 + 原始路径文本 |
| E2E-16 | 未知代码语言 | 纯文本代码块 + 状态栏提示 |
| E2E-17 | 10 MB 文件冒烟 | 首屏 < 3 s(放宽阈值),UI 可交互 |
| E2E-18 | 1000 行表格 | 无横向溢出崩溃 |
| E2E-19 | 链接点击 | 外链 → mock 记录 `openUrl` 调用;本地 md → 新标签 |
| E2E-20 | 窗口缩放 | 切到 800×600 → 布局不破(侧栏折叠) |
| E2E-21..30 | **多标签(FR-020)** | 见 `13-tabs.md` §10.3:打开/去重/关闭/关闭全部/重排持久化/恢复最近关闭/溢出下拉/切换保位/切回不重解析/关闭调 close |
| E2E-31..43 | **链接跳转(FR-019)** | 见 `14-link-navigation.md` §7.3:锚点/不存在锚点/本地 md 新标签/去重/Ctrl+点击中键/跨文档锚点/外链不导航/非法 scheme/目标缺失/本地附件/Tab 遍历/悬停提示 |

### 4.3 视觉回归

```ts
await expect(page.locator('.md-doc')).toHaveScreenshot('basic-light.png', {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled',
})
```

- 基准图仅在 CI 固定镜像上生成(`--update-snapshots` 只允许在 CI 环境跑)。
- 本地跑视觉用例时,如字体不同会失败 → 本地默认 `--grep-invert @visual`。

---

## 5. Rust 单元测试

| 模块 | 用例 |
|---|---|
| `security::path_guard` | 正常相对路径、`..` 逃逸、绝对路径、symlink 逃逸、空字符串、超长、NUL 字符、`C:\docs-evil` vs `C:\docs` 前缀陷阱 |
| `security::url_policy` | http/https/mailto 允许;javascript/data/file/custom scheme 拒绝;空串;CRLF 注入 |
| `documents::encoding` | UTF-8、UTF-8 BOM、UTF-16LE/BE、GB18030、纯 ASCII、空文件、二进制垃圾 |
| `documents::registry` | 幂等 open、close 幂等、版本递增、按路径去重(含大小写) |
| `watcher::translate` | 4 种 RawKind × 命中/未命中;Windows 大小写;rename 语义 |
| `error` | 每个变体的 `code()` 与序列化形状 |
| `ipc::dtos` | 序列化快照 |

```bash
cargo test --manifest-path src/host/Cargo.toml
```

---

## 6. Rust 集成测试(真实文件系统)

使用 `tempfile 3.27.0`:

| 测试 | 方式 |
|---|---|
| 真实 watcher:直接覆写 | 写入 → 等待 ≤ 500 ms → 断言收到 `modify` 且 version +1 |
| 真实 watcher:临时文件 + rename 覆盖 | `write tmp; rename tmp -> target` → 断言 `modify` |
| 真实 watcher:删除 | `remove_file` → 断言 `doc:gone` |
| 真实 watcher:连续 20 次快速写入 | 断言 version 增量 ≤ 3(去抖生效) |
| 目录 watcher 复用 | 打开同目录 3 个文件 → 断言只有 1 个 debouncer |
| 关闭后不再有事件 | close 后写文件 → 断言无事件 |
| asset 授权 | open 后 `is_allowed(path)` 为 true;目录外为 false |

**避免 flaky**:所有等待用轮询 + 超时(例如 2 s 内出现即通过),不用固定 `sleep`。

---

## 7. 手工验收(发布前)

`docs/dev/manual-qa.md` 中的清单必须逐条走过:

| 项 | 说明 |
|---|---|
| 文件关联 | 安装 NSIS 后双击 `.md` / `.markdown` 直接打开 |
| 单实例 | 已运行时再次双击 → 在现有窗口打开新标签并聚焦 |
| 启动参数 | `app.exe "D:\a.md"` 可达 |
| 拖拽打开 | 拖 `.md` 到窗口 |
| 无 WebView2 环境 | 卸载/禁用后启动 → 原生提示可读 |
| 高 DPI | 150% / 200% 缩放下布局与字体 |
| 多显示器 | 拖到不同 DPI 屏幕 |
| IME | 中文输入法在搜索框中正常 |
| 大文件 | 50 MB 打开不崩 |
| **链接跳转全类型** | 用 `fixtures/links.md` 逐条点击:页内锚点、中文锚点、相对 md、跨文档锚点、附件、`https`、`mailto`、`javascript:`(应被拦)、`data:`(应被拦);确认应用界面**从未被导航走** |
| **链接键盘可达** | 仅用键盘:Tab 到链接 → 可见焦点 → Enter 跳转 |
| **链接悬停提示** | 悬停时状态栏显示目标 |
| **20 标签切换** | 打开 `fixtures/tabs/` 全部 20 个 → 反复 Ctrl+Tab → 每个标签内容正确、位置独立 |
| **标签去重** | 同一文件通过对话框、链接、拖入三种方式打开 → 始终只有一个标签 |
| **标签关闭语义** | `Ctrl+W` / 中键 / 右键四种关闭 → 焦点转移与空状态正确 |
| **标签重排与持久化** | 拖拽重排 → 关闭窗口 → 重开 → 顺序保持 |
| **恢复最近关闭** | 连关 3 个 → `Ctrl+Shift+T` 三次 → 按逆序恢复且位置正确 |
| **标签溢出** | 打开 20 个后标签栏可横向滚动 + `[▾ N]` 下拉可定位第 15 个 |
| 关闭恢复 | 关闭窗口再开,标签与位置恢复 |
| 卸载 | 卸载后文件关联清理 |

---

## 8. CI 流水线(后续)

```yaml
jobs:
  ui:
    - pnpm install --frozen-lockfile
    - pnpm biome ci
    - pnpm --dir src/ui vue-tsc --noEmit
    - pnpm vitest run --coverage
    - pnpm exec playwright test --grep-invert @visual
  rust:
    - cargo fmt --check
    - cargo clippy -- -D warnings
    - cargo test
    - cargo audit
  build:
    - pnpm --dir src/ui build
    - cargo tauri build(仅 tag)
```

> 视觉回归单独 job,固定镜像,不阻塞普通 PR。

---

## 9. 测试夹具要求

| 夹具 | 必须覆盖 |
|---|---|
| `basic.md` | 已有:CommonMark 基础、嵌套、CJK 长段落 |
| `extended.md` | GFM 表格(含对齐)、任务列表、删除线、脚注、5 种 Alerts、行内/块级公式(含错误公式)、Mermaid(3 类)、代码(8 语言 + 未知语言)、相对图片、HTML 块、嵌套引用+列表+代码 |
| `theme.md` | 覆盖所有主题变量:标题层级、各种行内标记、表格斑马纹、代码、引用、链接、hr、任务勾选、Kbd |
| `html-safety.md` | `<script>`、`onerror`、`javascript:` 链接、`<iframe>`、SVG script、`data:text/html`、`<style>` 注入、原型污染尝试(`<img name="__proto__">`) |
| `cjk-typography.md` | 中英混排、全角标点、纯中文标题、重复标题、长无空格中文段、CJK + emoji |
| `resources/` | png/jpg/svg/gif、中文文件名、带空格文件名、子目录、损坏图片(0 字节) |
| `links.md` | **FR-019 专用**:页内锚点(中文 id、重复 id、emoji id)、不存在锚点、相对 `.md`、`.MD` 大写、带 `#anchor` 的跨文档链接、指向自身、指向父目录外(应被拒)、`.png` 附件、`https`/`http`/`mailto`、`javascript:`/`data:`/`file:`/`chrome:`、超长 URL、图片包裹的链接、表格内链接、脚注引用与回链 |
| `tabs/` | **FR-020 专用**:`a.md`..`t.md` 共 20 个小文件,每个含唯一字符串与不同长度的标题层级,用于标签切换/溢出/持久化断言 |

**每个夹具必须有对应 golden HTML 与至少 1 个 E2E 用例。**

---

## 10. 已知测试盲区(诚实记录)

| 盲区 | 原因 | 缓解 |
|---|---|---|
| Tauri IPC 真实行为 | E2E 用 mockBridge | 手工验收 + Phase 1 冒烟 |
| WebView2 渲染差异 | Playwright 用 Chromium | 手工视觉检查 + 发布前跑一次 Tauri 内 E2E(可选) |
| `asset:` 协议授权 | 单元测试无法覆盖 WebView | Rust 侧 `is_allowed` 断言 + 手工 |
| 文件关联注册表 | 需安装 | 手工 |
| 100 标签真实内存 | mockBridge 无法复现 | M0-04 真实测量 |
| IME 行为 | Playwright 不支持 | 手工 |
