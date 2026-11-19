# Cyperus

一款 **Preview-first（预览优先）** 的本地 Markdown 桌面阅读器：默认阅读渲染后的内容，源码编辑、关联文件浏览和外部应用打开作为便捷功能。

> 定位：像 PDF 阅读器一样打开 Markdown。不以替代 VS Code / Typora / Obsidian 为目标。

---

## 当前状态

整体交付顺序为 **Code OSS 集成 → VSIX 验证 → 精简独立版**；各阶段交付物、验收与体积口径见 [Cyperus 目标与里程碑](docs/dev/cyperus-milestones.md)。

**当前试用版为 Cyperus Windows 免安装版，目录约 500 MB。** 在 [Cyperus 目录](dist/Cyperus-Windows-x64-20261118-bilingual) 双击 `Cyperus.exe`。无需项目源码或本机 Node，用户数据保存在相邻 `data/`。此前 [RC2 ZIP](dist/Markdown-Reader-CodeOSS-Windows-x64-20261112-rc2.zip) 保留作历史候选，Tauri 保留作备选。

界面语言从命令面板的「Configure Display Language／配置显示语言」选择 English 或简体中文，重启后生效，无需扩展市场。源码编辑时使用原生状态栏控件，正文主题仍可从命令面板切换。

Markdown 和静态 HTML 默认预览，目录、搜索和标签复用原生工作台。Markdown 大纲可以在阅读和源码编辑中跳转。源码切换、外部打开及文件夹定位放在标签栏右侧。RC4 裁掉 Restricted Mode 的交互、Agents 窗口、Tree-sitter、内置终端的本地进程和部分开发命令。基础编辑继续用 TextMate 着色。当前为未签名候选，最新实施范围、验证证据与遗留项见 [Code OSS 首版计划](docs/dev/code-oss-first-version-plan.md)，构建与启动见 [Code OSS 阅读器说明](src/experiments/code-oss-reader/README.md)。

### 此前 Tauri M1 基线（保留）

**Tauri + Vue 已接通主要阅读流程，作为既有基线保留。** 已具备文件 / 搜索 / 大纲同级活动栏、目录浏览、多标签、正文搜索、跨文档链接、真实文件监听和设置 / 会话恢复。标签支持拖动重排、右键批量关闭、溢出列表与最近关闭恢复；缓存切换保留阅读和搜索状态。外部保存自动刷新，删除时保留旧正文，重新创建后恢复。原生打开、独立双主题、数学 / 高亮 / 图表与本地图片继续保留。

2026-11-07 继续推进 M1：已补齐多编码读取、语义阅读位置、窗口恢复、单实例转发、48 MiB HTML LRU 与大文档分段 / 跨段搜索。338 项前端单测、48 项 Rust 测试、65 项浏览器测试通过；发布程序的普通 / 最大化恢复、单实例、三种中文编码、连续保存、100 标签与 50 轮回收验证通过。原首屏 / 空闲 CPU 等性能目标仍有未通过项，首块提前显示尚未实现。用户确认本轮交付免安装版，安装包及系统文件关联留待后续。

本轮交付：[Windows x64 免安装压缩包](dist/Markdown-Preview-M1-Windows-x64-20261107.zip)，解压后运行 `md-preview.exe`，内含使用说明与构建校验信息。完整 M1 的未通过门槛见验收记录，不把本轮交付等同于全部性能目标达标。

| 阶段 | 状态 |
|---|---|
| 需求基线 v0.4 修订（FR-001..021 / NFR-001..013 / AC-01..22） | 已纳入用户确认的目录浏览 P0 与工作台布局 |
| 实现方案与核对（00–18） | 已补充工作台、UI设计基线、源码规格核对及 Code OSS 备选备案，完整规格不等于已实现 |
| 任务分解（53 主任务 + T24b/T24c/T24d） | 保持既有编号，按执行记录区分完成与后续 |
| M1 本轮交付 | 免安装版与核心功能验证完成，最新证据见 M1 验收记录 |
| M1 全部门槛 | 性能目标仍有缺口；安装关联按用户要求后续 |
| M0 技术验证 | 测量与 ADR 草稿已落盘；仍有性能未达标和未测项 |
| Qt 对照 T14 | 用户确认跳过，不安装 Qt |

当前阶段、逐项结论与发布证据见 [M1 验收记录](docs/dev/m1-acceptance.md) 和 [M1 执行计划](docs/dev/m1-completion-plan.md)。[阅读流程完整性记录](docs/dev/reader-completion-plan.md)、[UX 执行记录](docs/dev/ux-workbench-progress.md)、[M0 执行记录](docs/dev/m0-progress.md) 与 [测试结论](benchmarks/findings.md) 保留历史测量，不代表最新完整验收。

2026-11-05 已按用户要求重做 VS Code 工作台结构：独立标题栏、第二行菜单、打开编辑器与目录分组、连续标签和平面正文；路径、其他状态和双主题切换统一置于底部状态栏。新版程序、深浅色及窄窗预览与验证见 [工作台重做记录](docs/dev/vscode-workbench-plan.md)。此前蓝灰卡片方案仅保留为历史。

2026-11-06按 [UI设计基线](docs/design/16-ui-design-draft.md) 落实白紫浅色默认与控件细节：24px树行、15/24px正文、标签关闭焦点、搜索焦点、窄窗侧栏约束和长路径文件名保留；深色及纸张主题仍可独立切换。

同日按用户提供的VS Code截图细化表面层次，再按已确认的历史版参考统一边距：深灰活动栏、浅灰文件侧栏、白色内容面与紫色整条状态栏连续直角拼接，外边距0；文件行22px，正文上16/左右26px、普通块间距16px。统一图标基线、选中/焦点与板块内留白。

用户随后采用新的历史菜单截图：当前顶部为30px单行，左侧图标和菜单、中间标题、右侧窗口按钮；菜单采用紧凑直角、整行选中。用户确认活动栏保留左侧，默认白紫浅色与底部双主题沿用。该结构覆盖此前独立标题/第二行菜单方案，当前验证见工作台重做记录顶部。

最新 [源码规格与体感核对](docs/design/17-vscode-spec-audit.md) 已按用户补充改为VS Code 1.145.1稳定版，区分新版源码、布局模式、主题覆盖及本项目适配；沿用同日上一轮的边距实测与菜单双高亮证据。本次仅更新规格参考，后续修正和原生缩放验收尚未完成。

2026-11-07用户要求优先继续功能，UI展示效果后置。本轮完成每标签搜索上下文、Ctrl+Shift+T及文件菜单恢复最近关闭文档（最多15条、会话内有效），并统一菜单鼠标/键盘活动项。颜色与几何未调整；验证及剩余功能见 [功能推进记录](docs/dev/functional-progress-plan.md)。

同日先补充 [Code OSS 方案](docs/design/18-code-oss-alternative.md)，随后完成独立宿主试验与性能对照，用户最终选择 Code OSS 作为首版主线；历史备案内容按当时状态保留。

同日继续完成阅读流程：Rust 接通链接判定与系统打开、父目录文件监听、版本化读取和本地状态保存；前端接通链接 / 刷新 / 会话恢复 / 标签管理。最终前端单测 284 项、Rust 37 项、浏览器 42 项通过，发布构建及真实桌面文件修改 / 替换 / 删除 / 重建验证通过。详情、验证边界和程序信息见 [阅读流程完整性记录](docs/dev/reader-completion-plan.md)。

---

## 文档

### 需求

- [`docs/requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md`](docs/requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md)
  产品定位、使用场景、功能与非功能需求、性能测试矩阵、技术方案、里程碑、验收用例。

### 设计

从 [`docs/design/README.md`](docs/design/README.md) 开始。

| # | 文档 | 内容 |
|---|---|---|
| 00 | [总体架构](docs/design/00-architecture.md) | 技术栈版本锁定、目录布局、分层依赖规则、进程/线程模型 |
| 01 | [渲染管线](docs/design/01-render-pipeline.md) | markdown-it 配置、插件链、token 增强、Worker 契约、消毒策略 |
| 02 | [文档生命周期](docs/design/02-document-lifecycle.md) | Registry、版本号、编码探测、标签状态、内存预算 |
| 03 | [实时刷新](docs/design/03-live-reload.md) | 父目录监听、去抖、代次守卫、位置保持 |
| 04 | [资源与链接](docs/design/04-assets-and-links.md) | 路径守卫、asset 授权、CSP、批量解析 |
| 05 | [双主题](docs/design/05-themes.md) | App Theme / Markdown Theme 隔离与变量契约 |
| 06 | [安全模型](docs/design/06-security.md) | 信任边界、攻击面对策、capabilities、供应链 |
| 07 | [IPC 契约](docs/design/07-ipc-contract.md) | 命令、DTO、错误码、事件、大文件传输 |
| 08 | [性能与资源](docs/design/08-performance.md) | 性能预算、调度器、大文件分段、内存管理 |
| 09 | [测试策略](docs/design/09-testing.md) | 测试金字塔、golden HTML、E2E、盲区 |
| 10 | [界面与导航](docs/design/10-ui-and-navigation.md) | 工作台布局、文件 / 搜索 / 大纲、快捷键、无障碍 |
| 11 | [构建与发布](docs/design/11-build-and-release.md) | 环境要求、Tauri 配置、体积预算、发布检查 |
| 12 | [实施计划](docs/design/12-implementation-plan.md) | **53 个主任务 + 3 个插入任务**，分 Phase 0–4 |
| 13 | [多标签界面](docs/design/13-tabs.md) | FR-020：标签栏规格、交互、持久化、无障碍 |
| 14 | [链接跳转](docs/design/14-link-navigation.md) | FR-019：链接分类、分发、修饰键、跨文档锚点 |
| 15 | [阅读工作台 UX](docs/design/15-reader-workbench.md) | FR-021：同级活动栏、只读文件树、多标签与当前正文搜索 |
| 16 | [UI设计基线](docs/design/16-ui-design-draft.md) | 白紫浅色默认、工作台尺寸、组件状态与焦点规则 |
| 17 | [源码规格与体感核对](docs/design/17-vscode-spec-audit.md) | VS Code 1.145.1源值、边距实测、新版菜单差异与白紫配色适配 |
| 18 | [Code OSS 方案](docs/design/18-code-oss-alternative.md) | 首版已选路线；历史备案与迁移依据，当前范围见首版计划 |

### 决策记录

从 [`docs/decisions/README.md`](docs/decisions/README.md) 开始。

| 编号 | 标题 | 状态 |
|---|---|---|
| ADR-001 | [Renderer 与桌面架构选型](docs/decisions/ADR-001-renderer-and-host.md) | Proposed（已有实测依据） |
| ADR-002 | [Markdown 样式隔离方案](docs/decisions/ADR-002-style-isolation.md) | Proposed（完整视觉回归留 M1） |
| ADR-003 | [性能阈值与大文件策略](docs/decisions/ADR-003-performance-thresholds.md) | Proposed（区分初值与待验收目标） |
| ADR-004 | [源码目录布局](docs/decisions/ADR-004-source-layout.md) | Proposed（当前布局已构建验证） |
| ADR-005 | 大文件 IPC 传输方案 | 未触发 base64 回退；原始字节路径见 ADR-001 |

---

## 技术栈

首版宿主为 **Code OSS 1.145.1 / Electron 43.8.3**，工作台内部扩展接入现有 Vue 阅读组件及 Node 解析 Worker。以下 Tauri/Rust 配置是保留基线；两条宿主路线复用正文渲染核心。

```text
桌面宿主   Tauri 2.12.5 (Rust ≥ 1.90)
前端       Vue 3.5.44 + TypeScript 5.9.3 + Vite 8.3.5 + Pinia 4.1.0
包管理     pnpm 11.15
解析       markdown-it 15.0.3（单一主解析器）
扩展       脚注 / 锚点 / GitHub Alerts / 自研任务列表
数学       KaTeX 0.16.47
高亮       Shiki 4.5.0（双主题 CSS 变量）
图表       Mermaid 12.2.0（主线程懒渲染）
安全       DOMPurify 3.4.17（按需消毒）
文件监听   notify 8.2.1 + notify-debouncer-full 0.7.0（已接入父目录监听）
编码       M0 支持 UTF-8 / UTF-8 BOM；其他编码探测留 T18
```

---

## 目录结构

```text
.
├── docs/
│   ├── requirements/     需求基线
│   ├── design/           设计文档（00–18）
│   ├── decisions/        ADR
│   └── dev/              M0 与 UX 执行记录
├── fixtures/             Markdown 测试夹具
├── benchmarks/           基准结果记录
└── src/                  ★ 所有源码
    ├── host/             Tauri 2 Rust crate
    ├── ui/               Vue 3 + Vite 前端（pnpm workspace 成员）
    ├── bench/            基准与夹具生成脚本
    └── experiments/      Qt 对照代码（本轮跳过，未安装 Qt）
```

> **关于双层 `src`**：Cargo 硬性要求 crate 根目录下存在 `src/`，因此 `src/host/` 下的 Rust 源码路径必然是 `src/host/src/main.rs`；前端同理为 `src/ui/src/`。这是 Cargo / Vite 规范的结果，详见 [ADR-004](docs/decisions/ADR-004-source-layout.md)。

---

## 开发环境

### 要求

| 项 | 版本 | 本机实测 |
|---|---|---|
| Node.js | `^20.19 \|\| >=22.12` | 24.15.0 ✅ |
| pnpm | 11.x | 11.15.0 ✅ |
| Rust / Cargo | ≥ 1.90 | 1.99.1 ✅ |
| MSVC C++ 工具集 | 2019+ | 已装 ✅ |
| Windows SDK | 10/11 | 11 SDK 26100 ✅ |
| WebView2 Runtime | 现代版本 | 原生探针 156.0.4314.58 ✅ |

### Windows 注意事项

PowerShell 下使用 `.cmd` 入口，避免触发 `.ps1` shim；无需修改执行策略：

```powershell
pnpm.cmd ui:dev
```

### 常用命令

```powershell
pnpm.cmd ui:dev                       # 前端开发服务器（端口 1420）
pnpm.cmd ui:build                     # 构建前端
pnpm.cmd ui:typecheck                 # 类型检查
pnpm.cmd ui:test                      # 单元测试
pnpm.cmd e2e                         # 浏览器回归（需已有 Chromium）
pnpm.cmd lint:ci                      # 只读检查
cargo test --manifest-path src/host/Cargo.toml --offline
node --test src/bench/*.test.mjs       # 基准与夹具生成器测试
pnpm.cmd app:dev                      # Tauri 开发
pnpm.cmd tauri build --no-bundle       # 本地 release EXE，不生成安装包
node src/bench/web-bench.mjs --scenario open --fixture 100kb
```

---

## 核心设计取舍

1. **解析永远在 Web Worker**，主线程只做 DOM 插入、Mermaid、搜索、滚动；非活动标签不保留 DOM。
2. **原始 HTML 按需消毒**：token 流检测 `hasRawHtml`，无原始 HTML 时完全跳过 DOMPurify（零成本）。
3. **实时刷新监听父目录**，兼容编辑器「临时文件 + rename 覆盖」的保存方式；宿主版本和前端代次守卫防止过期结果覆盖新正文。
4. **asset 协议逐文件运行期授权**，先校验文档目录边界与链接，静态 `scope: []`，不递归开放目录。
5. **样式隔离用命名空间而非 Shadow DOM**：搜索高亮（`CSS.highlights` + `Range`）、Mermaid 渲染与尺寸测量在 Shadow DOM 下都要改造，收益不抵成本。
6. **文件浏览为可选入口**：不要求先创建项目；文件 / 搜索 / 大纲同级，文件树只读按需枚举，不扩大图片资源权限。

---

## 明确不做

- 不以专业 Markdown 编辑器为目标，不做 IDE / 智能补全 / 协同编辑。
- 不强制管理工作区、知识库、账户。
- 不并行维护两套正式渲染器；Qt 对照已按本轮决定跳过。
- 不做虚拟滚动、插件市场、云同步。
- 不承诺所有 Markdown 方言 100% 兼容。
- 未实测前不承诺大文件、多标签的固定响应时间与内存上限。

Git 留后续规划：先考虑仓库状态、变更列表、差异查看；提交与同步范围待定，当前没有 Git 功能。

---

## 协作约定

见 [`AGENTS.md`](AGENTS.md)：未经明确确认不执行写操作。

---

## 许可证

待定。
