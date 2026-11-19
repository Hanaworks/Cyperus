# M0 基准环境与复现

现场读取日期：2026-11-04。当前工作树有未提交修改；每行结果记录 HEAD + `-dirty`，不能视为该 HEAD 的干净版本。

新版浏览器行的 notes 另记 `ui_source_sha256`：按路径排序，将 App.vue、ReaderView.vue、parse.worker.ts、core/markdown/index.ts 的路径与原始字节合并计算 SHA256，取前 16 位。它标识这四个关键源文件，不是整个仓库的哈希。旧行未记录指纹，视为 unknown，不按现有内容倒填；原生行使用实际 EXE SHA256。

| 项目 | 本机现场值 |
| --- | --- |
| 操作系统 | Windows 11 Pro for Workstations，内核 10.0.26300 |
| CPU | AMD Ryzen 7 8845HS w/ Radeon 780M Graphics，16 逻辑核 |
| 物理内存 | 16,419,299,328 bytes，约 15.29 GiB |
| Node / pnpm | 24.15.0 / 11.15.0 |
| Playwright | `@playwright/test` 1.64.1，复用已安装 Chromium 156.0.8078.4 |
| Chromium 路径 | `C:\Users\Mana\AppData\Local\ms-playwright\chromium-1248\chrome-win64\chrome.exe` |
| WebView2 | 安装目录存在 156.0.4314.50、156.0.4314.58；本轮原生报告确认运行版本 156.0.4314.58 |
| 原生 release | Tauri 2.12.5，Rust 1.99.1；EXE SHA256 `D7A0502AFE77E1B63A8758B503CC52FA6D9CE6DCAFEA79587B0A2F84087B5DD0` |
| 浏览器视口 | 1440 × 900 CSS pixels，headless，默认 deviceScaleFactor=1 |
| 浏览器构建模式 | Vite dev，`VITE_M0_BENCH=1`、`VITE_IPC_MOCK=1` 仅传给子进程 |
| 字体 | 本机现有字体、项目默认字体栈；不下载字体 |
| 电源 / 其他负载 | 未固定电源模式；同机协作开发仍有其他负载，本轮是探索测量 |

## 夹具

生成器与固定种子：`src/bench/gen-fixtures.mjs`。现有生成物直接复用，缺失时只运行相应 `--only large` 或 `--only special`，不改写 tabs 样本。

| 夹具 | 实际 UTF-8 字节数 |
| --- | ---: |
| 100kb.md | 103,414 |
| 1mb.md | 1,049,596 |
| 10mb.md | 10,486,765 |
| 50mb.md | 52,429,974 |
| mermaid-100.md | 13,367 |
| code-heavy.md | 2,104,318（修正后）；旧轮 22,637 |
| math-heavy.md | 26,298 |

`code-heavy.md` 已修正为 200 个代码块、约 2 MiB（2,104,318 bytes）；块内重复既有八种语言的代码片段，确定性测试覆盖尺寸、块数、代码占比与两次生成字节一致。早期约 22 KB 的 CSV 行保留，按 notes 的实际字节数区分；不能把两种规模混成同一对照。其余特殊夹具的生成内容与字节哈希未变。

## 复现命令

```powershell
node --test src/bench/web-bench.test.mjs src/bench/gen-fixtures.test.mjs
node src/bench/web-bench.mjs --scenario idle
node src/bench/web-bench.mjs --scenario idle --fixture 100kb
node src/bench/web-bench.mjs --scenario open --fixture 100kb
node src/bench/web-bench.mjs --scenario open --fixture 50mb --cold-only
node src/bench/web-bench.mjs --scenario matrix
node src/bench/web-bench.mjs --scenario reload --fixture 100kb
node src/bench/web-bench.mjs --scenario isolation --fixture theme
node src/bench/web-bench.mjs --scenario lifecycle --fixture 100kb --iterations 50
```

默认只在 `127.0.0.1:1421` 启动本次 Vite 子进程，端口已占用则失败。可用 `--base-url http://127.0.0.1:1420` 连接调用者已启动的服务器；该模式不停止外部服务器。可用 `--browser-path` 指向现有 Chromium；脚本不安装浏览器。退出时只关闭本次启动的浏览器、Vite 和采样器。

open / matrix 默认各测 cold 与 warm；`--cold-only` 只测 cold，用于控制大文件复测耗时。缺少 warm 行不表示测量失败。

本执行环境的受限子进程启动 Chromium 曾返回 `0xC0000022`；相同本地启动命令在获批的提升权限执行中成功，不需要安装或改系统配置。默认 Playwright 缓存路径也会被重定向；脚本会查找用户目录已有的相同 revision，或接受显式 `--browser-path`。

原生进程树独立采样（必须指定真实应用 PID）：

```powershell
powershell -NoProfile -File src/bench/sample-tree.ps1 -RootProcessId 1234 -DurationSeconds 60 -IntervalMs 200 -OutFile benchmarks/native-tree.csv
```

输出目录必须已存在，已有采样文件不会被覆盖。若本机执行策略禁止 `-File`，基准驱动在本次 PowerShell 进程内读取本地脚本为 ScriptBlock 并执行，不改变执行策略、注册表或系统环境变量。

最终 release 功能复验（不重采 idle）：

```powershell
$verifyNative = [scriptblock]::Create((Get-Content -Raw scripts/verify-m0.ps1))
& $verifyNative -RepoRoot (Get-Location).Path -IdleSeconds 0
```

省略 `-IdleSeconds 0` 会额外采样约 60 秒，成功校验后替换固定原生采样文件；失败保留旧 CSV。辅助脚本只关闭自己启动的程序。最新功能复验为 09:13 UTC，release SHA256 `6D8C7AE85A38D0A75EE95E781077CE2B6250B765B7C900181988A27C6D160966`；初次报告与原生 idle 使用早一轮 hash，两者分别保留，不混用。

## 测量口径

- `results.csv` 保留设计 §9 的 12 列；未测字段为空，不填 0。
- idle 默认空外壳；显式 `--fixture 100kb` 则测已打开文档的静置。二者都先完成状态切换并静置 5 s，再采样 60 s。首轮开发期记录早于加入 5 s settle，按其 notes 区分。
- Web 行明确标为 browser Chromium + Vite dev。首屏 / 完整渲染从 `window.__M0__.openText` 起算，**不含 Rust / WebView2 创建、原生 IPC 和磁盘读文件**；不能充当桌面冷启动结果。
- `full_render_ms` 当前表示 DOM + 双 rAF ready，不含异步 Mermaid。包含图表的行另在 notes 记录 `all_graphs.elapsedMs` 与 done / error / pending；pending 非 0 时明确标为不完整，不能当 100 图完整渲染时间。
- cold 指新浏览器 context 从欢迎页首次打开；warm 指同 context 再次打开。matrix 各夹具新建 context，同一次 browser 进程持续存在，因此并非原生进程冷启动。
- 新版驱动先在一个丢弃的 context 打开极小的公式 / Mermaid 文本，以完成 Vite 开发依赖优化，处理首次依赖发现可能引起的导航，再开始新 context 测量。对应行明确带 `dev dependencies warmed in discarded context`；早期行无此步骤。准备过程不计入首屏时间，browser 进程缓存可能保留。
- 交互是 100 次设置阅读区 scrollTop 到下一次 rAF 的 nearest-rank P95，包含帧调度，不等同于原生输入延迟；多标签切换尚未实现，不能代测。
- CDP `SystemInfo.getProcessInfo` 只用来确定本次 browser 根 PID；RSS / CPU 由 `sample-tree.ps1` 汇总该进程树，包括 renderer / GPU 等子进程。真实 Tauri 场景必须对 Tauri 根 PID 另采，包含其 `msedgewebview2.exe`。
- RSS 是各进程 Working Set 之和，包含重复计数的共享页；快照之间等待 200 ms，另有查询开销，可能错过短时峰值。`rss_stable_mb` 是场景末次样本，不是长期稳定性保证。
- CSV 的 `*_mb` 按 bytes / 1,048,576 计算，单位实际为 MiB，保留原有列名以兼容设计格式。
- `native-idle` 为实际原生 release，依据 `native-summary.json` / `native-tree.csv`：完成四档 IPC 与七份固定样本后，以 `tabs/a.md` 为活动文档，未强制 GC，CIM 记录 60,483.189 ms / 71 个样本，包含 WebView2 后代。其采样间隔以原始时间戳为准，不套用浏览器驱动的 200 ms 配置。
- 原生行的 RSS 峰仅限上述 idle 窗口，**不覆盖此前 50 MB IPC 读取峰值，也没有测 50 MB 大文档 DOM**。原生冷启动 / 首屏 / P95 仍未测；`native-idle` 的这些字段留空。
- 初次原生记录 `native-m0-baseline.json` 四档 `read_document` 返回均为 ArrayBuffer、字节长度匹配；50 MB 为 52,429,974 bytes / 453.3 ms。该耗时包含实际读取 / IPC 调用，不等同于正文解析或首屏时间。`native-summary.json` / CSV 的 native-idle 对应该轮发布 EXE；最新功能复验 `native-m0.json` 独立记录，不挪用旧采样峰值。
- CPU 取每个被观测进程的累计 CPU 时间差，100% = 一个逻辑核。新出现进程从其累计时间计入；两次快照之间结束的短进程可能漏计，故空闲 CPU 是观测值。
- 驱动拒绝已退出采样器、失效根 PID、超过 5 s 的旧末样本、未覆盖所请求静置时间的窗口，以及空白 / NaN / 负数采样字段；这些情况留失败记录，不用 0 代替未测。
- SIGINT / SIGTERM 会取消等待与测量，以失败状态退出并清理本次子进程，不把中断后的短采样记为成功。
- lifecycle 在第 5、10、20、30、40、50 轮关闭后等待 5 s，记录 heap 与 RSS；不强制 GC。第 50/5 轮 RSS 比率只解释为浏览器探索结果，原生 ≤1.3 仍待验证。
- reload 是同名文本显式替换三次，验证末版正文；不是 OS 文件监听。
- isolation 验证六种主题组合不增加 parseCount / parseMs、Markdown 主题不改变 App 控件颜色 / 字体；记录计算样式，不冒充 Shadow DOM 对照或视觉验收。
