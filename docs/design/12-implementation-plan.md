# 12 — 实施计划(任务分解)

> 本文是**可执行的任务清单**,按阶段与依赖排序。每个任务:编号、位置、验收方式。
> 阶段划分遵循需求文档 §7 里程碑;任务粒度保证「一个任务 = 1–3 次工具操作可完成」。
> **状态图例**:`[ ]` 未开始 / `[~]` 进行中 / `[x]` 完成 / `[!]` 阻塞
>
> **2026-11-04 执行裁定**：用户已确认 VS Code 式阅读工作台并要求“继续推进”，当前优先文件树、多标签、同级文件 / 搜索 / 大纲与位置保留。现有工作目录继续实现、文档、测试、构建与本地验证；不安装、不修改系统、不新建 worktree、不作分支 / 提交 / 推送。性能专项与 Git 后置，Qt 继续跳过。完整阶段依赖和退出门槛保留，本轮仅提前推进 UX 切片，不表示 M0 性能或完整 M1 通过。详见 [工作台设计](./15-reader-workbench.md)、[本轮执行计划](../dev/ux-workbench-plan.md) 和 [执行记录](../dev/ux-workbench-progress.md)。

---

## 依赖关系总览

2026-11-07执行补充：用户要求继续功能、视觉展示后置。当前完成T24c/T31中的最近关闭恢复、逐标签搜索上下文及已复现的菜单焦点问题，见 [功能推进记录](../dev/functional-progress-plan.md)。性能、Git、Qt边界沿用，不将这些切片标成完整M1。

同日继续推进前后端阅读流程，完成链接主流程、真实文件监听与版本事件、设置 / 会话恢复和标签管理，见 [阅读流程完整性记录](../dev/reader-completion-plan.md)。下方按实际覆盖更新 T17 / T21–T23 / T24b / T24c / T29 / T33；未完成的完整规格与量化目标继续保留。

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
                                                  ├→ T24d(目录浏览 FR-021)
                                                  ↓
                                   T25 → T26 → T28 → T29 → T30 → T31
                                                          └→ T32 … T42
                                                                       │
Phase 3 (M2)  T43 … T49                                                ▼
Phase 4 (M3)  T50 … T53
```

**插入任务说明**:

- `T24b`(链接跳转)与 `T24c`(多标签)是 v0.4 原有的两项 P0 UI 插入需求；完整计划排在 T24 之后、T25 之前，因为它们决定 `ReaderView` 的事件委托形态与多文档会话结构。
- `T24b` 依赖 `T19`(path_guard)与 `T20`(url_policy),两者都已在它之前。
- `T24c` 依赖 `T17`(registry 去重)与 `T28`(预算,协同完成),因此 `T28` 与 `T24c` 可并行,但**都必须早于 T29**(滚动恢复依赖标签结构)。
- `T24d` 为用户确认的目录浏览 P0，插在 T24 后，沿用 T19 路径守卫原则并独立管理枚举根目录；与 T24c 共同组成工作台。文件 / 搜索 / 大纲必须同级，文件树不包含底部大纲。
- 原 `T27`(链接解析与点击委托)内容已并入 `T24b`,编号保留占位。

**关键路径**:`T08`(Rust 环境)是所有 Rust 任务的前置。2026-11-04 已现场确认工具链可用，用户已授权持续执行 T07–T16，并明确跳过 T14、仅验证 Web 主线。具体结果与未通过项见 [M0 执行记录](../dev/m0-progress.md)。

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

- [x] **位置**:`src/ui/src/core/markdown/**`
- **产出**:
  - `preset.ts`(markdown-it 配置)
  - `plugins.ts`(插件装配)
  - `rules/taskList.ts`
  - `augment.ts`(5 个 core rule)
  - `toc.ts`(`buildTocTree`)
  - `slug.ts`(无状态 slug + 单次解析内唯一去重 + CJK 验证)
  - `index.ts`(`renderMarkdown(text, opts): Promise<ParseResult>`；等待高亮器初始化后同步完成解析，返回值载荷遵循 §5 契约)
- **验收**:`plugin-compat` 测试通过;每个 fixture 生成 golden HTML 并入库 `src/ui/tests/golden/`

**本轮执行细分（2026-11-04）**:
- [x] 任务列表规则：只读复选框、嵌套与行内格式，测试后实现。
- [x] TOC 提取与树构建：中文、跳级标题、重复 id 与跨文档隔离。
- [x] Token 增强：顶层源码行、Mermaid 占位、外链标记、图片懒加载；先识别原始 HTML，再生成内部标记。
- [x] 统一 `renderMarkdown` 入口：复用解析器与高亮器，返回设计约定的 `ParseResult`，保留功能开关。
- [x] 真实夹具改用统一入口，保存并核对 golden HTML；运行完整单测、类型检查及相关静态检查。

**本轮验收（2026-11-04）**：完整单测 172/172 通过（含 26 份固定夹具 golden HTML）；`ui:typecheck` 与 `lint:ci` 通过。独立复查发现的块公式源码定位缺项已修复；另补齐关闭原始 HTML 时 Alert 标题转义的回归。阅读视图与 Worker 分别在 T11、T24 接入。

### T07 建立基准框架骨架

- [x] **位置**:`src/bench/web-bench.mjs`、`src/bench/sample-tree.ps1`、`benchmarks/`
- **产出**:
  - `web-bench.mjs`(Playwright 驱动,`--scenario` 参数)
  - `sample-tree.ps1`(递归采样进程树 RSS/CPU)
  - `benchmarks/environment.md`(本机实测数据)
  - `benchmarks/results.csv`(表头 + 一次空载基线)
- **验收**:`node src/bench/web-bench.mjs --scenario open --fixture 100kb` 产出 CSV 行

---

## Phase 1 — M0 验证与 ADR 冻结

> **前置已满足**：本机 Rust / Cargo 与 MSVC 可用，本轮未安装工具链。以下勾选表示任务产出及调查完成；不把性能未达标或 M1 待实现能力记为通过。

### T08 安装 Rust 工具链与 MSVC(需授权)

- [x] **位置**:系统环境；复核已有安装，无新增安装。
- **步骤**:见 `11-build-and-release.md` §1.1
- **验收**:新终端中 `rustc --version` ≥ 1.90、`cargo --version` 正常;`cargo install tauri-cli --version "^2"` 可选(也可用 pnpm 侧的 `@tauri-apps/cli`)

### T09 建立 Tauri host crate 并验证目录定位

- [x] **位置**:`src/host/**`
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

- [x] **位置**:`src/host/src/commands.rs`、`src/host/src/documents.rs`(最小版)
- **产出**:`read_document` 命令返回原始字节;前端 `new Uint8Array(buf)`
- **验收**:
  - 50 MB 文件读取成功,前端 `byteLength` 正确
  - 记录读取耗时与内存到 `benchmarks/findings.md`
  - 若 `Response` → `ArrayBuffer` 不工作 → 退化为 base64 并写 ADR-005

**本轮结果**：四档真实 ArrayBuffer 类型与字节数正确，未触发 base64 回退。读取耗时已记录；读取阶段的原生 RSS 峰未采集，事后 idle 的 RSS 不作替代。

### T11 最小 ReaderView(主渲染链路)

- [x] **位置**:`src/ui/src/reader/**`
- **产出**:
  - `ReaderView.vue`(容器 + `innerHTML` + 事件委托骨架)
  - `renderInto.ts`
  - Mermaid 懒渲染(`IntersectionObserver` + 并发 2 + 超时 5 s)
  - 批量资源解析调用(`resolve_assets` 前端部分)
- **验收**:7 个 fixture 在 Tauri 窗口内全部正确显示;Mermaid 错误块不拖垮全文

### T12 CJK 锚点与 TOC 高亮

- [x] **位置**:`core/markdown/slug.ts`、`app/Sidebar.vue`
- **验收**:`cjk-typography.md` 中文标题有 id;点击 TOC 可滚动;滚动时高亮跟随;`[跳转](#中文锚点)` 可用

### T13 双主题切换(不重解析)

- [x] **位置**:`core/theme/**`、`styles/**`
- **产出**:2 套 App Theme + 3 套 Markdown Theme + Shiki 双主题变量 + Mermaid 主题映射
- **验收**:切换主题时 `parseMs` 不增加(用 `performance.mark` 证明);视觉检查通过

### T14 Qt 受限对照原型(PySide6)

- [—] **用户于 2026-11-04 确认跳过 T14，仅验证 Web 主线。** 不安装 Qt；已有实验代码保留，不计作运行或性能验收。
- **位置**:`src/experiments/qt-renderer/**`、`src/bench/qt-bench.py`
- **产出**:最小 Qt 应用:打开文件、`QTextDocument` 渲染、滚动、搜索、目录、浅/深配色、相对图片
- **验收**:
  - 同夹具的功能缺口表(逐项标注「不支持」)
  - 首屏时间、内存、CPU 记录
  - **不实现** Mermaid/KaTeX/Alerts(明确记录为缺失)

### T15 统一性能与可靠性测试

- [x] **位置**:`src/bench/**`、`benchmarks/results.csv`
- **内容**:
  - 100 KB / 1 MB / 10 MB / 50 MB
  - 100 图表、长代码、公式密集
  - 10/30/100 文档打开/切换/关闭
  - 真实文件监听(直接覆写、临时文件替换、连续保存)
  - 删除/替换/错误 Mermaid/缺失图片容错
  - 进程树 RSS/CPU(含 WebView2 子进程)
- **验收**:`results.csv` 完整;无法完成的项记录原因

**本轮结果**：CSV 34 行（含保留的失败行），浏览器矩阵 / 特殊夹具 / 50 轮生命周期 / 主题与原生 IPC / idle 已测。真实 watcher、多标签及原生端到端性能尚缺；原因见 [findings.md](../../benchmarks/findings.md)。AC-10 空闲 CPU 与大文档交互目标未通过，不能解释为产品性能验收完成。

### T16 写 ADR-001/002/003

- [x] **位置**:`docs/decisions/`
- **产出**:
  - `ADR-001-renderer-and-host.md`:正式 Renderer / Parser / Host 冻结,含被弃方案理由
  - `ADR-002-style-isolation.md`:命名空间 vs Shadow DOM 的最终选择(附实测)
  - `ADR-003-performance-thresholds.md`:量化阈值(含大文件分段阈值、缓存预算、去抖时长)
- **验收**:三项决策明确、有数据支撑、列出 M1 需补足的能力

**本轮结果**：三份决策文档已写入；状态为 Proposed，供负责人审阅。工程初值与性能承诺分列，不将未通过的测量冻结为达标承诺。

---

## Phase 2 — M1(全部 P0)

**2026-11-07 M1 推进补充：** 已补多编码、语义锚点、窗口状态、单实例、HTML LRU、长文档分段和跨段搜索。最新证据与逐项状态见 [M1 验收记录](../dev/m1-acceptance.md)；前端 338 / Rust 48 / 浏览器 65 项通过。首块提前显示和原生性能门槛尚未全部完成。用户确认本轮交付免安装版，NSIS 安装包与文件关联后续验收；下方未通过的退出条件不因程序已构建而自动勾选。

### T17 DocumentRegistry 全链路

- [x] **位置**:`src/host/src/documents.rs`
- **验收**:`cargo test` 覆盖幂等 open、close 幂等、版本递增、路径去重
- **本轮结果**：路径 / 标识注册、单调版本、读取前后核对、删除重建与释放已实现；包含在 37 项 Rust 测试中。多编码与缓存预算仍由 T18 / T28 跟踪。

### T18 编码探测

- [x] **位置**:`src/host/src/encoding.rs`、`documents.rs`
- **验收**:单测覆盖 UTF-8/8-BOM/16LE/16BE/GB18030/ASCII/空文件/二进制垃圾
- **本轮结果**：标签探测、BOM、非法字节 / 二进制拒绝与原始字节契约已实现。前端首次读取和刷新均核对编码与版本稳定性；猜测编码仍有启发式限制，不能保证任意无 BOM 文本识别。

### T19 path_guard

- [x] **位置**:`src/host/src/documents.rs`、`folders.rs`、`links.rs`
- **验收**:单测覆盖 `..` 逃逸、symlink 逃逸、绝对路径、`C:\docs-evil` 前缀陷阱、NUL、超长
- **本轮结果**：路径 canonicalize 后按组件判定边界，控制字符 / 超长 / 越界 / junction 等在实际宿主测试中拒绝；目录枚举与资源授权分离。

### T20 url_policy

- [x] **位置**:`src/host/src/links.rs`
- **验收**:单测覆盖 7 种 scheme + CRLF 注入
- **本轮结果**：外链白名单、控制字符 / mail header 注入和危险本地目标拒绝；前端委托不让应用顶层导航离开。

### T21 watcher 服务

- [x] **位置**:`src/host/src/watcher.rs`
- **验收**:集成测试通过(直接覆写 / rename 覆盖 / 删除 / 连续 20 次写入 / 目录复用 / 关闭后无事件)
- **本轮结果**：父目录非递归监听、120 ms 去抖、目录复用与关闭释放通过真实临时文件测试；发布程序验证覆写 / 替换 / 删除 / 重建，以及连续 20 次保存后最终正文可见。

### T22 事件发射与版本化

- [x] **位置**:`src/host/src/lib.rs`、`watcher.rs`、`documents.rs`
- **验收**:前端收到 `doc:changed` 且 version 单调递增
- **本轮结果**：`doc:changed` / `doc:gone` 接入会话；原生覆写、替换、删除和重建过程中成功读入版本依次为 1 / 2 / 3 / 5，删除事件位于重建之前。

### T23 jobQueue 代次守卫

- [x] **当前实现位置**:`src/ui/src/core/documents/session.ts`、`core/render/client.ts`
- **验收**:单测:旧 generation 结果被丢弃;同文档任务替换;串行执行
- **本轮结果**：单 Worker 串行、同文档待处理任务替换、关闭 / 旧代次结果丢弃已有回归；逻辑取消不等于中断正在执行的同步 tokenize。

### T24 parse.worker 完整管线

- [ ] **位置**:`src/ui/src/workers/parse.worker.ts`
- **验收**:7 个 fixture 的 golden HTML 快照通过;Worker 内 Shiki 单例复用

### T24b 链接点击跳转(FR-019)

- [~] **当前实现位置**:`src/host/src/links.rs`、`commands.rs`、`src/ui/src/reader/links.ts`、`ReaderView.vue`、`core/documents/session.ts`
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

**本轮结果**：五类宿主判定、系统打开命令、普通 / 修饰键 / 中键、后台标签、跨文档中文锚点、失败提示及清理已接入。`name` 锚点降级、闪烁反馈、悬停 / 键盘焦点目标提示现已实现；宿主边界、前端分发和实际浏览器导航回归通过。自动测试不实际启动外部浏览器和附件程序，此人工项仍保留。

### T24c 多标签界面(FR-020)

- [~] **当前实现位置**:`src/ui/src/app/DocumentTabs.vue`、`src/ui/src/core/documents/session.ts`、`src/ui/src/App.vue`、`src/ui/src/reader/ReaderView.vue`；完整功能按需从现有会话与组件拆分，不重复建立标签状态。
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
  - E2E-29:切回标签时解析调用计数 `parseCount` 不增加
  - 打开 20 标签标签栏可溢出访问,60 fps

**当前范围与状态**：基础打开 / 切换 / 关闭、路径去重、各标签阅读 / 搜索状态、多选 / 拖入 / argv、最近关闭、拖动重排、右键批量关闭、过滤溢出列表、Ctrl+PageUp/Down、跨启动恢复与 watcher 状态均已实现。语义锚点和 LRU 已完成单测 / 浏览器 / 原生集成验证；100 标签下已缓存切换不重解析，逐出后重开恰好解析一次。60 fps 与真实输入 / 标签切换 P95 尚未测全，因此不把本组 scroll→rAF 结果替代此量化目标。

### T24d 目录浏览与工作台(FR-021)

- [~] **位置**:`src/host/src/folders.rs`、`src/host/src/commands.rs`、`src/ui/src/core/ipc/workspaceBridge.ts`、`src/ui/src/app/{ActivityBar,ExplorerPanel,SearchPanel}.vue`、`src/ui/src/App.vue`
- **产出**:
  - 可选打开真实文件夹，根目录 registry 仅授权只读枚举；子目录逐层按需列举，提供排序、加载 / 空 / 错误 / 截断 / 重试反馈。
  - Markdown 点击进入 T24c 会话，已有路径激活对应标签；不支持预览的文件置灰；突出当前文档。
  - 文件 / 搜索 / 大纲同级活动栏，侧栏收起 / 调宽，面板切换保留目录展开状态，更换根目录保留已开标签。
  - 目录越界、符号链接 / junction 与失效根目录拒绝；枚举不递归授予 asset scope，图片仍逐文件授权。
- **验收**:需求 AC-20..22 与工作台集成用例通过；宿主安全 / 懒枚举测试、前端单测 / 类型 / 静态检查、E2E、release 构建和原生功能复验结果写入 [UX 执行记录](../dev/ux-workbench-progress.md)。
- **本轮状态**:基本目录 bridge、真实目录懒枚举、同级活动栏、可伸缩侧栏、当前正文搜索与标签集成已实现；前端 225 项、Rust 30 项、浏览器 17 项、release 构建及原生功能报告通过。原生选择器人工点击因桌面工具访问限制未实测，详见 UX 执行记录；自动 watcher 不在该切片内。

### T25 消毒策略与按需消毒

- [ ] **位置**:`src/ui/src/core/sanitize/policy.ts`
- **验收**:`html-safety.md` 零脚本执行;`extended.md` 的 `.katex` 元素数量 > 0;`hasRawHtml=false` 时 DOMPurify 未被调用(用 spy 断言)

### T26 Asset 授权与图片管线

- [ ] **位置**:`src/host/src/commands/assets.rs`、前端 `assetUrl.ts`
- **验收**:相对图片显示;目录外文件被拒;100 张图 1 次批量 IPC

### T27 链接解析与点击委托 → **已并入 T24b**

- 原 T27 的「链接解析与点击委托」内容已完整移入 **T24b**(含 Rust `resolve_link`、前端 `bindLinks`、`scrollToAnchor`、跨文档锚点)。此处保留编号占位,避免与既有引用冲突。

### T28 多标签与内存预算 → 标签 UI 部分见 **T24c**,本任务只保留内存预算

- [x] **位置**:`src/ui/src/core/documents/budget.ts`、`session.ts`、`core/render/segmentStore.ts`
- **验收**:打开 30 文件 RSS 受控;LRU 逐出顺序正确;活动标签不被逐出;逐出后切回能自动重解析
- **状态说明**:已实现 48 MiB UTF-8 HTML 配额和非活动 LRU，10 / 30 / 100 会话回归通过；活动结果超预算时转 IndexedDB 分段临时存储，关闭 / 逐出释放。真实多标签进程树数据独立记录，不把 HTML 配额当 RSS 上限。

### T29 滚动位置锚定与恢复

- [x] **位置**:`reader/scrollAnchor.ts`、`reader/ReaderView.vue` 与 `core/documents/session.ts`
- **验收**:E2E-10 通过(±5%);内容变化后回落最近前置行
- **状态说明**:保存文本 / 标题 / 源码行 / 段内比例，更新前插入内容仍定位原段落，无法匹配时回退；分段占位不能产生伪锚点，回到顶部立即切标签清除旧锚点。相关单测与浏览器回归通过。

### T30 TOC 侧栏与滚动高亮

- [~] **位置**:`app/Sidebar.vue`、`App.vue`；独立“大纲”活动入口与文件 / 搜索同级
- **验收**:E2E-03 通过
- **状态说明**:活动标签大纲、章节定位与滚动高亮已有基础实现；最终工作台回归见本轮执行记录。

### T31 正文搜索

- [~] **位置**:`reader/search.ts`、`reader/ReaderView.vue`、`app/SearchPanel.vue`
- **验收**:E2E-09 通过;`CSS.highlights` 不可用时降级路径可用;无残留高亮
- **状态说明**:已有当前正文匹配 / 计数 / 上下条导航及 Highlight API / 文本片段降级，避免改写脚本 / 公式 / SVG。2026-11-07完成每标签查询/匹配序号恢复，重建高亮不抢走阅读位置；完整搜索选项与长文档性能验收尚未完成。

### T32 完整双主题样式

- [ ] **位置**:`styles/**`
- **验收**:18 张视觉基准图通过;隔离性用例通过

### T33 设置持久化

- [x] **位置**:`src/ui/src/core/documents/workspaceState.ts`、`core/ipc/stateBridge.ts`、`App.vue`、`src/host/src/workspace.rs`
- **验收**:重启后主题/字号/窗格/最近文件/会话恢复
- **本轮结果**：复用 Rust 文件能力，不安装 store 插件。主题、字号、侧栏、根目录、最近文件、标签顺序 / 活动项 / 阅读和搜索状态以版本化 JSON 保存；原子替换、串行写、关闭前刷新、损坏回退与失败文件跳过已接入。浏览器重载恢复及原生隔离目录的实际保存 / 读取通过；窗口几何仍属 T34。

### T34 窗口状态恢复

- [x] **位置**:`src/host/src/desktop.rs`；复用现有依赖，不安装插件
- **验收**:重启后位置尺寸一致
- **本轮结果**：位置 / 尺寸 / 最大化、屏幕边界回退、事件合并保存与关闭刷新已实现；原生正常 / 最大化复验及限制见验收记录。

### T35 单实例与启动参数

- [x] **位置**:`src/host/src/instance.rs`、`lib.rs`、前端 `incomingFiles.ts`
- **验收**:第二次双击 `.md` 在现有窗口新开标签并聚焦;`app.exe "x.md"` 可打开
- **本轮结果**：当前用户受限命名管道、启动前排队、串行文件接入；10 路并发、截断 / 停滞客户端和超时恢复通过。系统关联的双击入口按用户决定后置。

### T36 错误容错 UI

- [x] **位置**:`app/ErrorBanner.vue`、`reader/**`
- **验收**:AC-09 三种场景有可理解反馈,应用不崩

### T37 错误码文案与日志

- [x] **位置**:`src/host/src/error.rs` / `diagnostics.rs`、前端会话错误提示
- **验收**:每个错误码有中文文案;日志文件可按 commit 追踪
- **本轮结果**：有限大小日志含构建标识和阶段 / 错误码，不记录正文或文档路径；日志轮转测试通过。

### T38 诊断面板

- [x] **位置**:`app/WorkbenchStatusbar.vue`、`get_env_info` 命令
- **验收**:显示 WebView 版本、Rust 版本、Tauri 版本、字体、缩放
- **本轮结果**：底部 / 帮助入口，中文字段、实际字体与显示比例、构建标识 / 时间均已接入；类型 / 组件 / 浏览器与原生返回验证通过。

### T39 超大文档分段模式

- [~] **位置**:`core/markdown/segment.ts`、`reader/segments.ts`、`segmentSearch.ts`
- **验收**:10 MB 首屏达标;50 MB 不崩溃;阈值来自 ADR-003
- **本轮结果**：平衡结构分段、当前相邻驻留、远段等高占位、跨段搜索 / 锚点和图表累计遍历已实现；50 MB 原生可打开。首块提前返回仍缺，首屏目标未通过，不能勾选完整性能验收。

### T40 完整 E2E 套件

- [x] **位置**:`src/ui/tests/e2e/**`
- **验收**:E2E-01..E2E-20 全绿
- **本轮结果**：当前 65 项浏览器回归全绿，覆盖阅读 / 文件树 / 链接 / 标签 / 更新 / 恢复 / 大文档 / 双主题；系统安装、外部程序启动和原生资源仍单独验收。

### T41 手工验收一轮

- [ ] **位置**:`docs/dev/manual-qa.md`
- **验收**:AC-01..AC-22 逐条验收；工作台切片不代替未完成的 watcher、完整标签与性能验收

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

**Git 后续规划**：在阅读工作台稳定后考虑仓库状态、变更列表、差异查看；提交与同步范围待定。本轮没有 Git 功能实现或 Git 写操作，不新增占位按钮。

---

## 任务统计

| 阶段 | 任务数 | 说明 | 阻塞项 |
|---|---|---|---|
| Phase 0 | 7 | T01–T07 | 无 |
| Phase 1 | 9 | T08–T16；T14 按用户决定跳过 | Rust 已可用，无需新增安装；M0 性能缺口保留 |
| Phase 2 | 26 主任务 + 3 插入任务 | T17–T42；另有 T24b 链接、T24c 多标签、T24d 目录浏览 | 完整 M1 门槛保留，本轮提前推进 UX 切片 |
| Phase 3 | 7 | T43–T49 | 依赖 M1 发布 |
| Phase 4 | 4 | T50–T53 | 按需 |
| **合计** | **53 个主任务 + 3 个插入任务** | T24b/T24c/T24d 为 T24 之后的插入任务,不改变主编号；T27 保留占位 | |

> 编号策略:`T24b`、`T24c`、`T24d` 分别对应 FR-019 / FR-020 / FR-021，插入在 T24 之后以保持既有编号稳定；`T27` 内容已并入 `T24b` 并保留占位。后续插入继续采用「主编号 + 字母后缀」，不重排全文编号。

---

## 里程碑验收门槛

### M0 退出条件(对应需求文档 M0 完成定义；按本轮授权调整 Qt 范围)

- [ ] `T09`–`T15` 验收收口（T14 已取消；性能未通过与测量缺口须保留）
- [x] Web 主线原型可运行并有运行说明；Qt 按用户决定跳过，不作宿主性能排名
- [x] 一套可复现的 Markdown 测试样本
- [x] 性能测量记录(`benchmarks/results.csv`)
- [x] 功能差异与资源结论(`benchmarks/findings.md`，包含未测与未达标项)
- [x] ADR-001/002/003 已写入 `docs/decisions/`（Proposed）
- [x] M1 的工程任务清单(本文 Phase 2)；M0 阶段未开始执行，后续已按用户授权推进阅读工作台 UX 切片

**当前结论**：技术原型及调查文档已有产出；完整性能门槛尚未通过，ADR 尚待负责人批准。不将本轮记录称为完整产品验收。

### M1 退出条件

- [ ] 全部 P0 功能(FR-001..FR-011、**FR-019**、**FR-020**、**FR-021**)
- [ ] AC-01..AC-22 通过
- [x] 不进入编辑模式即可完成「打开—阅读—外部修改—自动刷新—继续阅读」闭环
- [x] 可通过正文链接在标签间跳转,且外链不会使应用界面流失
- [x] 多标签可承载日常对照阅读(≥20 标签),切换不重新解析未变化且未被预算逐出的内容
- [x] 可从真实目录只读按需浏览并进入标签；文件 / 搜索 / 大纲为同级可伸缩侧栏入口
- [ ] 性能阈值按 ADR-003 验收
- [x] 已覆盖的文件 / 图片 / 图表 / 状态损坏错误场景不导致崩溃
