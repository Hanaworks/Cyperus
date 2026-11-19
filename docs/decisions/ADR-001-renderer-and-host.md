# ADR-001 — Markdown Renderer 与桌面宿主

- **状态**:Proposed（建议用于 M1，待负责人批准）
- **日期**:2026-11-04
- **决策者**:项目负责人
- **影响范围**:`src/host/**`、`src/ui/**`、渲染与安全边界

## 背景

T16 需要为 M1 确定正式渲染主线。本轮用户已明确跳过 T14，只验证 Web 主线，不安装 Qt。Qt 原型与能力差异记录保留，但没有有效 Qt 性能样本；不能据此宣布 Web 比 Qt 更快或更省内存。

现有管线为 Vue 外壳、Worker 中的 markdown-it / Shiki / KaTeX、主线程 DOM 插入 / 消毒 / Mermaid。`benchmarks/results.csv` 已记录浏览器开发环境的冷暖 DOM ready、解析、滚动和资源观测，口径及局限见 ADR-003。

真实 Tauri 发布构建在 `freezePrototype: true` 时曾出现空白。相同 dist 在 Chromium 中启用 `Object.freeze(Object.prototype)` 后可复现 Mermaid 的 vscode-jsonrpc 依赖向 `toString` 赋值触发只读异常。改为 `false` 后，开发与发布窗口均已实际启动，2026-11-04 的原生探针完成七份夹具与四档真实 IPC；最终功能证据见 `benchmarks/native-m0.json`（09:13 UTC）。早一轮发布构建的事后 idle 已采样但 AC-10 未达标，兼容性可运行不等于完整产品验收。

## 候选方案

| 方案 | 本轮证据 | 代价 / 限制 |
|---|---|---|
| Web Renderer + Tauri + markdown-it | 浏览器主链路可运行；真实 WebView2 能显示七份夹具的正文 / 标题，并出现数学、高亮与图表；真实字节 IPC 四档正确 | DOM、图表与资源必须有独立安全边界；50 MB 全量 DOM 的交互与内存仍需改进 |
| Web Renderer + Electron | 可复用 Web 解析与阅读层 | 本轮未建立 Electron 原型、启动 / RSS 数据；没有迁移依据 |
| Qt 原生 QTextDocument | 已保留受限原型与逐夹具能力表 | T14 按用户决定跳过；公式、Mermaid、Alerts、高亮与独立正文主题存在原型功能缺口；没有有效运行 / 性能对照 |
| unified / remark 替换 markdown-it | 本轮没有实现或同夹具对照 | 需迁移现有 token 增强、源码定位、插件与 golden；当前需求未提供承担第二解析器的理由 |

功能证据与缺口分开记录：

| 能力 | 当前 Web 主线 | M1 保留项 |
|---|---|---|
| GFM、脚注、Alerts、KaTeX、Shiki、CJK 锚点 | 已有统一解析入口、固定夹具 / golden 与阅读器路径 | 持续回归，不能以原型替代完整 AC 验收 |
| Mermaid | 浏览器 100 图两轮终态均为 done=100 / error=0 / pending=0；原生 extended 为 4 个成功图 + 1 个预期错误卡片，theme 为 1 图成功 | 真实发布构建的长期使用、并发度与完整主题视觉验收 |
| 主题与目录 | 浏览器六种主题组合不增加解析计数；原生七份夹具均记录不重解析 | T29 / T30 / T31 / T32 补滚动恢复、完整目录、搜索与视觉矩阵 |
| 文件读取 | 四档原生 ArrayBuffer 类型与字节数均正确；50 MB 为 52,429,974 bytes，最终复验单次 read / IPC 453.8 ms | 原生读取 / 大文档 DOM 的 RSS 峰值、冷启动、首屏与交互 P95 |
| 图片与局部失败 | 最终复验 basic / extended / theme / links 实际加载图片分别为 2 / 4 / 1 / 1；缺失 / 越界图无 src，损坏图有替代提示 | 连续打开时的资源加载生命周期与长期回归，不扩大为全部可靠性验收通过 |
| 原生 idle | IPC + 七份夹具后、最后活动 tabs/a 的 60.483 s / 71 样本，RSS 峰 / 末 845.711 / 682.078 MiB，CPU 累计 3628 ms，AC-10 未达标 | 诊断并修复空闲 CPU；另测大文档峰值、原生 50 轮回收和多标签预算 |
| watcher、多标签、跨文档链接 | 最小阅读器尚未形成完整产品闭环 | T21 / T22 的 watcher 与版本事件，T23 / T24 的队列 / Worker，T24b / T24c / T28；显式文本 reload 不代替真实 watcher |

## 决策

M1 继续采用 **Tauri 2 + Vue 3 + markdown-it Worker 的 Web Renderer**，不引入第二解析器，不为本轮补装或补齐 Qt。该选择基于当前功能覆盖、已有实现和可运行证据，不构成不同宿主的性能排名。

`src/host/tauri.conf.json` 显式使用 **`app.security.freezePrototype: false`**。本地 Tauri CLI 配置 schema 将该选项标为默认关闭的可选原型硬化；本轮已复现开启时与依赖不兼容。若未来重启该硬化，必须先修复 / 替换不兼容依赖并验证完整发布产物。

## 理由

1. 现有主线已覆盖需求中的富文本扩展，真实 WebView2 可运行；目前没有需要推翻解析器或宿主的同口径证据。
2. Worker 分离解析与 DOM 工作；现有契约可以继续实现代次守卫、活动文档调度和分段，避免重新建立整套渲染语义。
3. 实测暴露的是大文档全量 DOM、资源预算和发布兼容性问题，不能由此推导换宿主即可解决。

## 后果

### 必须遵守

- 解析、高亮与公式处理留在 Worker；DOMPurify、DOM、Mermaid 留在主线程。Vue 负责外壳和交互，不把每个 Markdown 块改成组件。
- 保留 `script-src 'self'`，不加入 `unsafe-eval`；图片 CSP 不开放 `https:`。`freezePrototype: false` 不改变这些约束。
- 原始 HTML 与生成 SVG 使用各自的消毒策略；Mermaid 保持 strict、关闭 HTML labels、锁定配置，并在渲染前拒绝作者图片 / 资源元数据、自定义 CSS 与配置。
- 图片在惰性 template 内先移除 `src`，经宿主路径校验后逐文件授权；asset scope 初始为空，不恢复递归目录授权。实际加载结果与路径授权分别验收。
- IPC 保留原始字节 `Response` → `ArrayBuffer` 路径；本轮没有触发 base64 回退，不因浏览器 mock 推断原生传输成功。
- 未测量字段保持为空或标注待测；`native-m0.json` 的 complete 仅表示探针流程完成，不表示所有验收通过。

### 需要验证

- 保持 basic / extended / theme / links 图片加载与失败占位回归；初次探针过早检查尚未授权 src 的测量竞态已修复，图片等待不计入 DOM ready 指标。
- T15 / M1：补原生冷启动、首屏 / 完整渲染、交互 P95、大文档进程树 RSS；定位并修复已确认未达标的 AC-10，不能把本轮 idle 峰值当成 50 MB 读取 / DOM 峰值。
- T21 / T22、T24b / T24c / T28、T31 / T32：真实 watcher 与异常文件闭环、链接 / 多标签、搜索高亮与完整双主题视觉回归。

### 回滚成本

换 Electron 需重做宿主命令、安全权限、打包及原生测量；换 Qt / Parser 还需迁移扩展语义、源码定位、主题与 golden。推翻本决定须有覆盖功能缺口的同口径数据，并另写 ADR。

## 相关文档

- [总体架构](../design/00-architecture.md)、[渲染管线](../design/01-render-pipeline.md)、[安全](../design/06-security.md)
- [实施计划 T09–T16](../design/12-implementation-plan.md)
- [样式隔离](ADR-002-style-isolation.md)、[性能与大文件策略](ADR-003-performance-thresholds.md)
- [环境与口径](../../benchmarks/environment.md)、[CSV](../../benchmarks/results.csv)、[发现与缺口](../../benchmarks/findings.md)
- [原生探针](../../benchmarks/native-m0.json)、[原生 idle 汇总](../../benchmarks/native-summary.json)、[原始进程树采样](../../benchmarks/native-tree.csv)、[Qt 能力边界](../../benchmarks/qt-compatibility.md)

## 参考

- 发布配置：`src/host/tauri.conf.json`；本地 Tauri CLI `config.schema.json` 的 `SecurityConfig.freezePrototype`。
- 解析 / Worker：`src/ui/src/core/markdown/index.ts`、`src/ui/src/workers/parse.worker.ts`。
- 阅读安全边界：`src/ui/src/reader/{ReaderView.vue,renderInto.ts,svg.ts,MermaidLayer.ts}`。
