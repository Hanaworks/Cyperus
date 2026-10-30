# Markdown 本地预览应用

一款 **Preview-first（预览优先）** 的本地 Markdown 桌面阅读器：双击 `.md` 文件，直接阅读渲染后的内容，不进入编辑器、不需要工作区。

> 定位：像 PDF 阅读器一样打开 Markdown。不以替代 VS Code / Typora / Obsidian 为目标。

---

## 当前状态

**设计阶段已完成，即将进入实现。**

| 阶段 | 状态 |
|---|---|
| 需求基线 v0.4（FR-001..020 / NFR-001..013 / AC-01..19） | ✅ 已确认 |
| 实现方案（14 篇设计文档） | ✅ 已完成 |
| 任务分解（53 主任务 + 2 插入任务） | ✅ 已完成 |
| 代码 | ⬜ 未开始 |
| M0 技术验证 | ⬜ 未开始 |

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
| 10 | [界面与导航](docs/design/10-ui-and-navigation.md) | 布局、TOC、搜索、快捷键、无障碍 |
| 11 | [构建与发布](docs/design/11-build-and-release.md) | 环境要求、Tauri 配置、体积预算、发布检查 |
| 12 | [实施计划](docs/design/12-implementation-plan.md) | **53 个任务**，分 Phase 0–4 |
| 13 | [多标签界面](docs/design/13-tabs.md) | FR-020：标签栏规格、交互、持久化、无障碍 |
| 14 | [链接跳转](docs/design/14-link-navigation.md) | FR-019：链接分类、分发、修饰键、跨文档锚点 |

### 决策记录

从 [`docs/decisions/README.md`](docs/decisions/README.md) 开始。

| 编号 | 标题 | 状态 |
|---|---|---|
| ADR-001 | Renderer 与桌面架构选型 | Pending（M0 结束） |
| ADR-002 | Markdown 样式隔离方案 | Pending（M0 结束） |
| ADR-003 | 性能阈值与大文件策略 | Pending（M0 结束） |
| ADR-004 | [源码目录布局](docs/decisions/ADR-004-source-layout.md) | **Accepted** |
| ADR-005 | 大文件 IPC 传输方案 | Pending（实测后） |

---

## 技术栈

```text
桌面宿主   Tauri 2.12.5 (Rust ≥ 1.90)
前端       Vue 3.5.44 + TypeScript 5.9.3 + Vite 8.3.5 + Pinia 4.1.0
包管理     pnpm 11.15
解析       markdown-it 15.0.3（单一主解析器）
扩展       脚注 / 锚点 / GitHub Alerts / 自研任务列表
数学       KaTeX 0.19.1
高亮       Shiki 4.5.0（双主题 CSS 变量）
图表       Mermaid 12.2.0（主线程懒渲染）
安全       DOMPurify 3.4.17（按需消毒）
文件监听   notify 8.2.1 + notify-debouncer-full 0.7.0
编码       chardetng 1.0 + encoding_rs 0.8.42
```

---

## 目录结构

```text
.
├── docs/
│   ├── requirements/     需求基线
│   ├── design/           设计文档（00–14）
│   └── decisions/        ADR
├── fixtures/             Markdown 测试夹具
├── benchmarks/           基准结果记录
└── src/                  ★ 所有源码
    ├── host/             Tauri 2 Rust crate
    ├── ui/               Vue 3 + Vite 前端（pnpm workspace 成员）
    ├── bench/            基准与夹具生成脚本
    └── experiments/      M0 Qt 对照原型（PySide6，不进入正式产品）
```

> **关于双层 `src`**：Cargo 硬性要求 crate 根目录下存在 `src/`，因此 `src/host/` 下的 Rust 源码路径必然是 `src/host/src/main.rs`；前端同理为 `src/ui/src/`。这是 Cargo / Vite 规范的结果，详见 [ADR-004](docs/decisions/ADR-004-source-layout.md)。

---

## 开发环境

### 要求

| 项 | 版本 | 本机实测 |
|---|---|---|
| Node.js | `^20.19 \|\| >=22.12` | 24.15.0 ✅ |
| pnpm | 11.x | 11.15.0 ✅ |
| Rust | ≥ 1.90 | 待安装 ⬜ |
| MSVC C++ 工具集 | 2019+ | 已装 ✅ |
| Windows SDK | 10/11 | 11 SDK 26100 ✅ |
| WebView2 Runtime | 现代版本 | 156.0.4314.50 ✅ |

### Windows 注意事项

**PowerShell 执行策略禁止 `.ps1` shim**，因此 pnpm / npm 必须经 `cmd /c` 调用：

```powershell
cmd /c "pnpm install"
cmd /c "pnpm ui:dev"
```

### 常用命令（规划）

```powershell
cmd /c "pnpm install"          # 安装依赖
cmd /c "pnpm ui:dev"           # 前端开发服务器（端口 1420）
cmd /c "pnpm ui:build"         # 构建前端
cmd /c "pnpm ui:typecheck"     # 类型检查
cmd /c "pnpm ui:test"          # 单元测试
cmd /c "pnpm app:dev"          # Tauri 开发（需 Rust）
cmd /c "pnpm app:build"        # 打包（需 Rust）
```

---

## 核心设计取舍

1. **解析永远在 Web Worker**，主线程只做 DOM 插入、Mermaid、搜索、滚动；非活动标签不保留 DOM。
2. **原始 HTML 按需消毒**：token 流检测 `hasRawHtml`，无原始 HTML 时完全跳过 DOMPurify（零成本）。
3. **监听父目录**而非文件本身，兼容编辑器「临时文件 + rename 覆盖」的保存方式；配合 `(mtime, size)` 版本号与前端代次守卫，杜绝旧结果覆盖新内容。
4. **asset 协议按文档目录运行期授权**，静态 `scope: []`，不开放整盘。
5. **样式隔离用命名空间而非 Shadow DOM**：搜索高亮（`CSS.highlights` + `Range`）、Mermaid 渲染与尺寸测量在 Shadow DOM 下都要改造，收益不抵成本。

---

## 明确不做

- 不以专业 Markdown 编辑器为目标，不做 IDE / 智能补全 / 协同编辑。
- 不强制管理工作区、知识库、账户。
- 不并行维护两套正式渲染器（Qt 仅作 M0 对照）。
- 不做虚拟滚动、插件市场、云同步。
- 不承诺所有 Markdown 方言 100% 兼容。
- 未实测前不承诺大文件、多标签的固定响应时间与内存上限。

---

## 协作约定

见 [`AGENTS.md`](AGENTS.md)：未经明确确认不执行写操作。

---

## 许可证

待定。
