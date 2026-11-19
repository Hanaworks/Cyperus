# M0 性能与可靠性记录

当前阶段：框架已建立；以下项目按实际可测能力区分。未执行、不可执行和缺少能力都不算验收通过。浏览器探索结果不能替代原生 WebView2 结果。本轮按用户决定跳过 T14，仅验证 Web 主线。

## 已验证框架

- `web-bench.mjs` 支持 idle / open / matrix / reload / lifecycle / isolation；CSV 固定为设计 §9 的 12 列，正确转义逗号、引号、换行，拒绝向不同表头的文件追加。
- `sample-tree.ps1` 接受显式根 PID，只读递归采样其后代的 RSS / CPU；CIM 失败时回退 Toolhelp + Get-Process。只写指定的采样文件，不停止被测进程、不改系统设置。
- Node 16 项测试覆盖参数错误、P95、CSV、采样汇总、夹具路径、BOM / 末行截断、失效 / 截断采样拒绝、取消 / 预先取消的等待、源文件指纹、主题切换真实性、CIM / fallback 身份一致、真实 Windows 进程树，以及 code-heavy 的尺寸 / 块数 / 确定性。实测记录追加到 `results.csv`。

## 测量结果

2026-11-04 首轮空外壳开发期基线已写入 `results.csv`：静置 60 s，browser 进程树采样 RSS 峰值 635.125 MB、末值 588.813 MB，CPU 累计 2,520 ms（单逻辑核百分比 4.204%）。这轮未先做 5 s settle，且未隔离协作开发 / Vite 热更新，不能据此验收空闲 CPU；观测结果本身也没有达到 AC-10 的 100 ms 目标。后续脚本已加入 settle，并以 notes 区分。

原生 IPC 与 post-workload idle 已有单独的 release 证据，见下节；原生冷启动、首屏与 P95 仍未测量。

### 浏览器初次性能观察（优化前）

下表取对应 matrix 行；50 MB 取 `2026-11-04T07:44:48.978Z` 的独立 open 行。当前实现全量解析 / DOM 插入，Reader 每次滚动扫描全部标题。这些数据是后续滚动路径修复前的观察值；有协作开发负载，不冻结为承诺。

| 夹具 | DOM ready cold / warm（ms） | scroll-rAF P95 cold / warm（ms） | browser 树 RSS 峰 cold / warm（MB） |
| --- | ---: | ---: | ---: |
| 100 KB | 466 / 41.7 | 31.6 / 31.6 | 785.828 / 811.582 |
| 1 MB | 627.3 / 168.1 | 31.7 / 31.6 | 862.227 / 922.320 |
| 10 MB | 2418.8 / 1677.4 | 232.4 / 228.4 | 1485.133 / 1544.457 |
| 50 MB | 9146.6 / 8597.8 | 1207.6 / 1266 | 3930.254 / 4144.773 |

所有 `full_render_ms` 目前等于全量 DOM ready，未实现分块首屏。50 MB warm 的解析本身 3969.8 ms，滚动 P95 则已达 1266 ms，说明不能仅优化解析就认为交互预算达标。这里没有图表；100 图需另看 all_graphs 终态。

一次 matrix 50 MB 尝试遇到 Vite 配置 / 入口变动导致导航中断；后一次独立尝试也观察到两次同 URL 导航、没有 page-crash，失败行保留空指标。这些是开发服务导航相关的失效测量，不是 OOM 证据。先在丢弃 context 准备开发依赖后，50 MB cold / warm 均完成。该准备步骤在对应行 notes 明示。

### 稳定代码复测

关键源文件指纹 `971dbf61da05dac1` 的 10 MB cold / warm：DOM ready 2332.4 / 1639.2 ms，scroll-rAF P95 225.2 / 189.5 ms，browser 树 RSS 峰 1381.371 / 1455.645 MB。滚动路径改为二分后，此大跨度跳转测量仍远高于初始交互预算；有构建等同机负载，不能把有限差值写成因果结论或显著收益。

同指纹的 50 MB 仅复测一次 cold（`--cold-only`）：DOM ready 12074.5 ms、parse 4372.1 ms、scroll-rAF P95 1749.6 ms、browser 树 RSS 峰 3650.512 MB / 末 3102.809 MB，286 个样本。与 before 相比本轮更慢；测量期间存在同机构建负载，不能归因于单个代码改动。两轮都没有支持 50 MB 全量 DOM 的低延迟交互承诺。

同指纹的特殊夹具 cold / warm：

| 夹具 | DOM ready（ms） | all_graphs 额外阶段（ms） | 终态 / 规模 | browser 树 RSS 峰（MB） |
| --- | ---: | ---: | --- | ---: |
| mermaid-100 | 490.7 / 61.6 | 4320.5 / 3060.3 | 两轮 done=100、error=0、pending=0 | 1007.133 / 1159.164 |
| code-heavy（旧规模） | 758.9 / 155.1 | 不适用 | 200 代码块，实际仅 22,637 bytes | 844.426 / 868.039 |
| math-heavy | 843.6 / 105.4 | 不适用 | 500 公式，输出 HTML 1,261,972 bytes | 836.582 / 900.801 |

这三类的 scroll-rAF P95 都约 31.6–31.7 ms。100 图本次全部完成；没有进行并发 1 / 2 / 4 对照，不能据此推导并发最优值。all_graphs 是 DOM ready 之后显式 renderAll 的阶段时长，部分可见图可能已提前开始，不能与完整打开耗时混为同一列。

同指纹的显式 reload 三次，末版标记可见、parse_count_delta=3；这只验证文本替换，未代替真实文件监听。isolation 的六种组合都实际应用了目标正文主题，parseCount / parseMs 不变；同一 App 主题下，正文主题变化没有改变 App 控件颜色 / 字体。计算样式记录在 CSV notes；尚未做 Shadow DOM 实现或视觉验收的 A/B 对照。

50 轮 100 KB 打开 / 关闭，关闭后每个检查点等待 5 s、不强制 GC：第 5 轮 RSS 782.602 MiB，第 50 轮 809.492 MiB，50 / 5 比率 1.034；main `performance.memory.usedJSHeapSize` 从 11,687,487 到 10,361,884 bytes。第 5、10、20、30、40、50 轮均有 CSV 行，使用同一快照记录 RSS 与比率。本轮浏览器观测值小于 1.3，不能替代原生 WebView2 长期使用验收，也不覆盖大文件或多标签泄漏。

稳定代码下，打开 100 KB 文档、静置 5 s 后再采样 60 s：116 个样本，CPU 累计 471.875 ms、单逻辑核 0.791%，browser 树 RSS 峰 767.172 MiB / 末 712.246 MiB。本次浏览器开发环境观测值未达到 AC-10 的 100 ms 目标；原生独立数据见下节，同样未达标。

稳定代码下的空外壳对照，同样静置 5 s 再采样 60 s：104 个样本，CPU 累计 899.125 ms、单逻辑核 1.505%，RSS 峰 626.266 MiB / 末 590.586 MiB。单次样本的空外壳 CPU 反而较高，说明本轮存在浏览器 / 开发服务背景活动与运行间差异；不能把文档开关之间的差值归因于正文逻辑。两次稳定开发口径都没有达到 100 ms 目标。

### 原生 release 的 IPC、样本与 idle

初次原始证据：`native-m0-baseline.json`、`native-summary.json`、`native-tree.csv`。运行版本为 Tauri 2.12.5 / WebView2 156.0.4314.58；EXE SHA256 为 `D7A0502AFE77E1B63A8758B503CC52FA6D9CE6DCAFEA79587B0A2F84087B5DD0`。`complete` 表示探测流程完成，不代表全部验收通过。最终功能复验另写 `native-m0.json`，不将旧资源采样归到新构建。

四档实际 `read_document` 均为 ArrayBuffer 且长度匹配：

| 夹具 | bytes | read / IPC（ms） |
| --- | ---: | ---: |
| 100 KB | 103,414 | 3.7 |
| 1 MB | 1,049,596 | 15.5 |
| 10 MB | 10,486,765 | 109.4 |
| 50 MB | 52,429,974 | 453.3 |

七份固定样本均有报告。`extended.md` 实际加载四张合法本地图片，缺失 / 越界图片无 src，损坏图片保留无法显示提示；Mermaid done=4、error=1，未阻断全文。`theme.md` / `links.md` 各有一张图片实际加载。`basic.md` 的图片快照为 loaded=0 / width=0，未把这两张计为成功加载。七份样本的主题检查均未增加解析次数。

最终功能复验（09:13 UTC，`native-m0.json`，EXE SHA256 `6D8C7AE85A38D0A75EE95E781077CE2B6250B765B7C900181988A27C6D160966`）：修正探针过早检查尚未授权 src 的竞态，先等授权 / 不可用终态再等实际 load / error，保持 DOM ready 定义不变。basic 两张图片均已加载，extended / theme / links 分别为 4 / 1 / 1；图表成功 / 预期失败数不变，七份主题检查通过，四档 IPC 仍为正确 ArrayBuffer。此次四档 read / IPC 为 5.5 / 11.9 / 101.8 / 453.8 ms。新增三项测量回归先红后绿；不把该功能复验当作新构建的资源采样。

之后以 `tabs/a.md` 为最后活动文档、未强制 GC，对 Tauri 根进程树（含 WebView2 后代）采样：60,483.189 ms、71 样本，RSS 峰 845.711 MiB / 末 682.078 MiB，CPU 累计 3628 ms（5.998% 单逻辑核）。已追加单独的 12 列 `native-idle` 行；原始采样与汇总交叉核对一致。

**原生 AC-10 未达标**：3628 ms 明显超过静置约 60 s 的 100 ms 目标。这里的 RSS 峰仅为 IPC 与七份样本完成后的 idle 窗口，不能充当 50 MB 读文件峰值，更没有测 50 MB 大文档 DOM。原生冷启动、首屏 / 完整渲染、交互 P95、多标签与真实 watcher 仍未测。

### code-heavy 规模修正

生成器已将 code-heavy 从 22,637 bytes 修正为 2,104,318 bytes，仍为 200 个代码块，内容为原有八种语言代码片段的确定性重复。新增测试先在旧生成器上因不足 2 MiB 失败，修改后核对约 2 MiB、200 对围栏、绝大部分字节位于代码块及两次生成字节一致。`mermaid-100` / `math-heavy` 生成物哈希未变。旧 22 KB 性能行保留，不倒填或覆盖。

新规模单独 cold / warm 实跑，关键源文件指纹仍为 `971dbf61da05dac1`：

| 指标 | cold | warm |
| --- | ---: | ---: |
| 实际 UTF-8 bytes | 2,104,318 | 2,104,318 |
| 代码块数 | 200 | 200 |
| parse（ms） | 9939.7 | 7958.4 |
| DOM ready（ms） | 12669.8 | 9930 |
| scroll-rAF P95（ms） | 108.4 | 67 |
| 输出 HTML bytes | 32,412,664 | 32,412,664 |
| browser 树 RSS 峰（MiB） | 2046.977 | 2542.109 |
| browser 树末值（MiB） | 2044.785 | 2457.918 |

约 2 MiB 源代码在当前高亮输出下扩为约 32.4 MB HTML；旧 22 KB 行不能代表这一成本。以上为 Vite / Chromium 探索结果，没有补造原生长代码时延或内存。

## T15 尚未测量 / 能力缺口

| 项目 | 状态与原因 |
| --- | --- |
| 原生冷启动 → 首屏 / 完整渲染、P95 | not measured：原生报告当前只含 IPC / 样本及 post-workload idle，没有对应计时 |
| 50 MB 原生读取 / 大文档 DOM 的 RSS 峰 | not measured：四档 ArrayBuffer IPC 已验证，但采样峰仅属于事后的 idle 窗口 |
| WebView2 空闲 CPU | 已测但 AC-10 未达标：3628 ms / 60.483 s；不能标验收通过 |
| 10 / 30 / 100 文档打开、切换、关闭 | not measured：M0 最小阅读器没有完整多标签 registry / eviction 能力 |
| 真实文件监听：直接覆写、临时文件替换、连续保存 | not measured：当前 reload 场景仅显式 openText，未接 OS watcher |
| 文档删除、磁盘替换、权限 / 路径错误 | not measured：需要原生 document registry 与 watcher，不能以浏览器替换文本模拟通过 |
| 缺失 / 越界 / 损坏图片、错误 Mermaid | 原生 extended 样本已有局部失败不阻断全文的报告；不扩大为删除 / watcher / 权限等全部可靠性场景已通过 |
| 约 2 MiB 长代码 | 浏览器 cold / warm 已单独实测，见上节；原生同规模未测，旧 22 KB 行不作替代 |
| 10 MB content-visibility A/B | not measured：当前固定 CSS 路径，未做开 / 关配对运行 |
| Shadow DOM vs namespace A/B | not measured：当前最小阅读器仅 namespace 路径，主题隔离检查不构成两种实现的性能对照 |
| Worker 销毁重建 / Shiki 初始化 | not measured：暂无单独测量接口，不从 parse 时间反推出初始化时间 |
| Mermaid 并发 1 / 2 / 4 对照 | not measured：当前固定并发配置，100 图渲染不等同于并发度对照 |
| 发布入口加载成本 | 当前 dist 入口预加载 Mermaid / KaTeX chunk；构建仍有大 chunk 提示。尚未采集原生冷启动，不将分包本身视为启动优化已完成 |
| Qt 对照 | 按用户决定跳过 T14，不纳入本轮 Web 主线验收 |

## 当前结论边界

T07 的可复现框架与 T15 的能力缺口记录已建立。真实 WebView2 已验证四档 IPC、七份固定样本与 post-workload idle；原生 AC-10 尚未达标，冷启动 / 首屏 / P95、真实文件监听、多标签及其余可靠性仍有缺口。不能据此宣布本轮范围内 T09–T15 或 M0 全部验收通过，也不能冻结缺少实测依据的性能承诺。T14 已按用户决定跳过。
