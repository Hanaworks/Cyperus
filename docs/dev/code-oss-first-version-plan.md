# Code OSS 首版：阅读与便捷操作实施计划

> 本文负责阶段 1 的 Code OSS 集成规格与执行记录。VSIX 和精简独立版的阶段目标见 [Cyperus 目标与里程碑](cyperus-milestones.md)。

> 执行方式：在现有 `codex/code-oss-reader-experiment` 分支内逐项实现、验证，最后做一次独立代码复核。用户已确认继续推进；不再重复征求同一范围的执行许可。不提交、不推送、不新建工作树、不安装依赖。

**Goal:** 首版以 Code OSS 为主线，交付原生目录浏览、Markdown 阅读/源码切换和直接可见的文件操作。

**Architecture:** 保留原生工作台、文本编辑器、语法、图片预览和内部扩展机制；现有 Vue ReaderView 与解析 Worker 继续负责 Markdown 预览。辅助功能复用宿主；Tauri 源码和既有交付作为备选保留。

**Tech Stack:** Code OSS 1.145.1 / Electron 43.8.3 / 现有 Node、Vue、TypeScript 依赖。

**Spec:** 本文“确认的产品规格”来自本次连续对话；历史参考为 `docs/design/18-code-oss-alternative.md` 与 `docs/dev/code-oss-experiment.md`。

## 确认的产品规格

- Markdown 预览为主。辅助编辑、图片预览、Git 等提供方便，不扩展为完整 IDE。
- 常用动作直接可见：标签栏最右侧复用原生图标，提供编辑源码 / 返回预览、外部应用打开、打开所在文件夹；更换应用置于原生“…”菜单。按后续用户反馈取消正文自制操作栏及编辑器类型选择下拉框。
- 默认打开 Markdown 进入预览；明确点击编辑才进入源码。沿用原生保存/撤销和未保存提示；返回预览前不得静默丢弃编辑。
- Explorer 使用真实工作区，可打开 Markdown、图片和其他文件；大纲保持独立入口，文件搜索复用原生搜索，正文搜索沿用 Ctrl+F。
- 外部打开针对当前文件；记住选择，支持选择其他本地应用；终端为低频选项，打开于文件目录。外部保存后预览刷新。
- Git 后续接入但保留所需基础。远程开发、调试、AI、Notebook、市场等后续分组裁剪；当前先形成可用阅读流程。
- 2026-11-07 选型记录：首版集成选择裁剪 Code OSS。2026-11-19 补充 VSIX 和精简独立版两个后续里程碑，独立版可用既有 Tauri 基线对照，见文首路线。

## Global Constraints

- 不修改个人 VS Code 配置、系统文件关联或环境变量；启动与测试使用项目隔离配置。
- 外部应用必须通过宿主可见操作选择；执行使用独立参数，不拼接 shell 命令。拒绝自身可执行文件、非本地资源、失效路径。
- 预览正文的资源、链接和脚本隔离沿用既有约束；不向文档开放任意命令执行。
- 文档目录使用既有 `docs/dev` 约定。保留历史测试数据，不把开发版跑通当作首版发布完成。

## Review Focus

1. 中文、空格、`&` 等文件名必须作为单个路径传给应用，不作为命令解释（任务 2 的真实子进程参数测试）。
2. 同时打开多个文件时，动作必须作用于当前文档，不使用过期的全局 active（任务 1 的原生切换检查、任务 2 资源定位）。
3. 未保存源码返回预览不得丢失内容（任务 1 原生 dirty 文档与保存回读）。
4. 旧隔离配置的全局只读规则需要迁移，其他用户设置保留（任务 1 配置迁移测试）。
5. 应用被移动/卸载、自身应用被误选、未配置编辑器时应可恢复（任务 2 边界测试和错误提示）。

## Task 1: 原生文件浏览与源码编辑

**Files:** 修改 `extension.cjs`、`package.json`、`launch.ps1`、`launch-code-oss.ps1`；新增 `profile.cjs`、`profile.test.cjs`；扩展 `integration.cjs`（均在 `src/experiments/code-oss-reader`）。

**Interfaces:** `api.openFolder(file)` 打开真实工作区；`mdReader.editSource` 和 `mdReader.preview` 接受可选文件 Uri；`profile.cjs` 幂等迁移项目隔离配置。

- [x] 先增加原生集成断言：真实工作区、预览默认关联、源码保存后预览内容正确、图片原生打开，运行观察缺失行为。
- [x] 移除重复文件/搜索容器，原生 Explorer 替代私有 folder 状态；保持独立大纲和 Ctrl+F 正文搜索。
- [x] 取消旧试验的全局只读配置，保留现有其他设置。源码切换用同标签原生重新打开；未保存返回时明确保存或取消。
- [x] 执行配置单测和独立 Code OSS 集成检查，确认原有阅读检查不回退。

## Task 2: 常用文件操作直接可见

**Files:** 新增 `external-apps.cjs`、`external-apps.test.cjs`；修改 `extension.cjs`、`package.json`、`webview/App.vue`、`webview/style.css`。

**Interfaces:** 外部应用模块提供发现、路径校验、无 shell 启动；原生标签栏及 Explorer 菜单调用宿主命令并传入 Uri，正文不提供执行外部应用的消息接口。

- [x] 先写并运行真实参数传递、环境清理、缺失程序、自身程序拒绝测试。
- [x] 自动发现 VS Code/Visual Studio，允许手选 `.exe` 并记忆；明确分离应用与参数；终端工作目录为文档目录。
- [x] 标签栏右侧原生图标直接显示三项常用操作；更换应用放入“…”菜单，Explorer 右键接入相同命令。
- [x] 编译、类型检查、模块单测和真实桌面验证，确认按钮可见、目标正确、外部保存刷新。

## Task 3: 主线文档与交付核对

**Files:** 修改 `README.md`、`docs/design/18-code-oss-alternative.md`、`docs/dev/code-oss-experiment.md`、阅读器 README；本计划记录完成与遗留。

- [x] 将当前路线明确为 Code OSS 首版，保留 Tauri 历史记录。
- [x] 完成原生集成回归与 UI 实机检查；独立复核本轮改动。
- [x] 留下可运行入口、验证证据与未完成项。深度裁剪、Git、发布打包及性能复测列入下一阶段。

## 执行记录

- 2026-11-07 后续 UI 收敛：按用户截图复用 `editor/title` 原生图标，删除正文工具栏及其消息接口；通过 `breadcrumbs.showEditorType: false` 关闭类型选择下拉框。外部应用选择移入“…”菜单。构建、类型检查、模块测试 9/9、前端测试 338/338、原生集成 13/13 通过（删除的 2 项测试专门验证已移除的自制工具栏）。证据为 `artifacts/code-oss/native-icons-build.log`、`native-icons-ui-tests.log`、`qa/native-icons-qa/result.json`。
- 2026-11-07：开始。在用户已有试验分支内工作，未提交的 M1 成果保持原状；因此不使用基于提交范围的自动工作区脚本，以本文件和项目 artifacts 记录测试，避免混入历史改动。
- 任务 1 → 任务 2：Uri/当前文件动作共用宿主路径验证；原生编辑器返回预览由任务 1 命令负责。无接口冲突。
- 任务 1：原生工作区检查先失败（undefined），接入真实目录后通过。源码检查曾因 Windows 盘符大小写误报，记录实际 Uri 后改为不区分大小写；未改变产品来迎合测试。最终独立宿主 13/13，包含原生启动参数打开文件，`artifacts/code-oss/qa/workbench-final/result.json`。
- 任务 2：工具栏 DOM 行为 2 项 RED→GREEN；外部进程参数/环境/错误处理与配置单测通过；已有前端全套 340/340。日志为 `artifacts/code-oss/workbench-ui-tests.log`、`workbench-node-tests.log`，编译日志为 `workbench-build.log`。Vite 仍提示大块警告，上游旧图标仍有 PNG 色彩配置警告。
- 独立复核发现三项 P2：原生 reopen 会扩展多选标签、JSON.parse 不接受设置注释、启动环境在换目录后重复打开旧文件。均增加失败测试并修复：先聚焦/重开当前输入清除多选；复用固定上游 JSONC 解析与保留注释编辑；启动文件直接交给原生 CLI，移除扩展激活时读取环境变量打开文件的逻辑。修复后模块测试 9/9，原生集成 13/13。三项复核问题均已处理。
- 实机检查：工具栏三个常用操作可见；源码编辑后未保存提示出现，取消后保留修改；保存返回后预览显示更新内容；外部打开将同一测试文件交给个人 VS Code（并未切换其已有工作区）；打开所在文件夹定位正确；选择器显示 VS Code、Visual Studio、其他应用和终端。仅操作项目内测试文档。
- 可运行入口：`src/experiments/code-oss-reader/launch-code-oss.ps1`，支持 `-OpenFolder` / `-OpenFile`；最终试用使用 `workbench-ready` 独立配置。当前阶段为本计划三项任务完成，不等同于完整首版发布完成。

## 下一阶段（未完成）

### 本轮已完成：默认预览与阅读连续性

用户已确认保持当前原生图标布局继续推进。执行沿用本分支与现有依赖，不提交、不安装；以下三项在当前会话完成并做一次整体复核。

- [x] 默认预览：扩展 `integration.cjs`，通过原生打开检查所有受支持 Markdown 扩展名，以及源码标签关闭后重新打开；显式源码编辑仍可用。
- [x] 搜索定位：`prepare-upstream.mjs` 对固定上游 `CustomEditorInput.applyOptions` 添加仅针对 `mdReader.preview` 的行号消息；`App.vue` 接收后调用 `ReaderView.revealLine`，分段文档按源行加载并定位对应渲染块，保留搜索视图焦点。先用真实宿主打开含 selection 的文档观察失败，再完成实现和回归。定位粒度为渲染块；Markdown 标记不保证字符一一对应。
- [x] 会话恢复：去掉无参数启动时强行打开演示文件，复用宿主恢复工作区与标签；正文状态增加语义锚点，在原有 Webview state 中保存。通过同一隔离配置的两次进程启动核对标签、查询、阅读位置恢复。保留不存在文件的原生错误页，不自动删除记录。

复核重点：定位早于首次渲染、已有标签再次定位、分段远处目标、保留焦点、显式源码选择与默认预览不冲突、无参数启动不会重置会话。整体 M1、Git、裁剪及发行仍另行推进。

验证记录（2026-11-07）：
- 默认打开检查覆盖 `.md`、`.MD`、`.markdown`、`.mdown`、`.mkd`；正常源码关闭后重新打开仍为预览。
- 原生集成 15/15：`artifacts/code-oss/qa/continuity-final2/result.json`；前端 341/341：`artifacts/code-oss/continuity-ui-tests.log`；模块 9/9，类型检查及 Webview/Worker 和宿主增量构建通过。
- 独立复核发现定位与外部保存并发时会丢弃待处理行号；新增真实 App/SegmentView 异步回归，先失败再修复为仅成功且代次相符时消费请求。另补真实 structuredClone 测试，修复 Vue 响应式锚点跨消息边界失败。
- 原生扩展测试模式明确禁用磁盘会话存储，因此增加 `test-session.ps1`：仅在专用 QA 配置载入本地测试驱动，使用正常退出和无参数重启。源码开发宿主冷启动不读取其开发窗口记录，启动脚本现从原生存储恢复本地目录/工作区，兼容 Windows 编码盘符。标签和正文仍由宿主原生持久化。
- 两次正常进程验证通过：`artifacts/code-oss/qa/continuity-live-pass/session-prepare.json`、`session-restore.json`。恢复同一工作区、两个预览标签、活动标签、查询及同一段落内位置；字体和延迟布局会改变绝对 scrollTop，因此验收使用语义段落及段内比例。
- 实机 UI 自动化本轮遇到 `GetCursorPos` 拒绝访问，已停止桌面输入；本轮行为验证来自独立真实宿主集成和正常进程恢复测试，未宣称完成搜索面板的鼠标点选目视验收。

### 后续未完成

### 2026-11-11 补齐与交付候选（本轮完成）

用户确认继续补齐，沿用当前 Code OSS 和原生图标布局；允许相关文件修改、测试、构建和本地运行。继续使用现有试验分支，不提交、不推送、不新增依赖安装。现有 M1/Tauri 文件保持为历史基线。

- [x] 阅读边界：检查文档删除/重建、原子替换、路径别名去重与 Markdown 链接，针对真实缺口修复并增加集成回归。涉及 extension/security 及相关测试。
- [x] 首轮宿主裁剪：用可重复的固定上游补丁移除不需要的工作台贡献/入口，保留 Explorer、Search、源码编辑、图片、静态语法/主题及内部扩展机制。记录实际移除与仍保留的依赖；不据此宣称体积或性能提升。涉及 prepare/profile 及独立 policy 模块。
- [x] 免安装候选：审计现有 Electron、out 和运行依赖，生成独立目录和启动入口、产物清单/许可说明；在独立路径、独立数据目录中实际运行。若完整发行构建还缺外部组件，保留具体阻塞，不将源码快捷方式当作免安装交付。
- [x] 统一验证：模块/共享前端检查、独立宿主集成、正常会话恢复；桌面可用时补搜索鼠标点选目视检查；更新当前状态和遗留项。

任务分工：阅读边界、宿主裁剪独立实现，打包先只读审计后由主代理实现；统一安排原生运行，避免测试窗口互相重载。

本轮实际交付：`dist/Markdown-Reader-CodeOSS-Windows-x64-20261111-rc1.zip`、同名目录及 `.sha256`。直接双击目录中的 `Markdown Reader Lab.exe`；使用生产运行入口、包内依赖和内置阅读器，无需源码检出、本机 Node 或开发启动参数。用户数据默认在包旁 `data/`。

实现与验证：

- 阅读边界修复：绝对文件路径不再二次按 URL 解码；含 `#`、`%` 的子目录链接可打开，目录/realpath/ADS 约束仍保留。同一文件的原生路径别名共用标签和阅读状态；原子替换沿用目录监听并经真实回归验证。
- 恢复回归修复：真实组件测试复现首次空状态 render 后同代次恢复位置失效；App 首次输入为空时使用本地保存的 bootstrap state，非空宿主状态及后续输入仍优先。未放宽恢复断言。源码和免安装版正常关闭/无参数重启均通过。
- 首轮裁剪停止注册 Debug 视图、市场管理视图、Notebook 用户功能、内置 Terminal/Tasks 视图与菜单、多项 Remote/Tunnel/同步/认证、独立 AI/MCP 视图与引导。共享终端/调试/Notebook/扩展管理服务保留，Chat shared/ChatSessions 混合服务根仍保留，AI 配置关闭。运行依赖未做深度删除。
- 官方离线 bundle 使用既有依赖完成生产 JS/CSS、NLS、预载和静态资源。修复首次候选的 TextMate WASM 生产路径遗漏，补 `node_modules.asar` 浏览器库与 unpacked WASM；最终渲染日志无 `[error]`。保留 Electron/Code OSS 通知、438 项附加许可元数据、237 个运行依赖、61 个声明式内置扩展。
- 模块 19/19：`artifacts/code-oss/completion-node-20261111.log`；前端 343/343：`completion-ui-final-20261111.log`；类型检查、宿主增量构建及生产 bundle 通过。
- 源码宿主 18/18：`qa/trim-final-20261111/result.json`；最终包 18/18：`qa/portable-rc1-20261111/result.json`；解压搬移后 18/18：`qa/portable-relocated-20261111/result.json`（均在 artifacts/code-oss 下）。
- 正常进程重启恢复：`qa/continuity-final-20261111/session-restore.json` 与 `qa/continuity-portable-rc1-20261111/session-restore.json` 均 passed。
- 鼠标点选原生 Search 的 `Paragraph 80` 结果，已在独立生产 probe 实机确认默认进入预览并定位到正文。最终 RC1 窗口已启动；再次操作桌面时遇到 GetCursorPos 拒绝访问，未扩大最终菜单外观目视验收结论。
- ZIP 重新解压后 11,367 文件 SHA256 全部匹配：`artifacts/code-oss/relocation-20261111/manifest-result.json`。压缩包约 422 MB，展开约 1.32 GB；当前仍包含较多共享运行库，这不是体积优化完成的结论。

当前阶段：核心可用开发版 → 阅读边界和首轮裁剪完成 → **免安装 RC1 已交付**。正式发行仍待签名/干净机器验证、完整许可审核和离线网络核对。Git、多窗口/异常退出、其余 M1 迁移边界以及运行依赖深裁剪继续待办。早期 probe/candidate 目录仅为构建排错产物，交付以 rc1 为准。

- 多窗口/异常退出恢复及已有 M1 边界迁移；字符级源文与渲染选区映射暂不纳入本轮。
- Git 接入与共享运行依赖深度裁剪；部分混合服务模块尚不能删除。
- 正式发行签名/干净机器验证、完整许可审核、离线网络核对与同条件性能复测。
- 当前已交付免安装 RC1，完整首版产品及全部 M1 验收尚未完成。

### 2026-11-12 深度裁剪与基础编辑保留（本轮完成）

用户同意去掉绝大多数非阅读功能，并明确保留简单编辑。本轮继续原分支、现有依赖与当前原生布局，不安装、不提交、不推送；RC1 保留为可退回版本。

保留范围：文本输入/修改、保存/另存为、撤销/重做、查找/替换、复制/粘贴、语法着色、源码/预览切换；目录浏览、文件搜索、图片/Webview、文件监听、配置/阅读状态、内部阅读器扩展与 Git 接入基础继续保留。基础编辑沿用原生编辑器，不另造编辑组件。

- [x] 后台链裁剪：关闭 AI/Agent/MCP/本地语音、Remote/SSH/WSL/Containers/Tunnel、内置浏览器自动化等非核心后台注册和通道；必要兼容服务保留最小/惰性接口。用固定上游可重复补丁实现，不破坏基础扩展宿主。
- [x] 交付包减负：排除编译中间文件、符号/静态库，并按实际依赖关系排除可移除的非核心运行包；保留原生运行库、语法着色 WASM 与许可证。功能过滤与文件过滤分别记录，所有体积收益以新产物统计。
- [x] 编辑验收：扩展真实宿主回归，覆盖编辑/撤销重做/替换/保存与预览往返，保留未保存取消保护；另存为及剪贴板项目如未自动核对则如实列明。
- [x] RC2 构建与验证：模块/前端/类型、原生集成、普通重启恢复、渲染错误日志、解压搬移与文件清单核对；交付新的候选包，保留 RC1。

分工：后台固定补丁、打包策略、编辑验收并行；主代理集成打包和串行真实宿主验证。当前性能和视觉精修仍后置。

本轮交付：`dist/Markdown-Reader-CodeOSS-Windows-x64-20261112-rc2.zip`、同名目录与 `.sha256`。解压运行 `Markdown Reader Lab.exe`；RC1 未覆盖。ZIP SHA256：`7BE4CA8393A5DC8335C489EBE9243B9F01B9FE496FAC32D31842755B3B3C2FB2`。

实现与验证（2026-11-12）：

- `backend-policy.cjs` 移除 AgentHost 主进程启动器/预热、共享进程 SSH/WSL/Containers/Tunnel/Playwright 等实现及通道；本地 Git 基础保留。桌面 AgentHost、本地语音和浏览器/CDP 改用空服务，两个扩展兼容隧道通道不产生网络、进程、定时器或持久状态。首次源宿主核对暴露 MainThread 浏览器 RPC 依赖，补齐完整空服务接口后通过真实构造回归及宿主检查，未恢复浏览器后台。
- `package-policy.cjs` 移除 15 个非核心根依赖及独占闭包，锁文件排除 115 条路径；共享依赖及运行所需 peer 优先保留，包含标记为 dev 的 tslib。kerberos、V8 profiling、遥测共享加载器、PTY/xterm 等兼容依赖仍保留。本轮不将其称为完全空壳宿主，也不据此推断内存或启动收益。
- RC2：147 个实际安装运行依赖、61 个声明式语法/主题扩展、6,193 个清单文件；展开清单 726,036,186 字节（RC1：1,324,108,823，减少 45.2%）；ZIP 248,299,936 字节（RC1：422,238,391，减少 41.2%）。运行二进制、WASM、许可证保留，编译中间/符号/静态库不再交付。
- `editing-integration.cjs` 操作真实原生模型与命令，核对中文输入、选择、撤销重做、原生粘贴处理、查找前后匹配、单次/全部替换及独立撤销历史、保存到磁盘、同标签返回预览和 JavaScript 文件编辑保存。系统剪贴板、另存为对话框及未保存取消操作明确列为 3 项人工复查，不计入自动通过数；未移除原生功能或原有保护。
- 模块 34/34：`artifacts/code-oss/rc2-node-final-20261112.log`；共享前端 343/343：`rc2-ui-20261112.log`；类型检查、上游增量构建及生产 bundle 通过（`rc2-bundle-20261112.log`）。
- 源码宿主 28/28：`qa/backend-rc2-green-20261112/result.json`；生产包 28/28：`qa/portable-rc2-20261112/result.json`；解压搬移包 28/28：`qa/portable-rc2-relocated-20261112/result.json`，运行配置全部日志无 `[error]`。
- 普通进程重启恢复：`qa/continuity-rc2-stable-source-20261112/session-restore.json` 和 `qa/continuity-rc2-stable-package-20261112/session-restore.json` 均通过。最初源码回归在搜索滚动尚未稳定时过早保存预期位置；仅修正验收采样为两阶段连续稳定 1500ms 后记录/比较，保留同一锚点标题、源行及段内比例差小于 0.05 的原断言，未改产品恢复逻辑。两份报告包含状态变化轨迹。正常退出时扩展宿主另有大纲刷新取消日志（`Canceled`），发生在成功报告写入之后；不计为运行期无错误结论。
- ZIP 解压到独立目录后，6,193 个清单文件 SHA256 全部匹配：`artifacts/code-oss/relocation-rc2-20261112/manifest-result.json`。独立复核发现原归档的中文说明文件名未带 Unicode 标记，已仅将同一产物改用显式 UTF-8 重新归档；最终 ZIP 默认解码路径、全部 6,193 项内容哈希及外层 SHA256 再次通过：同目录 `archive-result.json`。复核问题均已处理，无产品变更。

当轮阶段：**免安装 RC2 已交付（历史候选）**。人工复查项、Git 接入、多窗口/异常退出、其余 M1 迁移边界、签名/干净机器/完整许可与离线网络验收继续待办；视觉和同条件性能复测按用户要求后置。

### 2026-11-18 RC4

同日，项目正式命名为 **Cyperus**。旧命名切换候选已通过实际启动、窗口标题设置和 Windows 文件属性核对。此前的 CSS 与命令裁剪候选恢复了 HTML 根元素与正文属性，按项目解析页面引用的 CSS，并在编辑器保存引用的 CSS 时刷新；调试、断点和 Snippets 用户命令停止注册，36 项桌面集成检查通过。当前入口为 [Cyperus Windows 试用目录](../../dist/Cyperus-Windows-x64-20261118-bilingual)，运行 `Cyperus.exe`。新版使用原生编辑状态栏，随包提供简中工作台翻译及阅读器菜单与提示翻译，中英两套配置分别通过 37 项桌面集成检查。相比此前候选增加约 1.9 MB。缺失译文回退英文，Electron 运行时仍只带 `en-US.pak`。下面保留更名前的 RC4 记录。

[试用目录](../../dist/Markdown-Reader-CodeOSS-Windows-x64-20261118-rc4-pty)，执行 `Markdown Reader Lab.exe`。保留 RC2、RC3 作为历史候选。实际目录 498,190,189 字节（含清单），比 HTML 候选减少 102,689,733 字节（17.1%）。

- 阅读主线保留 Markdown 与静态 HTML 默认预览、Markdown 两种视图的大纲跳转、基础编辑、目录浏览和搜索。HTML 预览使用隔离框架，支持直接引用的本地样式表和图片。
- 移除工作区信任界面与命令，设置兼容服务为直接打开。移除 Agents 窗口打包入口、资源和打开路径，旧 `--agents` 参数回到正常窗口。开发者工具、GPU 诊断和跟踪等命令停止注册。
- 移除 Tree-sitter 实验配置与两处运行资源，编辑器使用 TextMate。终端裁掉本地 PTY 进程、IPC、Shell 集成文件、`node-pty` 和 `@xterm/headless`，仍保留被引用的浏览器侧 xterm 兼容代码及外部终端入口。遥测库仍在，设置关闭。
- 生产构建和 37 项策略与模块检查通过；实际包使用旧 `--agents` 参数通过 35 项桌面集成检查，Windows x64 搜索工具也在项目夹具上实跑，正常重启恢复通过。检查报告在 `artifacts/code-oss/qa/portable-rc4-pty-20261118/result.json` 和 `artifacts/code-oss/qa/continuity-portable-rc4-pty-20261118/session-restore.json`。
