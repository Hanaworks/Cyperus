# Markdown 本地预览应用 — 设计文档索引

> 上游需求基线:[`docs/requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md`](../requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md)
> 本文档集把需求展开到**可直接实施的技术细节**,覆盖架构、渲染、文件生命周期、实时刷新、资源、主题、安全、IPC、性能、测试、UI、构建与任务分解。
> **状态**:全套 `Proposed`。任何与 M0 实测数据冲突的内容,以 ADR 为准并回改本文档。

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
| 10 | [`10-ui-and-navigation.md`](./10-ui-and-navigation.md) | 布局、组件树、TOC、搜索(Highlight API)、快捷键、状态栏、无障碍、拖放 | FR-010/012 |
| 11 | [`11-build-and-release.md`](./11-build-and-release.md) | 环境要求、`tauri.conf.json`、Vite 配置、体积预算、M0 对照、发布检查清单 | NFR-011/012 |
| 12 | [`12-implementation-plan.md`](./12-implementation-plan.md) | **53 个主任务 + T24b/T24c**,分 Phase 0–4,含依赖图与里程碑门槛 | §7 里程碑 |
| 13 | [`13-tabs.md`](./13-tabs.md) | 多标签栏:视觉规格、状态机、新建/切换/关闭/重排/溢出/右键菜单、恢复最近关闭、持久化、无障碍 | **FR-020**, FR-007, AC-16..19 |
| 14 | [`14-link-navigation.md`](./14-link-navigation.md) | 链接分类(Rust 唯一真源)、点击分发、修饰键语义、跨文档锚点、错误文案、分段模式下跨段跳转 | **FR-019**, FR-006, AC-13..15 |

---

## 决策记录

见 [`../decisions/README.md`](../decisions/README.md)。

| 编号 | 标题 | 状态 |
|---|---|---|
| ADR-001 | Markdown Renderer 与桌面架构选型 | Pending(M0 结束) |
| ADR-002 | Markdown 样式隔离方案 | Pending(M0 结束) |
| ADR-003 | 性能阈值与大文件策略 | Pending(M0 结束) |
| ADR-004 | 源码目录布局(`src/host` + `src/ui`) | **Proposed(待确认)** |
| ADR-005 | 大文件 IPC 传输方案 | Pending(T10) |

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
4. **asset 协议按文档目录运行期授权**(`allow_directory`),静态 `scope: []`,不开放整盘。
5. **样式隔离用命名空间而非 Shadow DOM**,因为搜索高亮(`CSS.highlights` + `Range`)、Mermaid 渲染与尺寸测量在 Shadow DOM 下要全部改造,收益不抵成本。

### 两个 UI 骨架需求(P0)

- **多标签阅读(FR-020)**:顶部标签栏,新建/切换/关闭/重排/溢出/恢复最近关闭/跨会话持久化;切换已缓存标签**不重新解析**。见 `13-tabs.md`。
- **链接点击跳转(FR-019)**:所有链接可点击;按类型分流到锚点 / 新标签 / 系统程序 / 系统浏览器 / 拦截;分类判定唯一真源在 Rust,前端不自行判断。见 `14-link-navigation.md`。

### 目录

```text
src/
├── host/        Tauri Rust crate(Cargo 要求 crate 内有 src/,故为 src/host/src/)
├── ui/          Vue + Vite 前端(故为 src/ui/src/)
├── bench/       基准与夹具生成脚本
└── experiments/ M0 Qt 对照原型
```

### 当前阻塞

| 阻塞 | 影响 | 解除条件 |
|---|---|---|
| Rust / cargo 未安装(实测) | Phase 1 起全部任务 | 用户授权安装 |
| ADR-004 未确认 | 目录布局未定 | 用户确认 `src/host + src/ui` |
| M0 实测数据缺失 | ADR-001/002/003 无法冻结 | 完成 T09–T15 |

---

## 与需求文档的对应关系

| 需求文档章节 | 本文档 |
|---|---|
| §1 产品定位与原则 | 00 §实现约束(不复述) |
| §2 使用场景 | 10(交互)、03(实时刷新)、04(资源) |
| §3.1 功能需求 FR-001..020 | 12(任务分解,逐条对应) |
| §3.2 双 Theme | 05 |
| §3.3 Live Reload 细则 | 03(逐条对应 8 条) |
| §3.4 链接点击跳转细则(FR-019) | **14** |
| §3.5 多标签阅读界面细则(FR-020) | **13** |
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
| §10 验收用例 AC-01..19 | 09 §7、11 §7.2、13 §10、14 §7 |
| §12 M0 开工清单 | 12 Phase 0–1 |
