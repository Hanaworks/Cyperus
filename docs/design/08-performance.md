# 08 — 性能与资源管理

> 覆盖 NFR-001 / NFR-002 / NFR-003 / NFR-004 / 需求文档 §4.1 性能矩阵 / §5.4。
> 代码落点:`src/ui/src/core/render/{jobQueue,scheduler}.ts`、`src/ui/src/core/documents/budget.ts`、`src/bench/**`。

---

**2026-11-07 实现对照：** 单 Worker 队列、48 MiB HTML LRU、超额临时分段存储、≥8 MiB 或高亮膨胀后的结构分段、当前邻段驻留 / 远段占位已接入。真实 100 个 1 MB 文件在 100 标签时保留 HTML 46.89 MiB；原生 50 / 5 次开关后 RSS 比率 1.1145，通过 ≤1.3 门槛。首屏仍等待全文 tokenize / HTML 输出，首块提前返回、SVG 缓存及下表所有性能目标尚未全部实现 / 通过。最新发布版证据见 [M1 验收记录](../dev/m1-acceptance.md)，不沿用 M0 的“尚未实现分段 / LRU”作为当前状态，也不把下文设计目标当成测量结果。

## 1. 性能预算(初始目标,非承诺)

> 全部为**待实测标定**的初始值。M0 结束后写入 `ADR-003` 冻结为验收阈值。

| 指标 | 100 KB | 1 MB | 10 MB | 50 MB |
|---|---|---|---|---|
| 冷启动到首屏(含进程) | < 800 ms | < 800 ms | < 1.5 s | < 3 s |
| 首屏可读(首块渲染) | < 150 ms | < 250 ms | < 700 ms | < 2 s |
| 完整渲染 | < 400 ms | < 1.2 s | < 6 s | < 30 s(分段) |
| 交互 P95(滚动/切换) | < 50 ms | < 50 ms | < 80 ms | < 100 ms |
| 进程树内存峰值 | < 220 MB | < 260 MB | < 480 MB | < 900 MB |
| 空闲 CPU | ≈ 0% | ≈ 0% | ≈ 0% | ≈ 0% |

**前提**:Windows 11、16 逻辑核、16 GB 内存、WebView2 156、窗口 1440×900、目标夹具、无其他负载。

---

## 2. 渲染调度器

### 2.1 优先级

```ts
export enum Priority {
  Active = 0,        // 当前可见标签
  Prefetch = 1,      // 用户即将切换(悬停 200ms 或快捷键预取)
  Background = 2,    // 非活动标签(仅在预算空闲时)
}
```

首版只实现 `Active`(Background 不做,避免违反 NFR-002/NFR-004)。

### 2.2 队列

```ts
// src/ui/src/core/render/jobQueue.ts
export class RenderJobQueue {
  private pending = new Map<string /*docId*/, ParseRequest>()
  private running: string | null = null
  private worker: Worker

  submit(req: ParseRequest) {
    // 同文档去重:新任务直接替换旧任务(旧任务即使已发送,结果也会被代次守卫丢弃)
    this.pending.set(req.docId, req)
    this.pump()
  }

  private pump() {
    if (this.running) return
    const [docId, req] = this.pending.entries().next().value ?? []
    if (!req) return
    this.pending.delete(docId)
    this.running = docId
    this.worker.postMessage(req)
  }

  onMessage(res: ParseResponse) {
    this.running = null
    this.handle(res)      // 含代次守卫
    this.pump()
  }
}
```

**单 Worker 串行**:避免多 Worker 争抢 CPU 导致活动标签变慢。50 MB 场景下多 Worker 无收益(内存翻倍),反而更差。

### 2.3 取消语义

Web Worker 无法真正中断同步的 `markdown-it.parse()`。因此:

- **不实现物理取消**;
- 靠**代次守卫**丢弃过期结果;
- 靠**任务替换**保证同一文档不排队多次;
- 极端情况(50 MB 解析中用户关闭标签):解析仍会跑完,但结果被丢弃,Worker 内解析完成后立即 GC。

> 若 M0 实测发现"关闭标签后 Worker 仍在解析 30 s"体验不可接受,则升级为:销毁 Worker 并重建(代价是 Shiki 高亮器重新初始化 ~300 ms)。作为备选方案记录在 ADR-003。

---

## 3. 首屏优先(渐进显示)

```text
text 全文
  ↓
markdown-it 全量 parse(必须,因为要拿到完整 token 流)
  ↓
分块渲染:
  1. 渲染前 N 个顶层 token(直到累计字符数 ≥ 32 KB 或 token 数 ≥ 200)
  2. 立即 postMessage({ partial: true, html, blocks, done: false })
  3. 继续渲染剩余 token
  4. postMessage({ partial: false, html, done: true })
```

- 首屏消息让用户 < 250 ms 看到内容(1 MB 文件)。
- 剩余部分在后续消息中**追加**(`insertAdjacentHTML('beforeend', chunk)`),不重排已有 DOM。
- 追加时**不触发** scroll 重置(浏览器追加内容不影响当前 scrollTop)。
- 消息分片上限:8 片,避免 postMessage 开销。

> 复杂度提示:分块渲染要求 markdown-it 的 `renderer.render(tokens, options, env)` 能按 token 区间调用。因其接受完整数组,实现上用 `tokens.slice(from, to)` 逐片渲染。**必须处理跨 token 的未闭合标签**(例如列表跨越分片边界)→ 实现时按"闭合深度"切分:只在 `nesting` 平衡点为 0 的 token 边界切。

**Phase 1 可先不做分块**,只做全量渲染 + 性能测量。若 1 MB 文件首屏 > 400 ms,再启用。这是**可延后的优化**,不得成为 M1 的阻塞项。

---

## 4. 大文件分段模式

### 4.1 触发

| 条件 | 行为 |
|---|---|
| `text.length > SEGMENT_THRESHOLD`(初始 8 MB) | 启用分段 |
| 用户手动开启「分段模式」 | 强制启用 |

### 4.2 分段策略

```
1. 全文用 markdown-it 只解析出 token 流(不做 render,内存占用远低于 HTML)
2. 按顶层 heading(h1/h2)+ hr 切分为段(Section)
3. 每段记录 [tokenStart, tokenEnd, srcLineStart, srcLineEnd, title]
4. 只渲染「当前段 + 相邻 1 段」
5. 滚动接近段边界 → 渲染下一段(占位符替换为真实 DOM)
6. 远离超过 3 段的 DOM → 替换为等高占位(高度由上次渲染的 offsetHeight 记录)
```

### 4.3 为什么不是虚拟滚动

- 虚拟滚动需要精确的每块高度;Markdown 块高度高度依赖字体与宽度,重排后失效。
- 占位高度估算会在主题/字号切换时全面失效,导致滚动跳变。
- 实现复杂度与 bug 面远高于收益(Markdown 阅读极少有 10 万行)。

**结论:采用"分段 + content-visibility",不做虚拟滚动。** 写入 ADR-003。

### 4.4 CSS 兜底(即使不分段)

```css
.md-doc > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;
}
```

- 对 1–8 MB 文件足够把渲染成本从"全量 layout"降到"可见区域 layout"。
- `contain-intrinsic-size` 的 `auto` 关键字让浏览器记住上次尺寸,大幅减少滚动跳变。

---

## 5. 内存管理

### 5.1 内存构成(实测项)

| 组成 | 归属 | 备注 |
|---|---|---|
| 原始文本 | WebView 主线程 | 解析后释放 |
| Token 流 | Worker | 渲染后释放 |
| HTML 字符串 | WebView 主线程 | 预算管理 |
| DOM | WebView 主线程 | 仅活动标签 |
| KaTeX MathML | WebView DOM | 公式密集时可达 HTML 的 8–20 倍 |
| Mermaid SVG | WebView DOM | 每图 20–200 KB |
| 图片解码 | WebView 图像缓存 | 不可控,只能靠 lazy loading |

### 5.2 预算

```ts
const BUDGET = {
  htmlBytesTotal: 48 * 1024 * 1024,   // 所有标签 html 字符串总和
  mermaidSvgCached: 40,               // 缓存条目数上限
  imageDecodeHints: 'lazy',           // loading="lazy"
}
```

逐出逻辑见 `02-document-lifecycle.md` §3.3。

### 5.3 必须显式释放的资源

| 资源 | 释放时机 |
|---|---|
| `IntersectionObserver` | 标签关闭 / 内容替换前 `disconnect()` |
| `ResizeObserver` | 同上 |
| `requestAnimationFrame` 句柄 | `cancelAnimationFrame` |
| 事件监听器 | 委托在容器上,容器复用则无需解绑;`listen()` 返回的 unlisten 在 app 卸载时调用 |
| `CSS.highlights` 中的 Range 集合 | 搜索关闭时 `CSS.highlights.delete(name)` |
| Mermaid SVG 缓存 | 标签关闭时按 docId 清除 |
| Torch / 临时 Blob URL | `URL.revokeObjectURL` |

### 5.4 泄漏检测

`src/bench/web-bench.mjs` 中的「长期使用」场景:

```text
for i in 1..50:
  open(fixture) → wait ready → close
每 10 轮记录一次 performance.memory.usedJSHeapSize + 进程树 RSS
断言:第 50 轮的 RSS 不超过第 5 轮的 1.3 倍
```

---

## 6. 空闲资源(NFR-004)

| 潜在来源 | 处理 |
|---|---|
| 文件轮询 | **不存在**;全部 OS 事件驱动 |
| 定时器 | 仅两处:去抖(短生命周期)、搜索输入去抖(用户交互后) |
| `setInterval` | **全项目禁止**(CI 用 Biome `noRestrictedGlobals` 拦截 `setInterval`) |
| 动画 | 无 CSS 无限动画(loading spinner 只在加载时存在) |
| `requestAnimationFrame` 循环 | 仅滚动同步时按需注册,停止滚动即取消 |
| WebView 后台节流 | `backgroundThrottling: "throttle"`(默认),不设为 `disabled` |

**验收**:AC-10 —— 打开文档后静置 60 s,进程树 CPU 累计时间增长 < 100 ms。

---

## 7. 启动性能

### 7.1 关键路径

```text
进程启动
 ├─ Tauri 初始化(~150 ms,含 WebView2 创建)
 ├─ 前端 bundle 加载与执行(目标 < 200 ms)
 │   ├─ Vue + Pinia(≈ 60 KB gzip)
 │   ├─ 外壳组件(小)
 │   └─ **不加载**:markdown-it / mermaid / shiki / katex / dompurify
 ├─ 派发 Worker 并 await ready(Shiki 初始化,≈ 300 ms)
 └─ 若有启动文件 → open → read → parse → 首屏
```

**强制动态导入**:

```ts
const { marked } = await import(/* @vite-ignore */ './src/core/markdown')
const mermaid = (await import('mermaid')).default
const DOMPurify = (await import('dompurify')).default
```

- `markdown-it` 及其插件整体作为独立 chunk,在 Worker 内加载(不进入主 bundle)。
- `mermaid`(≈ 700 KB gzip)**只在文档含 Mermaid 时加载**。
- `dompurify` 只在 `hasRawHtml === true` 时加载。
- KaTeX CSS 与字体:随首屏 CSS 一起(体积小),JS 在 Worker 内。

### 7.2 首屏前的占位

- 立即渲染外壳(标题栏 + 空阅读区),不等 Worker ready。
- 内容区显示骨架屏(skeleton),**不显示 spinner 转圈**(避免感知变慢)。
- 若 Worker 3 s 未 ready → 降级:主线程动态加载 markdown-it 并解析(牺牲响应性换可用性),同时状态栏提示。

---

## 8. 多标签资源(NFR-002)

| 打开数 | 预期进程树 RSS | 策略 |
|---|---|---|
| 1 | 220–280 MB | — |
| 10 | 300–400 MB | html 预算内 |
| 30 | 400–550 MB | 部分逐出 |
| 100 | 450–650 MB | 大量逐出,仅最近 10 个保留 html |

> 这些是**待实测的估算**。M0-04 必须给出真实数字。若 100 标签超过 800 MB,需要重新评估预算或引入「标签休眠」策略(卸载 WebView 内容)。

---

## 9. 基准测试框架

### 9.1 夹具生成

```bash
node src/bench/gen-fixtures.mjs --out fixtures/generated
```

| 文件 | 内容 |
|---|---|
| `100kb.md` | 混合语法,约 100 KB |
| `1mb.md` | 同上放大 |
| `10mb.md` | 同上 |
| `50mb.md` | 同上 |
| `mermaid-100.md` | 100 个不同 Mermaid 图 |
| `code-heavy.md` | 200 个代码块,总计 2 MB |
| `math-heavy.md` | 500 个公式 |
| `docs-{10,30,100}/` | 多文件目录 |

要求:**确定性**(固定随机种子),生成脚本本身入库,生成物 gitignore。

### 9.2 测量口径(遵循需求文档"公平比较原则")

| 指标 | 采集方式 |
|---|---|
| 冷启动 → 首屏 | `performance.mark('app:start')`(Rust `setup` 中注入)→ `performance.mark('reader:first-paint')`,取差值;并记录 `process_start_time` 作为外部基准 |
| 完整渲染 | markdown-it 前后 `performance.now()` |
| 交互 P95 | 脚本触发 100 次滚动/切换,记录 rAF 间隔 |
| 进程树 RSS | `src/bench/sample-tree.ps1`:`Get-CimInstance Win32_Process` 递归收集 `ParentProcessId`,汇总 `WorkingSetSize`;含 `msedgewebview2.exe` |
| 空闲 CPU | 同上,`KernelModeTime + UserModeTime` 差值与时间比 |
| 关闭后回收 | close 后 5 s 采样,对比打开前基线 |

**必须**:同一台机器、同一夹具、同字体、同窗口尺寸;分列冷/热启动;分列首屏/完整渲染。

### 9.3 结果格式

```csv
# benchmarks/results.csv
date,commit,scenario,fixture,cold_or_warm,first_paint_ms,full_render_ms,p95_interaction_ms,rss_peak_mb,rss_stable_mb,idle_cpu_pct,notes
```

---

## 10. 待实测项

| 项 | 验证 |
|---|---|
| 50 MB 文件的总内存峰值 | M0-04,决定是否下调上限 |
| `content-visibility: auto` 在 WebView2 156 的实际收益 | A/B 测试:开/关各跑 10 MB 夹具 |
| 分块渲染是否必要(1 MB 首屏 > 400 ms?) | M0-02 测量 |
| Worker 销毁重建的代价(Shiki 重新初始化) | 测量 3 次取均值 |
| 100 标签的真实 RSS 与逐出效果 | M0-04 |
| Shiki 在 Worker 内初始化耗时 | 测量 |
| Mermaid 100 图的总渲染时间与并发度最优值 | 试 1/2/4 并发 |
