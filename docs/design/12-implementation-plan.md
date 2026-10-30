# 12 — 实施计划(任务分解)

> 本文是**可执行的任务清单**,按阶段与依赖排序。每个任务:编号、位置、验收方式。
> 阶段划分遵循需求文档 §7 里程碑;任务粒度保证「一个任务 = 1–3 次工具操作可完成」。
> **状态图例**:`[ ]` 未开始 / `[~]` 进行中 / `[x]` 完成 / `[!]` 阻塞

---

## 依赖关系总览

```text
Phase 0 (工程基线,无 Rust)
  T01 → T02 → T03 → T04
         └────→ T05 → T06 → T07
                            │
Phase 1 (M0 验证)            ▼
  T08(Rust 环境) ──→ T09 ──→ T10 ──→ T11 ──→ T12 ──→ T13
                                    │                 │
                                    └──→ T14(Qt 对照) ─┴──→ T15 ──→ T16(ADR)
                                                                        │
Phase 2 (M1 全部 P0)                                                    ▼
  T17 → T18 → T19 → T20 → T21 → T22 → T23 → T24 ─┬→ T24b(链接 FR-019)
                                                  ├→ T24c(多标签 FR-020)
                                                  ↓
                                   T25 → T26 → T28 → T29 → T30 → T31
                                                          └→ T32 … T42
                                                                       │
Phase 3 (M2)  T43 … T49                                                ▼
Phase 4 (M3)  T50 … T53
```

**插入任务说明**:

- `T24b`(链接跳转)与 `T24c`(多标签)是 v0.4 新增的两项 P0 UI 需求,必须在 T24 之后、T25 之前完成,因为它们决定了 `ReaderView` 的事件委托形态与 `stores` 的标签结构,晚做会导致大面积返工。
- `T24b` 依赖 `T19`(path_guard)与 `T20`(url_policy),两者都已在它之前。
- `T24c` 依赖 `T17`(registry 去重)与 `T28`(预算,协同完成),因此 `T28` 与 `T24c` 可并行,但**都必须早于 T29**(滚动恢复依赖标签结构)。
- 原 `T27`(链接解析与点击委托)内容已并入 `T24b`,编号保留占位。

**关键路径**:`T08`(Rust 环境)是所有 Rust 任务的前置;在获得授权前,`Phase 1` 之后的全部任务处于 `[!]` 阻塞。

---

## Phase 0 — 工程基线(不依赖 Rust)

### T01 初始化 pnpm workspace 与根配置

- [ ] **位置**:根目录
- **产出**:
  - `package.json`(脚本见 `11-build-and-release.md` §2)
  - `pnpm-workspace.yaml`(`packages: ['src/ui']`)
  - `tsconfig.base.json`(`strict: true`、`noUncheckedIndexedAccess: true`、`moduleResolution: "bundler"`)
  - `biome.json`(格式化 + lint;`noRestrictedGlobals` 禁 `setInterval`;`noRestrictedImports` 禁 `core/**` 引入 vue/pinia/@tauri-apps)
  - `.gitignore`(`node_modules`、`dist`、`target`、`fixtures/generated`、`*.local`)
  - `.editorconfig`(LF、UTF-8、2 空格;`.rs` 4 空格)
  - `.npmrc`(`ignore-scripts=true`、`strict-peer-dependencies=false`)
  - `README.md`(项目简介 + 开发起步命令)
- **验收**:`cmd /c pnpm -r exec node -v` 成功;`cmd /c pnpm biome --version` 输出版本

### T02 建立前端骨架与 IPC 桥抽象

- [ ] **位置**:`src/ui/**`
- **产出**:
  - `src/ui/package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`
  - `src/main.ts`、`App.vue`(最小外壳:标题栏 + 空阅读区)
  - `src/core/ipc/contract.ts`(全部 DTO 类型,见 `07-ipc-contract.md` §3.1)
  - `src/core/ipc/bridge.ts`(`IpcBridge` 接口)
  - `src/core/ipc/tauriBridge.ts`(包装 `invoke`,暂留 TODO)
  - `src/core/ipc/mockBridge.ts`(基于 fixtures,支持 `__mockEmit`)
  - `src/core/ipc/index.ts`(按 `VITE_IPC_MOCK` 选择)
- **验收**:`cmd /c pnpm ui:dev` 打开 `http://localhost:1420` 显示空外壳;`cmd /c pnpm ui:typecheck` 通过

### T03 建立 Markdown 夹具(基础集)

- [ ] **位置**:`fixtures/`
- **产出**:
  - `extended.md`(GFM 表格含对齐、任务列表、删除线、脚注、5 种 Alerts、行内+块级公式含 1 个错误公式、3 类 Mermaid、8 种语言代码 + 1 个未知语言、相对图片、HTML 块、嵌套引用+列表+代码)
  - `theme.md`(覆盖所有主题变量)
  - `html-safety.md`(`<script>`、`onerror`、`javascript:` 链接、`<iframe>`、SVG script、`data:text/html`、`<style>` 注入、原型污染尝试)
  - `cjk-typography.md`(中英混排、全角标点、纯中文标题、重复标题、长无空格中文段、CJK+emoji)
  - `links.md`(**FR-019 专用**:锚点/本地 md/附件/外链/非法 scheme 全类型)
  - `tabs/`(**FR-020 专用**:20 个唯一内容的小文件,用于标签切换与溢出)
  - `resources/`(png/jpg/svg/gif、中文文件名、带空格文件名、子目录、0 字节损坏图)
- **验收**:人工通读每个文件,确认覆盖项齐全

### T04 建立基准夹具生成脚本

- [ ] **位置**:`src/bench/gen-fixtures.mjs`
- **产出**:
  - 确定性生成(固定种子):`100kb.md`、`1mb.md`、`10mb.md`、`50mb.md`、`mermaid-100.md`、`code-heavy.md`、`math-heavy.md`
  - 多文件目录:`src/bench/out/docs-10/`、`docs-30/`、`docs-100/`
  - `--out` 参数,默认 `fixtures/generated/`
- **验收**:连续两次运行生成的文件字节完全一致(`Get-FileHash` 比对)

### T05 插件兼容性冒烟测试

- [ ] **位置**:`src/ui/tests/unit/plugin-compat.spec.ts`
- **内容**:逐个验证 `markdown-it@15.0.3` 与
  - `markdown-it-footnote@4.0.0`
  - `markdown-it-anchor@10.0.0`
  - `markdown-it-github-alerts@1.0.1`
  - `@vscode/markdown-it-katex@1.1.2`
  - `@shikijs/markdown-it@4.5.0`
  - 自研 `taskList`
  的兼容性,输出一份通过/失败矩阵
- **验收**:测试全绿;若有失败 → 记录到 `docs/design/findings-plugin-compat.md` 并锁定 `markdown-it@14.3.3` 作为退路(需写 ADR)

### T06 实现 Markdown 渲染核心

- [ ] **位置**:`src/ui/src/core/markdown/**`
- **产出**:
  - `preset.ts`(markdown-it 配置)
  - `plugins.ts`(插件装配)
  - `rules/taskList.ts`
  - `augment.ts`(5 个 core rule)
  - `toc.ts`(`buildTocTree`)
  - `slug.ts`(github-slugger 封装 + CJK 验证)
  - `index.ts`(`renderMarkdown(text, opts): ParseResult`)
- **验收**:`plugin-compat` 测试通过;每个 fixture 生成 golden HTML 并入库 `src/ui/tests/golden/`

### T07 建立基准框架骨架

- [ ] **位置**:`src/bench/web-bench.mjs`、`src/bench/sample-tree.ps1`、`benchmarks/`
- **产出**:
  - `web-bench.mjs`(Playwright 驱动,`--scenario` 参数)
  - `sample-tree.ps1`(递归采样进程树 RSS/CPU)
  - `benchmarks/environment.md`(本机实测数据)
  - `benchmarks/results.csv`(表头 + 一次空载基线)
- **验收**:`node src/bench/web-bench.mjs --scenario open --fixture 100kb` 产出 CSV 行

---

## Phase 1 — M0 验证与 ADR 冻结

> **前置**:`T08` 需要用户授权安装 Rust 与 MSVC Build Tools。未授权前以下任务全部 `[!]` 阻塞。

### T08 安装 Rust 工具链与 MSVC(需授权)

- [ ] **位置**:系统环境
- **步骤**:见 `11-build-and-release.md` §1.1
- **验收**:新终端中 `rustc --version` ≥ 1.90、`cargo --version` 正常;`cargo install tauri-cli --version "^2"` 可选(也可用 pnpm 侧的 `@tauri-apps/cli`)

### T09 建立 Tauri host crate 并验证目录定位

- [ ] **位置**:`src/host/**`
- **产出**:
  - `Cargo.toml`(`tauri 2.12.5`、`tauri-build 2.7.4`、features `custom-protocol` + `protocol-asset`)、`build.rs`
  - `tauri.conf.json`(见 `11` §3)
  - `capabilities/default.json`(见 `06` §3)
  - `src/main.rs`(`run()` + 原生错误兜底)、`src/lib.rs`
  - `icons/`(`tauri icon` 生成)
- **验收**:
  - `cmd /c "pnpm tauri dev"` 能起一个空窗口
  - **专项验证**:CLI 自动发现 `src/host` 生效(输出日志显示找到了 `src/host/tauri.conf.json`);若失败则设 `TAURI_APP_PATH=src/host` 并记录
  - `devUrl` 能连上 Vite

### T10 验证大文件 IPC 传输(`tauri::ipc::Response`)

- [ ] **位置**:`src/host/src/commands/documents.rs`(最小版)
- **产出**:`read_document` 命令返回原始字节;前端 `new Uint8Array(buf)`
- **验收**:
  - 50 MB 文件读取成功,前端 `byteLength` 正确
  - 记录读取耗时与内存到 `benchmarks/findings.md`
  - 若 `Response` → `ArrayBuffer` 不工作 → 退化为 base64 并写 ADR-005

### T11 最小 ReaderView(主渲染链路)

- [ ] **位置**:`src/ui/src/reader/**`
- **产出**:
  - `ReaderView.vue`(容器 + `innerHTML` + 事件委托骨架)
  - `renderInto.ts`
  - Mermaid 懒渲染(`IntersectionObserver` + 并发 2 + 超时 5 s)
  - 批量资源解析调用(`resolve_assets` 前端部分)
- **验收**:7 个 fixture 在 Tauri 窗口内全部正确显示;Mermaid 错误块不拖垮全文

### T12 CJK 锚点与 TOC 高亮

- [ ] **位置**:`core/markdown/slug.ts`、`app/Sidebar.vue`
- **验收**:`cjk-typography.md` 中文标题有 id;点击 TOC 可滚动;滚动时高亮跟随;`[跳转](#中文锚点)` 可用

### T13 双主题切换(不重解析)

- [ ] **位置**:`core/theme/**`、`styles/**`
- **产出**:2 套 App Theme + 3 套 Markdown Theme + Shiki 双主题变量 + Mermaid 主题映射
- **验收**:切换主题时 `parseMs` 不增加(用 `performance.mark` 证明);视觉检查通过

### T14 Qt 受限对照原型(PySide6)

- [ ] **位置**:`src/experiments/qt-renderer/**`、`src/bench/qt-bench.py`
- **产出**:最小 Qt 应用:打开文件、`QTextDocument` 渲染、滚动、搜索、目录、浅/深配色、相对图片
- **验收**:
  - 同夹具的功能缺口表(逐项标注「不支持」)
  - 首屏时间、内存、CPU 记录
  - **不实现** Mermaid/KaTeX/Alerts(明确记录为缺失)

### T15 统一性能与可靠性测试

- [ ] **位置**:`src/bench/**`、`benchmarks/results.csv`
- **内容**:
  - 100 KB / 1 MB / 10 MB / 50 MB
  - 100 图表、长代码、公式密集
  - 10/30/100 文档打开/切换/关闭
  - 真实文件监听(直接覆写、临时文件替换、连续保存)
  - 删除/替换/错误 Mermaid/缺失图片容错
  - 进程树 RSS/CPU(含 WebView2 子进程)
- **验收**:`results.csv` 完整;无法完成的项记录原因

### T16 写 ADR-001/002/003

- [ ] **位置**:`docs/decisions/`
- **产出**:
  - `ADR-001-renderer-and-host.md`:正式 Renderer / Parser / Host 冻结,含被弃方案理由
  - `ADR-002-style-isolation.md`:命名空间 vs Shadow DOM 的最终选择(附实测)
  - `ADR-003-performance-thresholds.md`:量化阈值(含大文件分段阈值、缓存预算、去抖时长)
- **验收**:三项决策明确、有数据支撑、列出 M1 需补足的能力

---

## Phase 2 — M1(全部 P0)

### T17 DocumentRegistry 全链路

- [ ] **位置**:`src/host/src/documents/**`
- **验收**:`cargo test` 覆盖幂等 open、close 幂等、版本递增、路径去重

### T18 编码探测

- [ ] **位置**:`src/host/src/documents/encoding.rs`
- **验收**:单测覆盖 UTF-8/8-BOM/16LE/16BE/GB18030/ASCII/空文件/二进制垃圾

### T19 path_guard

- [ ] **位置**:`src/host/src/security/path_guard.rs`
- **验收**:单测覆盖 `..` 逃逸、symlink 逃逸、绝对路径、`C:\docs-evil` 前缀陷阱、NUL、超长

### T20 url_policy

- [ ] **位置**:`src/host/src/security/url_policy.rs`
- **验收**:单测覆盖 7 种 scheme + CRLF 注入

### T21 watcher 服务

- [ ] **位置**:`src/host/src/watcher/**`
- **验收**:集成测试通过(直接覆写 / rename 覆盖 / 删除 / 连续 20 次写入 / 目录复用 / 关闭后无事件)

### T22 事件发射与版本化

- [ ] **位置**:`src/host/src/ipc/events.rs`、registry 集成
- **验收**:前端收到 `doc:changed` 且 version 单调递增

### T23 jobQueue 代次守卫

- [ ] **位置**:`src/ui/src/core/render/jobQueue.ts`
- **验收**:单测:旧 generation 结果被丢弃;同文档任务替换;串行执行

### T24 parse.worker 完整管线

- [ ] **位置**:`src/ui/src/workers/parse.worker.ts`
- **验收**:7 个 fixture 的 golden HTML 快照通过;Worker 内 Shiki 单例复用

### T24b 链接点击跳转(FR-019)

- [ ] **位置**:`src/host/src/commands/links.rs`、`src/ui/src/reader/bindLinks.ts`、`src/ui/src/core/documents/linkResolver.ts`
- **产出**:
  - Rust `resolve_link`:锚点 / 本地 md / 附件 / 外链 / 拦截 五类判定(见 `14-link-navigation.md` §2.1)
  - `open_url` 与 `open_path_with_system` 命令(再次过 `url_policy` / `path_guard`)
  - 前端 `bindLinks`:事件委托 + `click` / `auxclick` 双监听 + 修饰键语义
  - `scrollToAnchor`:含中文 id、`name` 锚点降级、`CSS.escape`、闪烁反馈、失败 toast
  - 跨文档锚点 `pendingAnchor` 机制
  - 状态栏悬停目标提示
- **验收**:
  - Rust 单测 18 条(§7.2)全绿
  - E2E-31..E2E-43 全绿
  - 点击外链后 `page.url()` 不变(未发生顶层导航)
  - `javascript:` 链接被拦截且无脚本执行

### T24c 多标签界面(FR-020)

- [ ] **位置**:`src/ui/src/app/TabBar.vue`、`TabItem.vue`、`TabOverflowList.vue`、`TabContextMenu.vue`、`src/ui/src/stores/tabs.ts`、`src/ui/src/core/tabs/**`
- **产出**:
  - 标签栏视觉与状态样式(活动/悬停/焦点/外部已改/已失效/加载中)
  - 数据结构与不变量、状态机(见 `13-tabs.md` §3)
  - 新建:对话框/拖入/链接跳转/启动参数,并按 canonical path 去重
  - 切换:`Ctrl+Tab`、`Ctrl+1..8`、`Ctrl+9`(末尾)、`Ctrl+PageUp/Down`;已缓存标签**不重新解析**
  - 关闭:`×`、`Ctrl+W`、中键、右键(关闭/其他/右侧/全部),焦点转移规则
  - 资源释放:调 `close_document`、清 Mermaid 缓存、清 `CSS.highlights`、释放 html
  - 拖拽重排(原生 HTML5 DnD,`TabsDnd.ts` 纯函数)
  - 溢出:横向滚动 + `[▾ N]` 下拉(带过滤)
  - 右键菜单 + 恢复最近关闭(`Ctrl+Shift+T`,上限 15)
  - 持久化:标签顺序 + 活动标签 + 每标签锚点
  - 无障碍:`role="tablist"` / `role="tab"` / `aria-selected` / roving tabindex / `aria-live`
- **验收**:
  - `core/tabs/order.ts` 单测全绿(边界索引、不可变性、no-op)
  - E2E-21..E2E-30 全绿
  - E2E-29:切回标签时 `parseMs` 无新增
  - 打开 20 标签标签栏可溢出访问,60 fps

### T25 消毒策略与按需消毒

- [ ] **位置**:`src/ui/src/core/sanitize/policy.ts`
- **验收**:`html-safety.md` 零脚本执行;`extended.md` 的 `.katex` 元素数量 > 0;`hasRawHtml=false` 时 DOMPurify 未被调用(用 spy 断言)

### T26 Asset 授权与图片管线

- [ ] **位置**:`src/host/src/commands/assets.rs`、前端 `assetUrl.ts`
- **验收**:相对图片显示;目录外文件被拒;100 张图 1 次批量 IPC

### T27 链接解析与点击委托 → **已并入 T24b**

- 原 T27 的「链接解析与点击委托」内容已完整移入 **T24b**(含 Rust `resolve_link`、前端 `bindLinks`、`scrollToAnchor`、跨文档锚点)。此处保留编号占位,避免与既有引用冲突。

### T28 多标签与内存预算 → 标签 UI 部分见 **T24c**,本任务只保留内存预算

- [ ] **位置**:`src/ui/src/core/documents/budget.ts`、`src/ui/src/stores/tabs.ts`(与 T24c 协同)
- **验收**:打开 30 文件 RSS 受控;LRU 逐出顺序正确;活动标签不被逐出;逐出后切回能自动重解析

### T29 滚动位置锚定与恢复

- [ ] **位置**:`reader/scrollAnchor.ts`
- **验收**:E2E-10 通过(±5%);内容变化后回落最近前置行

### T30 TOC 侧栏与滚动高亮

- [ ] **位置**:`app/Sidebar.vue`、`app/TocPanel.vue`
- **验收**:E2E-03 通过

### T31 正文搜索

- [ ] **位置**:`core/search/**`
- **验收**:E2E-09 通过;`CSS.highlights` 不可用时降级路径可用;无残留高亮

### T32 完整双主题样式

- [ ] **位置**:`styles/**`
- **验收**:18 张视觉基准图通过;隔离性用例通过

### T33 设置持久化

- [ ] **位置**:`stores/settings.ts`、`src/host`(store 插件注册)
- **验收**:重启后主题/字号/窗格/最近文件/会话恢复

### T34 窗口状态恢复

- [ ] **位置**:`src/host`(window-state 插件)
- **验收**:重启后位置尺寸一致

### T35 单实例与启动参数

- [ ] **位置**:`src/host/src/lib.rs`
- **验收**:第二次双击 `.md` 在现有窗口新开标签并聚焦;`app.exe "x.md"` 可打开

### T36 错误容错 UI

- [ ] **位置**:`app/ErrorBanner.vue`、`reader/**`
- **验收**:AC-09 三种场景有可理解反馈,应用不崩

### T37 错误码文案与日志

- [ ] **位置**:`i18n/zh-CN.ts`、`src/host/src/infra/logging.rs`
- **验收**:每个错误码有中文文案;日志文件可按 commit 追踪

### T38 诊断面板

- [ ] **位置**:`app/diagnostics/**`、`get_env_info` 命令
- **验收**:显示 WebView 版本、Rust 版本、Tauri 版本、字体、缩放

### T39 超大文档分段模式

- [ ] **位置**:`core/markdown/segment.ts`
- **验收**:10 MB 首屏达标;50 MB 不崩溃;阈值来自 ADR-003

### T40 完整 E2E 套件

- [ ] **位置**:`src/ui/tests/e2e/**`
- **验收**:E2E-01..E2E-20 全绿

### T41 手工验收一轮

- [ ] **位置**:`docs/dev/manual-qa.md`
- **验收**:AC-01..AC-12 逐条勾选

### T42 NSIS 打包与文件关联

- [ ] **位置**:`src/host/tauri.conf.json`
- **验收**:安装后双击 `.md` 直接进阅读视图;卸载清理关联

---

## Phase 3 — M2(阅读体验)

### T43 图表/图片 Lightbox

- [ ] 缩放 0.25x–8x、拖拽平移、双击复位、`<dialog>` + `Esc`
- **验收**:FR-012 中"图表/图片放大、平移、全屏"达成

### T44 更多 Markdown Theme 与自定义 CSS 评估

- [ ] 增加 2 套主题;评估用户自定义 CSS 的可行性(受 CSP 约束)
- **验收**:FR-013 部分达成

### T45 快捷键体系完善与可配置

- [ ] `app/shortcuts.ts` 支持用户覆盖(存 settings)
- **验收**:FR-012 中"更丰富的快捷键"达成

### T46 阅读位置按文档持久化增强

- [ ] 每文档独立保存多个命名位置(可选)
- **验收**:跨会话恢复准确

### T47 Linux 构建与依赖清单

- [ ] WebKitGTK 依赖、AppImage 打包、字体缺失回退
- **验收**:AC-12 在 Linux 上的差异表

### T48 macOS 构建与最低系统版本

- [ ] 签名、公证、菜单栏、`CFBundleTypeRole`
- **验收**:AC-12 在 macOS 上的差异表

### T49 发布前依赖检测与引导(AC-11 完整实现)

- [ ] 原生错误对话框 + 安装器引导 + 诊断面板
- **验收**:虚拟机模拟缺 WebView2 可读到指引

---

## Phase 4 — M3(按需)

### T50 外部编辑器联动

- [ ] 「用 VS Code 打开」等,路径来自 settings 配置
- **验收**:FR-015

### T51 简单编辑

- [ ] 需先解决 `isDirty` 与外部变更冲突(见 `03-live-reload.md` §4.6)
- **验收**:FR-016

### T52 导出 HTML / PDF / 打印

- [ ] 导出需内联 CSS 与资源
- **验收**:FR-017

### T53 批量处理

- [ ] 批量导出/转换
- **验收**:FR-018

---

## 任务统计

| 阶段 | 任务数 | 说明 | 阻塞项 |
|---|---|---|---|
| Phase 0 | 7 | T01–T07 | 无 |
| Phase 1 | 9 | T08–T16 | T08 需授权安装 Rust |
| Phase 2 | 26 | T17–T42(含 T24b 链接、T24c 多标签) | 依赖 Phase 1 全部完成 |
| Phase 3 | 7 | T43–T49 | 依赖 M1 发布 |
| Phase 4 | 4 | T50–T53 | 按需 |
| **合计** | **53 个主任务** | T24b/T24c 为 T24 之后的插入任务,不改变主编号 | |

> 编号策略:`T24b`、`T24c` 是本次新增的两项 P0 UI 需求(FR-019 / FR-020)的落点,插入在 T24 之后以保持既有编号稳定;`T27` 内容已并入 `T24b` 并保留占位。若后续继续插入新任务,统一采用「主编号 + 字母后缀」,不重排全文编号。

---

## 里程碑验收门槛

### M0 退出条件(对应需求文档 M0 完成定义)

- [ ] `T09`–`T15` 全部完成
- [ ] Web 主线原型 + Qt 受限对照原型均可运行并有运行说明
- [ ] 一套可复现的 Markdown 测试样本
- [ ] 性能测量记录(`benchmarks/results.csv`)
- [ ] 功能差异与资源对比结论(`benchmarks/findings.md`)
- [ ] ADR-001/002/003 已写入 `docs/decisions/`
- [ ] 可直接进入 M1 的工程初始化清单(本文 Phase 2)

### M1 退出条件

- [ ] 全部 P0 功能(FR-001..FR-011、**FR-019**、**FR-020**)
- [ ] AC-01..AC-19 通过
- [ ] 不进入编辑模式即可完成「打开—阅读—外部修改—自动刷新—继续阅读」闭环
- [ ] 可通过正文链接在标签间跳转,且外链不会使应用界面流失
- [ ] 多标签可承载日常对照阅读(≥20 标签),切换不重新解析未变化内容
- [ ] 性能阈值按 ADR-003 验收
- [ ] 错误场景不导致崩溃
