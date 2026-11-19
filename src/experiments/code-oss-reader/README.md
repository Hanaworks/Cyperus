# Cyperus（Code OSS 主线）

当前为 2026-11-18 的 Cyperus 中英双语免安装试用版，目录约 500 MB。Markdown 和静态 HTML 默认预览，Markdown 大纲在源码视图也可跳转。RC4 移除 Restricted Mode 交互、Agents 窗口、Tree-sitter 和内置终端本地进程，源码着色继续使用 TextMate。免安装候选由现有依赖离线生成生产 bundle 后复制 Electron 与运行依赖，入口直接为 `Cyperus.exe`，不需要源码目录或本机 Node。当前入口、验证结果及历史候选见 [实施计划](../../../docs/dev/code-oss-first-version-plan.md)。

用户已选择 Code OSS 作为首版基座。当前仍保留原试验目录，已生成免安装候选，正式发行验收尚未完成。标签、菜单、Explorer、文件搜索、大纲和状态栏使用真实 VS Code 工作台；正文复用项目已有 Vue ReaderView、Markdown 解析、高亮、数学、Mermaid、消毒和分段显示。Markdown 解析运行在扩展宿主的 Node Worker 中。

## 独立 Code OSS 运行

独立源码宿主已构建。在仓库根目录的 PowerShell 中：

```powershell
& src/experiments/code-oss-reader/launch-code-oss.ps1
# 打开自己的目录，也可使用 -OpenFile 指定文件：
& src/experiments/code-oss-reader/launch-code-oss.ps1 -OpenFolder 'D:\Documents'
```

使用项目内的 Electron 开发运行时和固定 Code OSS **1.145.1** 源码，无需个人安装的 VS Code。启动脚本兼容旧名称的缓存运行时；重新生成的运行时使用 `Cyperus.exe`。无参数启动恢复该配置上次的本地工作区和标签；演示文档可用 `-OpenFile fixtures/extended.md` 打开。Markdown 默认进入预览，主动点击“编辑源码”切换编辑。源码运行仍依赖 `artifacts/code-oss/upstream`。

Windows 程序图标及标题栏沿用原阅读器的黑底白色 M 图标，资源直接取自 `src/host/icons`，由准备脚本接入。

首次构建或重新安装上游依赖后：

```powershell
& src/experiments/code-oss-reader/build-upstream.ps1 -Stage Check
& src/experiments/code-oss-reader/build-upstream.ps1 -Stage Install
node src/experiments/code-oss-reader/prepare-upstream.mjs
& src/experiments/code-oss-reader/build-upstream.ps1 -Stage Build
& src/experiments/code-oss-reader/build-upstream.ps1 -Stage Electron
node src/experiments/code-oss-reader/build.mjs
& src/experiments/code-oss-reader/launch-code-oss.ps1 -Test -Profile code-oss-qa
```

前提为固定上游检出和项目内 Node 24.22.1 已准备好。构建入口默认选择本机预览 MSVC，本轮实际使用 **14.52.36815**；VS 更新后该版本可能变化，应先检查。脚本沿用现有系统代理和 SDK 路径，只设置构建进程的环境。`prepare-upstream.mjs` 写入试验产品标识，并适配上游对 SDK C 盘路径的假设；Electron 校验与签名处理逻辑保留。

独立启动使用 `artifacts/code-oss/profiles/code-oss` 下的用户、共享数据库和扩展目录，清除可能覆盖这些位置的继承环境变量。只加载阅读器运行代码，停用尚未编译的内置语言、调试及测试扩展；静态主题和语法仍可用。

## 在已安装 VS Code 中运行对照

在仓库根目录的 PowerShell 中：

```powershell
node src/experiments/code-oss-reader/build.mjs
& src/experiments/code-oss-reader/launch.ps1
```

此对照入口使用本机 `D:\Microsoft VS Code\Code.exe`。启动参数 `-CodePath` 可指定其他兼容宿主；独立程序使用上方 `launch-code-oss.ps1`。

用户配置、扩展目录放在 `artifacts/code-oss/profiles/interactive`，与个人 VS Code 配置分离。源码通过开发扩展参数加载，不安装到个人扩展目录。无参数启动恢复上次工作区，可用 `-OpenFile` 指定一篇 Markdown。

左侧直接复用原生 Explorer 和文件搜索，文章大纲为独立入口；打开目录形成真实工作区，可浏览其他文件及图片。Ctrl+F 搜索当前预览正文，F3 / Shift+F3 切换匹配。底部状态栏使用 Code OSS 原生控件，源码视图可切换编码、换行符和语言模式。界面主题和正文主题分别通过命令面板切换。

免安装版通过命令面板的「配置显示语言」在 English 和简体中文之间切换，重启后生效。工作台翻译离线随包提供，尚无译文的文案显示英文。Electron 的运行时语言文件仍只打包 `en-US.pak`。

标签栏最右侧直接复用原生图标按钮：编辑源码 / 返回预览、用外部应用打开、打开所在文件夹。正文不额外放置操作栏；关闭面包屑右侧的编辑器类型选择下拉框，源码与预览通过图标切换。有未保存修改时选择保存或取消。默认发现 VS Code / Visual Studio，“…”菜单中的“选择打开方式”可更换或选择其他 `.exe` 并记住选择，也可在当前目录打开外部终端。原生 Explorer 文件右键提供相同操作。旧试验配置的全局只读设置自动迁移，其他偏好及 JSONC 注释保留。

原生编辑器继续提供输入/修改、保存/另存为、撤销重做、查找替换、复制粘贴及静态语法着色；其他文本文件直接使用原生编辑器。RC2 真实宿主自动检查覆盖编辑历史、替换、磁盘保存、返回预览及 JavaScript 文件修改。系统剪贴板、另存为对话框与未保存取消操作列为人工复查项，不计入自动通过数。

## 验证

```powershell
& src/ui/node_modules/.bin/vue-tsc.cmd --noEmit -p src/experiments/code-oss-reader/tsconfig.json
node --test src/experiments/code-oss-reader/*.test.cjs
& src/experiments/code-oss-reader/launch.ps1 -Test -Profile native-qa
# 正常进程退出/重启验证（扩展测试模式会禁用磁盘会话存储）：
& src/experiments/code-oss-reader/test-session.ps1
```

构建直接使用现有 UI 依赖，不修改主项目依赖锁文件。路径测试会在项目 artifacts 内创建测试文件和目录联接；不修改真实文档。集成测试使用独立配置和测试文档，结果写入 `artifacts/code-oss/qa/<Profile>/result.json`。

## 免安装候选构建

先完成 `prepare-upstream.mjs`、阅读器 `build.mjs` 及固定上游准备，再在上游目录运行其离线 bundle（使用已有项目 Node 和依赖）：

```powershell
# cwd: artifacts/code-oss/upstream
& ../tools/node-v24.22.1-win-x64/node.exe --max-old-space-size=12288 build/next/index.ts bundle --nls --target desktop --out out-reader-portable
# cwd: 仓库根目录；目标必须是 dist 内尚不存在的目录
node src/experiments/code-oss-reader/package-portable.mjs dist/Cyperus-Windows-x64-local
& src/experiments/code-oss-reader/test-portable.ps1 -PackageRoot dist/Cyperus-Windows-x64-local
& src/experiments/code-oss-reader/test-session.ps1 -PackageRoot dist/Cyperus-Windows-x64-local -Profile continuity-cyperus-local
# 校验通过后归档；显式 UTF-8 文件名，避免中文说明文件在其他解压工具中乱码。
$readerPackageRoot = (Resolve-Path dist/Cyperus-Windows-x64-local).Path
[IO.Compression.ZipFile]::CreateFromDirectory($readerPackageRoot, "$readerPackageRoot.zip", [IO.Compression.CompressionLevel]::Optimal, $true, [Text.Encoding]::UTF8)
```

双击候选根目录的 `Cyperus.exe`，用户数据保存在相邻 `data/`；移动/升级应保留它。构建清单 `portable-manifest.json` 包含文件哈希，根目录与 app 内保留 Electron、Code OSS 及依赖许可，`licenses/inventory.json` 提供附加清单。候选尚未签名；正式发行还需干净环境与许可审核。

## 宿主与运行包裁剪

停止注册 Debug 视图、扩展市场管理视图、Notebook 用户功能、内置终端/Tasks 菜单与视图、多项 Remote/远程隧道、同步/认证用户贡献、聊天/MCP独立视图和欢迎引导。账号活动栏入口与显示切换已关闭。常用阅读操作继续使用标签栏原生图标。

RC2 用固定上游补丁进一步移除主进程/共享进程中的 AgentHost、SSH/WSL/Dev Containers、远程隧道、Playwright 和内置浏览器后台注册/通道，本地语音及 AgentHost 使用空服务；浏览器/CDP 和两个隧道通道保留无后台行为的兼容接口。内部扩展 API 依赖的管理、终端、调试、Notebook 及部分聊天混合服务继续保留；Git 暂不启用。基础编辑不依赖被移除的功能入口。

`backend-policy.cjs` 管理后台补丁；`package-policy.cjs` 按锁文件的实际运行依赖闭包删除 15 个非核心根依赖及其独占依赖，保留共享依赖和必要 peer（包含标记为 dev 的 tslib）。排除编译符号/静态库/中间文件，保留运行二进制、语法着色 WASM 和许可证。RC2 实际包含 147 个运行依赖和 61 个静态语法/主题扩展，6,193 个清单文件；ZIP 比 RC1 减少约 41%，展开清单减少约 45%。内存与启动速度尚未复测。

同机性能对照使用 `scripts/compare-reader-hosts.ps1`，默认 100 KB / 1 MB / 10 MB 各三轮，两宿主交替顺序、独立配置、顺序执行。Code OSS 探针只在显式设置 `MD_READER_PERF_CONFIG` 且配置位于项目 `artifacts/code-oss/performance` 内时启用；普通阅读不执行。结果目录中的 `complete.json`、`runs.json`、`results.csv` 和进程树 CSV 保留原始证据，运行 `node src/bench/summarize-host-comparison.mjs <结果目录>` 汇总。具体结果与口径见试验记录。

## 已知边界

- 预览本身只读，用户主动切换源码可进行基础编辑。多项宿主用户入口及非核心后台链已裁剪，共享兼容服务仍保留；Git 暂未启用。内置编辑器的文件操作不受正文资源沙箱限制。
- 当前文档目录以内的 Markdown 链接和图片可用，越界、UNC、命令协议被拒绝；普通附件暂不交系统打开。外链由宿主确认后交系统程序。
- 隐藏 Webview 会释放；宿主保留解析结果并恢复滚动和查询。正常退出后的工作区、标签、正文查询和语义阅读位置使用宿主状态恢复；路径别名去重已通过真实宿主回归。多窗口/多显示器、异常断电及全量大文件预算还未验收。
- 现有 M1 的 HTML 缓存预算和标签淘汰规则未迁移，因此不能用此试验推断正式版多文件内存或性能。
- 默认白紫浅色；正文搜索仍使用原生输入框，文件搜索使用宿主搜索视图。独立 Code OSS 将搜索结果源行转发给预览，定位并提示对应渲染块（含远处分段），保留搜索视图焦点；Markdown 语法与显示文字不一一对应，不提供字符级选区映射。该宿主连接由 `prepare-upstream.mjs` 固定版本补丁实现，在未修改的个人 VS Code 对照运行中不可用。
- 已提供独立源码运行及免安装候选；RC2 本轮依赖裁剪完成，其余混合服务仍保留。离线网络核对、签名发行和完整许可审核未完成。
- 源码启动脚本使用扩展开发宿主，同一配置已开着窗口时再次启动可能只重载原窗口；切换目录使用应用内“打开文件夹”，或关闭该配置窗口后重新启动。免安装候选使用生产入口；正式发行的单实例文件转交尚未验收。

完整进度和源码保留说明见 [试验记录](../../../docs/dev/code-oss-experiment.md)。
