# ADR-002 — Markdown 样式隔离

- **状态**:Proposed（建议用于 M1，待负责人批准）
- **日期**:2026-11-04
- **决策者**:项目负责人
- **影响范围**:`src/ui/src/styles/**`、`core/theme/**`、`reader/**`、搜索高亮

## 背景

App Theme 与 Markdown Theme 必须独立组合，主题切换不重新解析 Markdown。正文还要与 KaTeX、Shiki、Mermaid、目录定位及后续搜索 Range 共存。样式隔离同时需要防止作者 HTML / 图表 CSS 影响外壳。

本轮最小阅读器实现命名空间路径，没有 Shadow DOM 或 iframe 对照实现。下列证据可以支持继续该路径，不能解释为三种方案的性能比较或完整视觉验收。

## 候选方案

| 方案 | 收益 | 约束 |
|---|---|---|
| `.md-doc` 命名空间 + 独立变量 + 显式正文样式 | 保留同 Document 的 DOM、目录、选择 / Range 与扩展库集成；现有实现已可运行 | 不是浏览器安全边界；需限制全局选择器、作者 CSS 与 SVG CSS，并以测试防回归 |
| Shadow DOM | 浏览器提供更强的选择器边界 | 需另外验证样式装载、库的 DOM 查询、字体测量、搜索 Range 与滚动；本轮未实现 / 测量 |
| iframe | 独立文档提供更强样式边界 | 需另外建立主题通信、目录 / 搜索 / 滚动协议与生命周期；本轮未实现 / 测量 |

## 决策

M1 采用 **严格 `.md-doc` 命名空间、独立 `--app-*` / `--md-*` 变量、显式正文排版与 `contain: layout paint style`**。不引入 Shadow DOM 或 iframe。Mermaid 生成样式只能作用于当前图表 ID 及其后代，经解析与白名单过滤后进入 SVG。

`contain` 用于布局 / 绘制约束，不是 CSS 选择器或恶意内容的安全隔离；安全仍由 HTML / SVG 消毒、资源预拒、CSP 与宿主路径授权负责。

## 理由与本轮证据

| 检查 | 证据 | 能证明 / 不能证明 |
|---|---|---|
| 双主题独立 | `results.csv` 的 `isolation / theme` 行记录 2 × 3 六种组合的计算样式；同一 App Theme 下正文主题不改变控件颜色 / 字体；同一正文主题下换 App Theme，正文颜色 / 背景不变 | 支持变量边界；未比较完整画面像素 |
| 不重解析 | 同一 isolation 运行的 `parseCount` / `parseMs` 不变；原生七份夹具的探针记录 `themeDidNotParse=true` | 支持主题切换路径；不等同于图表零重绘或全部交互预算达标 |
| 公式 / 高亮 / 图表 | 统一阅读器显示 KaTeX / Shiki；浏览器 100 图两轮均完成；原生 extended 为 4 图成功 + 1 个预期局部错误，theme 为 1 图成功 | 支持扩展层与当前容器共存；没有 Shadow DOM A/B 结果 |
| 作者内容边界 | `renderInto.ts` 剥离作者 style 元素并过滤内联声明；`svg.ts` 只转抄当前图表 ID 内的静态绘制规则，拒绝资源引用与越界选择器 | 是当前实现约束；仍需持续安全与视觉回归 |
| 搜索高亮 / 视觉 | T31 / T32 尚待完成 | 不宣称 CSS Custom Highlight / mark 降级或 18 张截图矩阵已验收 |

浏览器运行口径为 Chromium 156 + Vite dev，源文件指纹 `971dbf61da05dac1`。计算样式原始值在 CSV notes，最终原生结果在 `native-m0.json`（2026-11-04 09:13 UTC，七份夹具均 `themeDidNotParse=true`）；两者不能互换为视觉回归证据。

## 后果

### 必须遵守

- App 主题只定义 / 消费 `--app-*`；正文主题在 `.md-doc` 上定义 / 消费 `--md-*`，显式设置正文颜色、背景、字体与行高。全局结构重置与库 CSS 需审查，新增外壳选择器不得进入正文内容。
- `data-app-theme` 挂到 `<html>`；`data-md-theme` 挂到 `<article class="md-doc">`。普通正文、Shiki 双主题变量与 KaTeX 通过样式变化换肤；不得重新投递 Markdown 解析。
- Mermaid 主题映射维持 light → default、dark → dark、paper → neutral；主题变化只处置 / 重新调度图表层，保留解析结果。并发、超时和缓存预算见 ADR-003。
- 作者 HTML 不得注入全局 `<style>` / `<link>`。内联样式只保留局部排版白名单，不接受 URL / expression 等资源或执行入口。
- SVG 使用独立 DOMPurify 实例，避免混用正文样式钩子；只允许当前 `#md-graph-N` 根和后代规则、静态绘制属性与本地片段引用。拒绝兄弟越界选择器、外链 / 图片、foreignObject、脚本与动画。
- `content-visibility: auto` 与 intrinsic size 是渲染成本兜底；不能代替分段，也不据此声称已有 A/B 性能收益。

### 需要验证

- T31：同 Document 的 CSS Custom Highlight API 与 mark 降级；搜索关闭、内容替换、标签关闭后无残留 Range / 标记。
- T32：固定字体与窗口的 18 张视觉矩阵，验证双向主题隔离、Shiki / KaTeX / Mermaid、中文字体与 paper 回落。现有计算样式检查不替代该验收。
- T29 / T30 / T39：字号 / 主题 / 分段变化后的目录与滚动定位；真实 WebView2 与固定视觉环境分别验证。

### 回滚成本

若命名空间纪律无法控制样式污染，可另写 ADR 迁移 Shadow DOM；需迁移库样式、图表挂载、搜索 Range、主题注入与视觉基准。iframe 另需通信协议。当前没有足够证据支付这些迁移成本。

## 相关文档

- [双主题设计](../design/05-themes.md)、[安全](../design/06-security.md)、[测试](../design/09-testing.md)
- [实施计划 T13 / T31 / T32](../design/12-implementation-plan.md)
- [Renderer 与宿主](ADR-001-renderer-and-host.md)、[性能与大文件策略](ADR-003-performance-thresholds.md)
- [环境与口径](../../benchmarks/environment.md)、[CSV](../../benchmarks/results.csv)、[原生探针](../../benchmarks/native-m0.json)

## 参考

- `src/ui/src/styles/{base.css,markdown.css}`、`src/ui/src/core/theme/apply.ts`。
- `src/ui/src/reader/{ReaderView.vue,renderInto.ts,svg.ts,MermaidLayer.ts}`。
- `src/ui/tests/e2e/{reader.spec.ts,mermaid-security.spec.ts}`；基准 `--scenario isolation`。
