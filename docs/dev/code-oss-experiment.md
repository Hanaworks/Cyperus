# Code OSS 工作台试验

> **最新状态：Code OSS 已被用户选为首版主线。** 本文保留最初试验和同机性能测量记录；原“不是切换主线”和只读产品边界已由后续决定覆盖。当前开发范围及验证见 [首版实施计划](code-oss-first-version-plan.md)。原测试与性能数字仍指当时版本，不能代表本轮新增功能后的性能。

2026-11-07 后续交付：原生真实工作区、默认 Markdown 预览、同标签源码编辑/保存返回、外部应用选择与打开、文件夹定位已接通。独立宿主集成 13/13（`artifacts/code-oss/qa/workbench-final/result.json`），模块测试 9/9，前端测试 340/340，类型检查与 Webview/Worker 构建通过。实机核对了未保存取消、保存返回、外部 VS Code 打开和目录定位。当前为可运行开发版；Git、宿主深度裁剪、完整 M1 迁移及发行打包尚未完成。下面保留各次历史记录及当时的口径。

日期：2026-11-07。用户已确认创建试验分支，并允许在项目隔离目录下载、安装构建依赖。系统级组件安装不包含在内。

依据：[备案方案](../design/18-code-oss-alternative.md)。这是一轮可运行的技术试验，不是切换主线，也不宣称达到 M1 功能、安全或性能验收。

## 保存与隔离

- 分支：`codex/code-oss-reader-experiment`。
- 原始 HEAD：`fa78a1876df6`。M1 的未提交改动仍在工作目录，未自动提交。
- 完整 Git 可见源码快照：`artifacts/code-oss-baseline-20261107/m1-source.zip`，4486 个文件；SHA256 `CD3D11B5A3D79CBF8B2FEBDE28DA23952995D5C3383E72DE142368DEDABD9DCE`。
- 快照不含忽略的依赖和构建产物；现有免安装包留在 `dist/`。
- 上游独立检出：`artifacts/code-oss/upstream`，固定标签 `1.145.1`，不混入主项目依赖管理。
- 扩展源代码：`src/experiments/code-oss-reader`。阅读正文复用 `src/ui/src/reader/ReaderView.vue` 和现有解析、消毒、搜索、分段、图表模块。

## 本轮顺序与检查

- [x] 保存 M1 快照，创建分支。
- [x] 跑通只读自定义编辑器、Node 解析 Worker 与现有 Vue 阅读层。
- [x] 接入原生文件树、大纲、正文搜索和独立正文主题；标签由工作台管理。
- [ ] 检查本地图片、跨文档链接、外部保存刷新、隐藏/恢复状态（图片/图表/保存/删除恢复已通过；完整链接与重启状态仍待补齐）。
- [x] 使用隔离用户目录在本机 VS Code 上执行扩展集成检查。
- [x] 检出并构建独立 Code OSS，在自身 Electron 中通过阅读器集成检查；源码运行，不含发行打包。
- [x] 留下启动入口和实际结果，实机截图已在会话中展示；记录未迁移功能。

## 试验边界

扩展自身只读取文件，资源请求按文档目录做真实路径校验；正文不直接访问文件系统。试验宿主仍是完整开发工具，其原生编辑器和其他菜单尚未形成只读产品边界。独立产品的文件系统隔离、菜单裁剪、发行许可清单、全量 M1 回归及性能对比属于后续验证，不能因本轮跑通而标记完成。

上游构建依据：[官方构建说明](https://github.com/microsoft/vscode/wiki/How-to-Contribute)、[固定版本运行时要求](https://github.com/microsoft/vscode/blob/1.145.1/.nvmrc)。扩展接口依据：[只读自定义编辑器](https://code.visualstudio.com/api/extension-guides/custom-editors)、[Webview](https://code.visualstudio.com/api/extension-guides/webview)。

## 2026-11-07 实测记录

- 本机宿主：VS Code **1.145.2**，commit `c4453f8ea430795f941c1b2ff6c9321135a74a02`；这与待构建上游 **1.145.1** 明确区分。
- 固定上游 commit：`6bab64e2d12b04d04c0d99c27ff166023efd1dda`。项目内 Node **24.22.1** 已下载、校验并解压，未替换系统 Node。
- 扩展 Webview + Worker 构建通过；Webview TypeScript 检查通过；本地路径/编码/目录联接越界拒绝测试通过。
- 原生扩展集成：`artifacts/code-oss/qa/native-qa-2/result.json`，6 项通过：自定义阅读页实际显示、正文搜索 2 处匹配、双标签切换/隐藏后恢复、外部保存更新、删除后恢复、原生大纲打开。
- 实机查看 `fixtures/extended.md`：原生文件树、原生大纲跳转、Mermaid 流程图、同目录/子目录/中文名图片均正常显示。试用配置：`artifacts/code-oss/profiles/interactive`。
- 上游依赖安装第一次因 Electron `node.lib` 下载超时退出。现已从 Electron 官方最终地址成功下载并校验 **43.8.3** 头文件及 x64 链接库，放入项目内缓存。
- 首次编译 `@vscode/windows-mutex` 时，MSVC **14.51.36231** / Visual Studio **18.11** 被正确识别，但出现 **MSB8040：缺少 Spectre 库**。证据：`artifacts/code-oss/native-toolchain-check.log`。此历史阻塞已由用户补装组件解决，见下节。
- 独立 Code OSS 后续已构建和运行；尚未打包。当前源码开发版与 Tauri 发布版的性能对照见末节。

## 系统组件补齐后的继续验证

用户确认开发阶段采用预览工具链，随后自行完成组件安装。实时复查：默认 MSVC 14.51.36231 的 Spectre 库已存在；预览 MSVC **14.52.36815** 的编译器、Spectre、ATL 和 MFC 库均已存在。MSBuild 属性求值已确认设置当前进程 `VCToolsVersion=14.52.36815` 后实际选择该版本目录，系统默认工具链保持 14.51。

构建入口 `build-upstream.ps1` 默认读取 `Microsoft.VCToolsVersion.Preview.txt` 明确选择预览版；支持 `-Toolchain Default`。后续正式发布需另行固定稳定工具链并重建验证。本轮继续项目内依赖安装、客户端构建和独立宿主运行验证。

- 上游完整依赖安装完成，退出码 0：`artifacts/code-oss/npm-install-proxy.log`。首次安装包含上游附属扩展与测试工具，耗时约 13 分钟；不代表这些功能已接入阅读器。
- 下载器使用当前 Windows 代理，通过进程级 `HTTP_PROXY` / `HTTPS_PROXY` 和 Node `--use-env-proxy` 解决 GitHub DNS 失败，未改系统代理。
- 客户端 `build-fast --client-only` 成功：`artifacts/code-oss/client-build.log`。这是开发转译构建，不等同于全上游类型检查或全套测试。
- Electron **43.8.3** 准备成功：`artifacts/code-oss/electron-build-sdk.log`。Windows SDK 实际在 `D:\Windows Kits\10`，上游 `gulp-electron` 写死 C 盘；项目准备脚本仅适配 SDK 查找，继续使用已安装 signtool 和原校验逻辑。
- 独立宿主：`artifacts/code-oss/upstream/.build/electron/Markdown Reader Lab.exe`；应用标识 `Markdown Reader Lab (Code OSS Experiment) Dev`，源码根目录和版本 **1.145.1** 均由集成检查断言。
- 最终集成检查 **8/8 通过**：`artifacts/code-oss/qa/code-oss-qa-final/result.json`。包括宿主身份、正文渲染、搜索、多标签及隐藏恢复、外部保存、删除重建、大纲入口、仅阅读器运行扩展激活。
- 实机显示已核对；源码版原有未编译语言/测试扩展会报错，独立启动入口现停用这些运行扩展，保留静态主题与语法。
- 启动隔离复核修复两项：清除继承的 `VSCODE_APPDATA` / `VSCODE_PORTABLE` / `VSCODE_EXTENSIONS`，并显式指定 profile 内 `--shared-data-dir`。带干扰环境变量的集成启动通过，未创建 `qa/unexpected-*`；交互共享数据库实际生成在项目 profile 内。
- 复核取舍：开发阶段继续读取本机 Preview 版本，不宣称工具链永久锁定；VS 更新后可能换编译器，正式发布仍需固定稳定版本重新验证。

试用入口：`src/experiments/code-oss-reader/launch-code-oss.ps1`。M1 源码与原免安装包保留；未提交或推送。本次完成独立宿主的可运行验证，尚未完成完整 M1 移植、只读宿主裁剪与发行打包。

## 2026-11-07 当前两版同机性能对照

用户要求实测当前 Code OSS 与 Tauri 的内存、启动和性能差异。本节补齐此前未做的同机对照；仍不代表 Code OSS 发行版验收，也没有执行尚待确认的功能裁剪。

原始结果：`artifacts/code-oss/performance/20261107T064049-b93ce449`。`complete.json` 确认 18 次独立运行完成；36 条冷开/关闭后重开记录全部完成段遍历，errors 为空。统计在 `summary.json`，逐次证据在 `runs.json`、`results.csv` 及各子目录 `process-tree.csv`。先行校准运行不计入统计。

环境：Ryzen 7 8845HS，16 逻辑核，约 15.3 GiB 可见内存，Windows 11 10.0.26300，150% 缩放。测量开始可用物理内存约 3.3 GiB，保留用户其他程序，因此是本机实际多应用环境，不是空载实验室。Tauri 为既有发布 EXE（SHA256 `FF27824B88AC3D0687F9B1C8CACC45469AB91801F7DC921640954F03518F9231`），WebView2 156.0.4314.58；Code OSS 为 1.145.1 的源码开发运行，Electron 43.8.3，开发缓存日志明确为 inactive，未做发行优化或功能裁剪。

方法：各文件各宿主三次新进程、新配置启动，宿主先后顺序按轮交替；不清 OS 文件缓存、不强制 GC。两版外窗目标 1100×800，但工作台和正文可用区域不同，实际 viewport 已记录。启动从 OS 进程创建计到 ReaderView 可读通知；正文打开另从打开请求计时。内存为整个进程树工作集合计，可能重复统计共享页；采样间隔目标 200 ms，CIM 采集耗时使实际间隔更长，不能视为精确 OS 峰值。

下表均为三轮中位数。峰值覆盖首次打开、全文遍历、关闭后重开和最终回到 100 KB 文档的活动流程，不是单独的首屏或静置内存。

| 文件 | Tauri 启动至可读 | Code OSS 启动至可读 | Tauri 活动峰 MiB | Code OSS 活动峰 MiB |
|---|---:|---:|---:|---:|
| 100 KB | 2.19 s | 5.63 s | 742 | 2061 |
| 1 MB | 2.43 s | 5.91 s | 890 | 2219 |
| 10 MB | 3.66 s | 7.27 s | 1275 | 2692 |

小文档静置：完成 100 KB 冷开/重开流程，再打开同一 100 KB，等待 5 秒，然后取约 20 秒窗口。工作集中位数 Tauri **728.39 MiB**，Code OSS **1995.14 MiB**，约 **2.74 倍**。CPU 按一逻辑核 100% 的中位数为 **8.12% / 9.46%**，折算 16 核整机约 **0.51% / 0.59%**；三轮范围分别为单核 **7.67–9.83% / 7.46–15.17%**，短时波动较大，不能替代长期待机测试。

正文层：100 KB 首次打开至可读 **452 / 499 ms**；1 MB 为 **700 / 798 ms**；10 MB 为 **1822 / 2062 ms**（顺序均为 Tauri / Code OSS）。10 MB 首次打开到完整段遍历 **9.36 / 9.83 s**，纯解析中位数 **1166 / 1140 ms**。1 MB 关闭后重开至可读 **300 / 649 ms**；这里不是保留标签之间的切换。

脚本滚动到下一次 rAF 的每轮 P95 中位数：100 KB **31.85 / 31.65 ms**，1 MB **46.75 / 39.60 ms**，10 MB **33.60 / 31.60 ms**。这是各轮 30 次程序滚动采样，不是真实鼠标/键盘端到端延迟；正文可用区域及引擎版本不同，不据此宣称某框架滚动更快。

结论仅限当前实现：Code OSS 开发宿主的启动和常驻开销显著更大，正文核心成本接近。不能把这些倍数当成优化发行版 Code OSS 对 Tauri 的固有差异；发行构建和裁剪之后需用同一流程重测。50 MB、多标签常驻、真实输入延迟、长期空闲尚未纳入本次对照。
