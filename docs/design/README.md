# Markdown 本地预览应用 — 设计文档索引

> **当前主线（2026-11-07）：Code OSS 首版。** 用户确认以 Markdown 预览为核心，编辑/图片/外部工具等提供便利，Git 后续接入，Tauri 保留备选。实施范围以 [Code OSS 首版计划](../dev/code-oss-first-version-plan.md) 为准。下方 Tauri 主线及“Code OSS 仅备案”的段落保留为历史设计记录。

> 上游需求基线:[`docs/requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md`](../requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md)
> 本文档集把需求展开到**可直接实施的技术细节**,覆盖架构、渲染、文件生命周期、实时刷新、资源、主题、安全、IPC、性能、测试、UI、构建与任务分解。
> **状态**:设计与 ADR 仍为 `Proposed`；Web 主线已进入阅读工作台 UX 迭代。用户于 2026-11-04 确定 VS Code 式布局并要求继续推进，当前实现见 [UX 执行记录](../dev/ux-workbench-progress.md)。[M0 执行记录](../dev/m0-progress.md) 和 [测试结论](../../benchmarks/findings.md) 保留原未测与未达标项；性能专项后置，T14 继续跳过，不安装 Qt。

2026-11-07 更新：已接通前后端的链接跳转、文件监听与刷新、设置 / 会话恢复、标签重排 / 右键菜单 / 溢出列表；最新实现和验证以 [阅读流程完整性记录](../dev/reader-completion-plan.md) 为准。UI 展示效果与性能专项继续后置，Code OSS 方案仅备案。

---

## 阅读顺序

| # | 文档 | 内容 | 对应需求 |
|---|---|---|---|
| 00 | [`00-architecture.md`](./00-architecture.md) | 技术栈锁定(含版本)、目录布局、分层与依赖规则、进程/线程模型、端到端数据流 | 全局 |
| 01 | [`01-render-pipeline.md`](./01-render-pipeline.md) | markdown-it 配置、插件链、token 增强、Worker 契约、消毒策略、失败降级 | FR-002/003/004/005, NFR-001/009 |
| 02 | [`02-document-lifecycle.md`](./02-document-lifecycle.md) | DocumentRegistry、版本号、编码探测、标签状态、内存预算与 LRU、会话恢复 | FR-001/007, NFR-002/003/004 |
| 03 | [`03-live-reload.md`](./03-live-reload.md) | 父目录监听、去抖、重试、代次守卫、位置保持、文件删除、时序图 | FR-008/011 |
| 04 | [`04-assets-and-links.md`](./04-assets-and-links.md) | 路径守卫、符号链接、asset 授权、CSP、链接分类、远程资源策略 | FR-006, NFR-006/008 |
| 05 | [`05-themes.md`](./05-themes.md) | 双主题边界、隔离方案、CSS 变量契约、Shiki/Mermaid 主题映射、设置持久化 | FR-009/013 |
| 06 | [`06-security.md`](./06-security.md) | 信任边界、攻击面矩阵、capabilities、CSP、纵深防御、供应链、审计 | NFR-006, AC-11 |
| 07 | [`07-ipc-contract.md`](./07-ipc-contract.md) | 命令清单、DTO、错误码、事件、大内容传输、类型一致性保障 | 全局 |
| 08 | [`08-performance.md`](./08-performance.md) | 性能预算、调度器、首屏优先、大文件分段、内存管理、基准口径 | NFR-001..004 |
| 09 | [`09-testing.md`](./09-testing.md) | 测试金字塔、golden HTML、组件/E2E/视觉回归、Rust 单测与集成、盲区记录 | NFR-005/009 |
| 10 | [`10-ui-and-navigation.md`](./10-ui-and-navigation.md) | 工作台布局、文件 / 搜索 / 大纲、组件树、快捷键、状态栏、无障碍、拖放 | FR-010/012/021 |
| 11 | [`11-build-and-release.md`](./11-build-and-release.md) | 环境要求、`tauri.conf.json`、Vite 配置、体积预算、M0 对照、发布检查清单 | NFR-011/012 |
| 12 | [`12-implementation-plan.md`](./12-implementation-plan.md) | **53 个主任务 + T24b/T24c/T24d**,分 Phase 0–4,含依赖图与里程碑门槛 | §7 里程碑 |
| 13 | [`13-tabs.md`](./13-tabs.md) | 多标签栏:视觉规格、状态机、新建/切换/关闭/重排/溢出/右键菜单、恢复最近关闭、持久化、无障碍 | **FR-020**, FR-007, AC-16..19 |
| 14 | [`14-link-navigation.md`](./14-link-navigation.md) | 链接分类(Rust 唯一真源)、点击分发、修饰键语义、跨文档锚点、错误文案、分段模式下跨段跳转 | **FR-019**, FR-006, AC-13..15 |
| 15 | [`15-reader-workbench.md`](./15-reader-workbench.md) | VS Code 式活动栏、可伸缩侧栏、只读文件树、会话缓存与当前正文搜索；Git / 性能后置 | **FR-021**, FR-010/020, AC-20..22 |
| 16 | [`16-ui-design-draft.md`](./16-ui-design-draft.md) | 白紫浅色默认、工作台尺寸、阅读排版、组件状态与焦点规则；原型与实施分开记录 | FR-009/010/020/021 |
| 17 | [`17-vscode-spec-audit.md`](./17-vscode-spec-audit.md) | 固定VS Code 1.145.1源码、已有边距与操作实测、主题适配、差异与验收要求 | FR-009/010/020/021 |
| 18 | [`18-code-oss-alternative.md`](./18-code-oss-alternative.md) | Code OSS 派生产品备案：复用边界、只读阅读扩展、迁移、阶段验收与维护成本；未启用 | 全局备选，不替换当前主线 |

---

## 决策记录

见 [`../decisions/README.md`](../decisions/README.md)。

| 编号 | 标题 | 状态 |
|---|---|---|
| ADR-001 | [Markdown Renderer 与桌面架构选型](../decisions/ADR-001-renderer-and-host.md) | Proposed |
| ADR-002 | [Markdown 样式隔离方案](../decisions/ADR-002-style-isolation.md) | Proposed |
| ADR-003 | [性能阈值与大文件策略](../decisions/ADR-003-performance-thresholds.md) | Proposed |
| ADR-004 | 源码目录布局(`src/host` + `src/ui`) | **Proposed(待确认)** |
| ADR-005 | 大文件 IPC 传输方案 | 原始字节已实测，无 base64 回退；见 ADR-001 |

---

## 一页速览

### 技术栈

```text
Tauri 2.12.5 + Vue 3.5.44 + TypeScript 5.9.3 + Vite 8.3.5 + pnpm 11.15
markdown-it 15.0.3 + @shikijs/markdown-it 4.5.0 + mermaid 12.2.0
+ @vscode/markdown-it-katex 1.1.2 + dompurify 3.4.17
Rust: notify 8.2.1 + notify-debouncer-full 0.7.0 + chardetng 1.0 + encoding_rs 0.8.42
```

### 五个关键设计决定

1. **解析永远在 Web Worker**,主线程只做 DOM 插入、Mermaid、搜索、滚动。非活动标签不保留 DOM。
2. **原始 HTML 按需消毒**:token 流检测 `hasRawHtml`,无原始 HTML 则完全跳过 DOMPurify(零成本)。
3. **监听父目录**(非文件本身),兼容编辑器"临时文件 + rename 覆盖"的保存方式;配合 `(mtime, size)` 版本号与前端代次守卫,杜绝旧结果覆盖新内容。
4. **asset 协议逐文件运行期授权**(`allow_file`),先校验目录边界与链接，静态 `scope: []`,不递归授权目录。
5. **样式隔离用命名空间而非 Shadow DOM**,因为搜索高亮(`CSS.highlights` + `Range`)、Mermaid 渲染与尺寸测量在 Shadow DOM 下要全部改造,收益不抵成本。

### 三个 UI 骨架需求(P0)

- **多标签阅读(FR-020)**:顶部标签栏,新建/切换/关闭/重排/溢出/恢复最近关闭/跨会话持久化;切换已缓存标签**不重新解析**。见 `13-tabs.md`。
- **链接点击跳转(FR-019)**:所有链接可点击;按类型分流到锚点 / 新标签 / 系统程序 / 系统浏览器 / 拦截;分类判定唯一真源在 Rust,前端不自行判断。见 `14-link-navigation.md`。
- **目录浏览(FR-021)**:可选打开真实文件夹、只读按需展开、点击 Markdown 进入标签；文件 / 搜索 / 大纲为同级入口，大纲不塞到文件树底部。见 [阅读工作台](./15-reader-workbench.md)。

已具备标签打开 / 切换 / 关闭 / 重排 / 溢出访问、缓存、跨启动阅读和搜索状态恢复、目录懒枚举、链接跳转和真实 watcher。T24c 的完整量化验收、T28 LRU、语义位置锚定与多编码仍未完成。Git 仅后续规划仓库状态、变更列表与差异查看，提交 / 同步范围待定。

### 目录

```text
src/
├── host/        Tauri Rust crate(Cargo 要求 crate 内有 src/,故为 src/host/src/)
├── ui/          Vue + Vite 前端(故为 src/ui/src/)
├── bench/       基准与夹具生成脚本
└── experiments/ M0 Qt 对照原型
```

### 当前进度与缺口

| 阻塞 | 影响 | 解除条件 |
|---|---|---|
| Rust / Cargo 1.99.1 已复核可用 | dev / release 与宿主测试已运行 | 无需新增安装 |
| `src/host + src/ui` 已构建验证 | 根目录 CLI 自动发现与 devUrl 正常 | ADR 状态与实现事实分别记录 |
| M0 测量与 ADR 已写入 | 大文档交互与空闲 CPU 未达目标；部分原生测量缺失 | 原结果保留；用户当前优先 UX，性能专项后置 |
| 主要阅读流程已接入前后端 | 链接、监听、设置 / 会话恢复及标签管理 | 测试 / 构建 / 原生验证见阅读流程完整性记录；完整 M1 尚未验收 |
| Qt 对照 | 用户确认跳过 T14 | 仅验证 Web 主线，不补装 Qt |

---

## 与需求文档的对应关系

| 需求文档章节 | 本文档 |
|---|---|
| §1 产品定位与原则 | 00 §实现约束(不复述) |
| §2 使用场景 | 10(交互)、03(实时刷新)、04(资源) |
| §3.1 功能需求 FR-001..021 | 12(任务分解,逐条对应) |
| §3.2 双 Theme | 05 |
| §3.3 Live Reload 细则 | 03(逐条对应 8 条) |
| §3.4 链接点击跳转细则(FR-019) | **14** |
| §3.5 多标签阅读界面细则(FR-020) | **13** |
| §3.6 目录浏览与阅读工作台细则(FR-021) | **10、15** |
| §4 NFR-001..013 | 08(性能)、06(安全)、09(测试)、11(依赖);NFR-013 另见 **13** §7 |
| §4.1 性能矩阵 | 08 §9、12 T15 |
| §5 技术方案 | 00(栈)、11(构建) |
| §5.3 逻辑架构 | 00 §3 |
| §5.4 性能设计原则 | 08 |
| §5.5 实时更新原则 | 03 |
| §5.6 安全与隔离 | 04、06 |
| §5.7 缺依赖处理 | 06 §9、11 §3.1 |
| §6 依赖关系 | 00 §3、12 依赖图 |
| §7 里程碑 | 12 里程碑门槛 |
| §8 明确不做 | 00 §7、08 §4.3 |
| §9 待决策 D-01..D-10 | ADR-001..005 + 12 |
| §10 验收用例 AC-01..22 | 09 §7、11 §7.2、13 §10、14 §7、15 验收 |
| §12 M0 开工清单 | 12 Phase 0–1 |
