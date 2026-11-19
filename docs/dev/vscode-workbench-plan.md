# VS Code 工作台结构重做 Implementation Plan

2026-11-07：用户要求UI展示效果后置，当前功能推进见 [执行记录](./functional-progress-plan.md)。逐标签搜索、恢复最近关闭与菜单焦点已推进；以下“菜单双高亮未修复”为11月6日历史审计结论，当前验证以新记录为准，尺寸与配色建议仍待后续设计。

## 当前规格核对（2026-11-06）

用户同意提取VS Code源码规格，并要求核对体感和边距；随后明确不必限定老版本。[规格核对17](../design/17-vscode-spec-audit.md)已更新到1.145.1稳定版，重新核对新版菜单、标签模式、树缩进与主题覆盖，保留单行顶部、左侧活动栏、白紫方向。沿用同日上一轮1440/1024/640浏览器测量及菜单双高亮证据；本次未重复运行取证，未修正产品代码。旧版菜单em尺寸方案已撤销，原生同环境对照及系统缩放仍待验。以下历史实施和通过记录不能视为这些新发现已经修复。

## 当前顶部修订：采用用户给定的单行菜单标题栏（2026-11-06）

用户决定采用新附的历史VS Code截图，并确认活动栏保留左侧。覆盖原先“标题与菜单分两行”的要求，其他颜色、边距及功能沿用。按 [设计16](../design/16-ui-design-draft.md) 实施；仅调整顶部和菜单，不新增截图中的编辑/终端/Git/设置子菜单，不安装、不进行Git写操作。

- [x] `WorkbenchTitlebar.vue`：将现有菜单移入标题栏左侧，30px单行、图标32px占位、中间标题可省略、右侧三按钮；菜单及按钮不设拖动标记，留白与标题保留拖动。窗口桥接/权限不改。
- [x] 下拉菜单：直角边缘、260px最小宽、26px菜单行、清晰分隔线、整行紫色选择；保留现有键盘/关闭/外点/焦点行为。`base.css` 同步顶部30px变量。
- [x] 更新既有标题栏结构单测和浏览器几何检查，验证640/1024/1440、浅/深/纸张、菜单与窗口控制不重叠；同步设计10/15/16和README。
- [x] 执行单测、类型/静态、完整浏览器回归与截图复核，构建发布版并原生功能复验。保留历史记录，当前以本节为准。

### 当前顶部验证

- 19文件245项单测、类型检查与82文件静态检查通过。完整浏览器32项通过，最终日志 `benchmarks/e2e-single-title-menu-final.local.log`。首次回归发现冒烟测试仍要求菜单在标题栏外，已同步为单行结构并完整复跑；旧失败日志不作为通过证据。
- 10张实际运行截图和 `font-metrics.json` 位于 `artifacts/single-title-menu/`，覆盖1440/1024/640、浅/深/纸张、浅深菜单、环境弹层、搜索与大纲。实测顶部及工作区起点均为30px，侧栏标题与标签共用30–65px；640宽时菜单右界164、标题区域170–470、窗口按钮左界502，无重叠。
- 独立只读复核已检查代码和7张主要截图，未发现新增问题。菜单键盘行为与窗口桥接保持原样；浏览器回归不计为原生窗口拖动或双击验收。
- 发布构建通过：`src/host/target/release/md-preview.exe`，10,314,240 bytes，SHA256 `F15A2B0E3CE4D64A2DE1CCF90240FECAC407A0AA7C80F8CFB9646E73DDA17CBA`，2026-11-06 16:59:48上海时间；日志 `benchmarks/build-single-title-menu.local.log`。保留既有未使用错误枚举的编译提示，无构建错误。
- 原生复验通过，见 [native-single-title-menu.json](../../benchmarks/native-single-title-menu.json)：complete=true、errors为空，四档IPC/七样本、真实目录9/20项、两标签缓存与去重、位置700→700、搜索与越界拒绝通过。IdleSeconds=0，未重采性能；验证自己的进程已关闭。

## 当前边距修订：历史 VS Code 连续工作区（2026-11-06）

用户确认按历史版参考调整页面及板块内外边距。规格见 [UI设计基线16](../design/16-ui-design-draft.md) 的“历史版边距修订”；本节覆盖下方已完成的4–6px间隙与6px面板圆角方案。沿用现有Vue/CSS与Tauri，不变更功能、依赖、窗口桥接或权限，不进行Git写操作。

- [x] 规格与外壳：更新设计16、设计10/15与README；`styles/base.css`、`app/ActivityBar.vue` 清除工作区外边距/圆角/阴影，活动栏48×48，侧栏边界1px，拖动命中区覆盖边界而不占额外空间。
- [x] 导航与底栏：`app/ExplorerPanel.vue`、`Sidebar.vue`、`SearchPanel.vue` 统一35px标题、左20/右8标题内边距、22px列表行和16px层级缩进；`WorkbenchStatusbar.vue` 保持22px，控件共用6px水平内边距和居中基线，640宽仍全部可达。
- [x] 正文：`styles/markdown.css` 使用顶部16/左右26/底部28，640宽左右20/底部24；普通块间距16，代码/引用/提示/折叠/图表统一12×16内边距，清除浏览器默认块边距和嵌套末项重复留白，保留既定字体与标题层级。
- [x] 检查：更新既有 `tests/e2e/visual-preview.spec.ts` 的区域衔接断言；复用已有单测及完整浏览器回归，实际查看1440/1024/640、浅/深/纸张、搜索/大纲和正文块截图；执行类型/静态检查、发布构建及原生功能复验。无新行为，不增加照抄CSS数值的单元测试。

重点复核：隐藏侧栏仍贴边；窄窗主题控件可达；侧栏标题与标签上下边对齐；嵌套列表/引用/代码最后一项无叠加空白；长代码/表格/图表只在正文内部滚动。证据见下节。

### 当前边距验证

- 19文件245项单测通过；类型、82文件静态检查和diff空白检查通过。完整浏览器32项通过，日志 `benchmarks/e2e-classic-spacing-final.local.log`；图表错误框末项留白最终收齐后，正文相关5项复验通过，日志 `benchmarks/reader-spacing-final.local.log`。
- 实际画面位于 `artifacts/classic-spacing/`：浅色1440/1024/640、深色、纸张、菜单/环境/搜索/大纲，以及引用/嵌套/表格/提示/数学与图表/错误折叠/收起侧栏/窄窗长内容，共18张。`font-metrics.json` 保存字体、对比度与工作区几何，`block-metrics.json` 保存正文块间距和内部滚动检查。
- 实测侧栏与阅读面共边288px，收起后活动栏与阅读面共边48px，标题和标签顶/底分别58/93px；1440与640均无窗口横向溢出。嵌套末项下边距归零，长代码保留内部横向滚动。
- 独立只读复核确认各尺寸/主题/导航面板无明显截断或错位；发现的图表错误框尾部16px叠加留白已修正，截图与块指标重新验证末项为0。视觉测试曾误选v-show隐藏标题，已改为选可见节点，并通过最终完整回归；旧失败日志保留，不作为通过证据。
- 发布构建通过：`src/host/target/release/md-preview.exe`，10,314,240 bytes，SHA256 `E3CDDFEB821392803CB829C0C949C1B5F73A68CECF9C0461A665914BA0B97BE3`，2026-11-06 16:27:49上海时间。日志 `benchmarks/build-classic-spacing.local.log`。
- 原生复验通过，见 [native-classic-spacing.json](../../benchmarks/native-classic-spacing.json)：complete=true、errors为空，四档IPC/七样本、真实目录、两标签缓存与去重、位置700→700、搜索与越界拒绝通过。IdleSeconds=0，未重采性能；未改Rust/窗口桥接/权限，测试启动的进程在验证结束后关闭。

## 上一轮视觉修订记录：用户截图的层次与质感（2026-11-06）

用户补充真实VS Code截图，并明确要求调整细节、质感和视觉效果。按该参考更新 [UI设计基线16](../design/16-ui-design-draft.md)，先落规格再改样式；保留已定的双行顶部、同级文件/搜索/大纲、浅色默认与底部双主题，不扩展功能。

- [x] root：浅灰窗口框架、深灰活动栏、浅灰目录与白色内容；状态栏整条紫色+白字，主题控件与环境弹层保持正确对比度。窗口/侧栏/阅读面以4–6px结构间距、6px轻圆角区分，文章本身无卡片和阴影。
- [x] navigation agent：统一导航图标轮廓、树行基线与缩进、柔和选中与悬停、标签分界；活动栏深色专用前景和焦点，不使用正文文字颜色。仅样式与必要视觉markup，不改行为。
- [x] QA agent：适配面板间距的几何断言，覆盖浅/深/640、菜单、搜索与大纲；核验底部紫色不影响环境弹层和正文主题。root统一跑既有完整回归与实际截图。
- [x] root：类型/静态/单测、完整浏览器回归、截图与独立复核，release构建和原生功能复验；不安装、不做Git写操作或系统配置改动，保留所有既有未提交修改。无新行为，不增加重复样式实现的单测；性能与Qt继续后置。

参考截图仅提供视觉关系，不照搬聊天、Git、受限模式等无本应用功能的入口。下文早先白紫各区同底色为历史，当前视觉以本节为准。

### 参考截图视觉修订验证

- 已落实深灰活动栏、浅灰侧栏、白色内容面与紫色整条状态栏；4–6px框架间距/6px面板圆角、图标基线、柔和选中、原生select自定义白色箭头及专用键盘焦点统一。诊断弹层保持中性底色，不继承底栏白字。没有修改功能逻辑。
- 类型检查、静态检查和19文件245项单测通过；完整32项浏览器回归通过，保留全部安全、搜索/目录/标签/焦点/长错误路径场景。面板几何断言按本轮规格更新，文章自身继续验证铺满、无圆角与阴影。
- 实际预览和CDP字体/对比度记录在 `artifacts/vscode-texture/`：浅1440、深1440、浅640、搜索、大纲、文件菜单、环境信息，共7张。根代理已检查；对比度采样包含活动栏选中/未选中、底栏主题与路径、菜单选中和诊断弹层，浅色样本最小4.731:1、深色最小5.713:1。
- 独立QA复核浅色1440/640与环境信息三张截图，未发现明显错位、截断或异常遮挡；底栏文字约5.97–7.11:1、诊断弹层文字约4.94–11.10:1，主题入口和关闭按钮清楚。
- 发布构建通过：`src/host/target/release/md-preview.exe`，10,314,240 bytes，SHA256 `238EEAAF003BCD07B81ED9D6699C8B983DBF3EAA02FEC5D2A6DBC3A64D7795A6`，2026-11-06 15:45上海时间。
- 原生功能复验见 [native-vscode-texture.json](../../benchmarks/native-vscode-texture.json)：四档IPC、七样本、真实目录与两标签、缓存/去重、位置700→700、搜索、主题和图片/图表/越界拒绝均通过，complete且errors为空。IdleSeconds=0，未重采性能；未改Rust源代码、窗口桥接/权限或系统配置，Qt继续跳过。验证进程已退出。

## 当前实施修订：浅色白紫与设计细节（2026-11-06）

用户已要求“先按照这样实现”，以 [UI设计稿16](../design/16-ui-design-draft.md) 为依据，保留传统VS Code工作台框架，默认界面和正文均浅色，以白色为主、紫色强调。无需重新选择风格；本轮在既有工作目录保留所有改动，不安装、不进行Git或系统写操作。

- [x] root：浅色白色阅读面、中性浅灰侧栏、紫色焦点/标签/选中；深色保留并用相应紫色强调。默认 light/light，正文15/24、标题28/22/18、代码13/21、正文边距20/28。
- [x] navigation agent：侧栏标题左右16，树/组/编辑器行24，活动图标22，搜索28；搜索再次聚焦选中关键词、Escape回正文事件；大纲区分无文档/无标题。DocumentTabs暴露focusActive，tab/editor容器标记data-session-id；不增加摘要列表/重排/Git。
- [x] root：关闭当前标签或含键盘焦点的被关闭项后，将焦点交还活动标签，最后标签关闭聚焦打开文件；关闭非活动项保留阅读焦点。键盘调宽与拖动共用180–min(480,窗宽−340)限制，窗口缩小时同步夹紧。底部环境入口在左，目录优先缩短，文件名最后缩短，路径与主题入口可达。
- [x] QA agent：适配浅色默认、双主题隔离与浅色优先截图，新增上述键盘焦点/窄窗/长路径回归；root先验证新行为失败再实施对应行为。保留全部安全与多文件测试。
- [x] root：类型/静态/单测/完整浏览器回归、实际截图、独立审查、release构建与原生功能复验。无需重跑性能矩阵或无改动Rust测试；旧原生拖动/双击人工验收边界保留。

这次只落实上述已确定内容；设计稿中明确留待另行决定的搜索摘要列表、完整持久化与Git等保持后续。下文11月5日的深色默认与尺寸为历史，不作为本轮默认值。

### 2026-11-06实施验证

- 上述五项实施与验证已完成。默认light/light，白色阅读面与紫色强调；正文15/24、24px树行、28px搜索框、22px活动图标按设计落地。深色与纸张主题保持独立。
- 19文件 / 245项单测、类型检查与静态检查通过；浏览器完整32项通过。原六项差异回归先失败后通过，覆盖默认值、关闭焦点、640窗口限制与路径；另有8项导航组件行为和菜单外点焦点回归。
- 独立审查发现长ASCII失败文件名/原生错误路径可能挤出操作。新增223字符文件名与长绝对路径用例，实际RED为关闭按钮viewport ratio 0；文字换行、错误区限高滚动和失败页滚动修正后GREEN。搜索Escape明确聚焦可滚动阅读容器，保留关键词和原有视图高亮生命周期。
- 实际截图与CDP字体记录：`artifacts/white-purple-workbench/`，浅色1440/640、深色1440及搜索/大纲五画面已逐张检查，独立视觉审查通过。正文、次要文字和菜单选中对比度分别约12.32:1、5.17:1、7.10:1；不以大面积紫色替代阅读白底。
- 发布构建通过：`src/host/target/release/md-preview.exe`，10,313,728 bytes，SHA256 `6C83B698704ABCDEB66329E5490F1864843D6F99B83C3C31A1E716887C147AA6`，2026-11-06 15:19上海时间。
- 原生功能复验通过，见 [native-white-purple.json](../../benchmarks/native-white-purple.json)：四档IPC、七样本、图片/数学/图表/双主题、真实目录、两标签缓存与去重、位置700→700、搜索及越界拒绝，报告complete且errors为空。`IdleSeconds=0`，未采新性能数据；原Qt跳过与性能后置不变。
- 本轮未改Rust源代码、窗口桥接/权限或系统配置，没有安装或Git写操作。原生窗口拖动/双击既有人工验收边界不变。验证进程已退出，设计文档与链接同步完成。

## 当前追加修订：独立标题栏与底部状态（2026-11-05）

用户明确要求：移除顶部搜索，标题栏单独一行、菜单下移一行，其他状态（含主题切换）全部置于底部。沿用当前 Vue / Tauri，不安装、不进行 Git 写操作。

- 标题32px，仅应用图标、活动文档/应用标题与真实窗口控制；菜单26px为独立第二行，无搜索框。
- 文件 / 查看 / 帮助菜单原交互保留；查看中的搜索仍打开左侧正文搜索，Ctrl+F保留。帮助环境信息转发底部状态栏的诊断浮层。
- 底部22px状态栏统一当前目录、文档路径、编码、章节数、文档数量和始终可见的两套主题select。移除左侧管理齿轮及原外观浮层；文档路径从正文顶部移至底部。
- 组件分工：chrome agent只改WorkbenchTitlebar.vue及其单测；root接入WorkbenchStatusbar.vue、App.vue、ActivityBar.vue与base.css；QA agent只改e2e相关用例。标题栏props缩为title/panel/hasDocument/tabCount，新增showEnvironment事件，移除主题/env/focusSearch接口；状态栏暴露showEnvironment()供帮助菜单调用。
- 验收：标题/菜单纵向分离、无顶部搜索、主题始终位于底部且独立生效、菜单焦点/环境关闭仍正确、640与1440无窗口溢出。更新相关交互测试，完整前端回归、实际截图、release构建与原生功能复验。

### 追加修订验证结果

- 标题栏与菜单已独立分行，顶部搜索及管理齿轮已移除；路径、加载状态、编码、章节与文档数、双主题和环境入口统一置于底部。帮助菜单打开同一底部环境弹层，交接前恢复菜单焦点。
- 类型检查、静态检查与完整单测通过：18文件 / 236项；标题栏6项包含新交互先红后绿。完整浏览器回归21项通过，包含底部常驻主题隔离、环境浮层两入口、菜单键盘/关闭、文件/标签/路径联动和既有内容安全。
- 深色1440、浅色1440、深色640实际截图保存在 `artifacts/classic-workbench/`。根代理及独立只读审查均已逐张检查；顶部32px/菜单26px/底部22px贴合，主题与状态完整可达，无窗口横向溢出。字体记录同目录保留。
- 发布构建通过：`src/host/target/release/md-preview.exe`，10,313,216 bytes，SHA256 `C3A6D951FBF296124B28CE12152019FFC0E5FD03BFAE404BE383331CC8550293`，2026-11-05 14:26上海时间。
- 最新原生复验见 [native-classic.json](../../benchmarks/native-classic.json)：四档IPC、七样本、实际底部主题切换、图片/数学/图表，以及目录、两标签缓存与去重、位置700→700、搜索和越界拒绝均通过。`IdleSeconds=0`，未重采性能，未改变原性能结论。窗口桥接与权限未修改，原有拖动/双击人工验收边界不变；不将旧窗口按钮实测记为本轮重测。
- 独立代码与视觉审查未发现确定P1/P2；文档同步、相对链接检查及 `git diff --check` 通过。本轮无安装、Git写操作或系统配置修改，验证进程已退出。

下文为上一轮结构记录；与本节冲突时以本节为当前规格。

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans. Preserve all existing uncommitted work; no git writes.

**Goal:** 按用户明确要求直接采用 VS Code 工作台的界面组织，移除此前自行设计的卡片阅读器布局。
**Architecture:** 复用文档会话、文件夹 bridge、ReaderView；重做窗口标题 / 菜单、导航组件和 CSS。现有主题控件进入管理菜单，正文恢复平面预览。
**Tech Stack:** 现有 Tauri / Vue / TypeScript / CSS / inline SVG，不安装依赖。
**Spec:** 2026-11-05 用户要求“你就按照 vscode 的界面做就行”；本文件为该明确指令的执行规格。

## Reference

- [VS Code 工作台布局](https://code.visualstudio.com/docs/editing/getting-started/userinterface)
- [官方 Markdown 预览样式](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/media/markdown.css)
- [Dark Modern](https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/dark_modern.json)、[Light Modern](https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/light_modern.json)
- 参考区域关系、控件密度和排版；保留本应用名称和功能，不添加不可用的终端 / 扩展 / Git 按钮。

## Global Constraints

- 标题栏 32px、活动栏 48px、侧栏约 240px、标签 35px、状态栏 22px；紧凑直角的连续分区。
- 标题栏是文件 / 查看 / 帮助菜单、当前目录 / 文档搜索入口与真实窗口控制；取消品牌大块、常驻打开按钮与主题下拉。
- 文件 / 搜索 / 大纲仍为活动栏同级入口；底部管理入口提供已有外观设置。主题 select 保留 data-testid，隐藏时仍保留 DOM 供原生探针切换。
- 文件树行 22px，顶部可折叠“打开的编辑器”与目录分组；切换 / 关闭复用既有会话。
- 标签与正文无间隙相连；下方紧凑路径栏；正文无卡片、圆角、阴影、外层灰底或大块居中留白。
- Markdown 预览采用约 14px / 22px、左右 26px 的普通文档区域，正文主题继续独立，纸张主题仍可选。
- 原生取消重复系统装饰，标题栏窗口控制使用仅 main 窗口的最小 Tauri 权限；不扩大文件、shell、网络权限。
- Git 与性能专项后置；不更改解析、资源安全与文档生命周期，不安装、不提交、不分支、不改系统。

## Review Focus

- 无系统装饰后，拖动 / 双击最大化 / 最小化 / 最大化 / 关闭必须有真实桥接、错误处理和监听器清理。
- 菜单支持点击、Escape、外部点击关闭与键盘操作；不靠不可见的假按钮凑布局。
- 640 宽度下菜单、活动入口和窗口控制可达；正文不得引起窗口横向滚动。
- 主题迁入管理后，浏览器测试须通过真实管理入口操作；原生探针仍真正切换主题。
- 标签、目录、位置和正文搜索继续正确，隐藏菜单不捕获阅读焦点。

## Task 1 — 标题栏与原生窗口控制（chrome agent）

Files: 新 `app/WorkbenchTitlebar.vue`、`core/ipc/windowBridge.ts` 与对应新单测；修改 `src/host/tauri.conf.json` / `capabilities/default.json` 的窗口装饰和局部窗口权限。
Interface: props `title:string,appTheme:AppTheme,markdownTheme:MarkdownTheme,panel:'files'|'search'|'outline'|null,hasDocument:boolean,tabCount:number,env:EnvInfo|null`；emits `openFiles,openFolder,closeActive,closeAll,selectPanel(panel),toggleSidebar,focusSearch,update:appTheme,update:markdownTheme,error(message)`；expose `openAppearance():void`。
Menus: 文件（打开文件、打开文件夹、关闭文档、关闭全部）；查看（文件/搜索/大纲、侧栏、外观）；帮助（环境信息）。管理外观浮层固定于左下角，`data-testid app-theme/md-theme` select 用 v-show 保留 DOM。菜单 testids `menu-file/menu-view/menu-help`；搜索入口 `command-center`；诊断弹层 `.diagnostics`、role=dialog、aria-label=环境信息。
- [x] 测试桥接调用与清理 / 错误，先红后绿。
- [x] 实现真实窗口控制与原生 drag region，main 权限最小化；类型 / lint 检查。

## Task 2 — 工作台导航结构（navigation agent）

Files: `app/{ActivityBar,ExplorerPanel,DocumentTabs,SearchPanel,Sidebar}.vue`。
Changes: ActivityBar 新 emits `manage()`，底部按钮 `data-testid=activity-manage` / aria-label=管理；Explorer 新可选 props `tabs?:SessionTab[],activeId?:string|null`，新 emits `activate(id),close(id)`。已打开编辑器列表使用不同按钮名称（`切换 xxx` / `从列表关闭 xxx`），不与标签栏 `关闭 xxx` 发生定位冲突。
- [x] 文件 / 搜索 / 大纲仍同级，48px 活动栏，22px 树行，打开编辑器 / 目录分组，35px 直角标签与紧凑面板。
- [x] 原有 props、events、aria 与快捷键不破坏；类型 / lint 检查。

## Task 3 — 根集成与平面预览（root）

Files: `App.vue`、`styles/{base,markdown}.css`、本轮执行记录与旧设计说明。
- [x] 接新标题栏 / 管理事件 / 编辑器列表；默认 Dark Modern 外壳和深色正文；增加路径栏，保留浏览器开发控件但移出主标题栏。
- [x] 重建分区比例，移除卡片和大留白，保持双主题边界。
- [x] 使用官方区域关系作直接视觉参照，实际截图须包含完整工作台与可读正文。

## Task 4 — 交互与截图验收（QA agent + root）

Files: 新 `tests/e2e/workbench-helpers.ts`，调整 reader/smoke/visual-preview 等依赖主题位置的测试，新增菜单 / 管理 / 打开编辑器交互断言。
- [x] 测试通过文件菜单打开目录，通过管理浮层设置主题，检查 Escape / 外部点击、路径栏和面板联动；不将新控件默认隐藏当功能缺失。
- [x] 生成深色、浅色、640 窄窗的实际截图；检查正文不再是居中卡片、工作台各区域贴合。
- [x] 完整前端 / 浏览器回归、类型 / lint、release 构建和原生工作台复验；手动窗口控制若受桌面工具限制须明确未测。

## Ledger

- 用户已经明确指定 VS Code 为参照并要求执行，不再另给风格选择题。
- 旧 visual-refresh 记录为已被用户否定的迭代，不作为新设计基准；本轮关注布局结构与控件组织，不以换色代替。
- 沿用当前未提交工作目录，无 Git 写操作。窗口权限仅用于 main 自定义标题栏，不涉及文件、网络或系统配置。

## 本轮执行结果（2026-11-05）

- 已实现标题栏、菜单、管理外观、连续导航区域与平面正文。默认使用深色外壳与深色正文；主题仍可独立切换。没有新增依赖。
- 新增 10 项窗口桥接 / 标题栏单测，覆盖真实动作委托、错误、订阅清理、异步竞态与菜单行为；全量 `pnpm.cmd ui:test` 为 18 文件 / 235 项通过。`ui:typecheck`、`biome ci` 通过，仅保留非阻断 info。
- 完整 `pnpm.cmd e2e --workers 1` 为 20 项通过。覆盖真实菜单 / 管理入口、键盘与关闭、打开编辑器 / 目录 / 标签 / 路径联动、缓存、位置、搜索、原有内容安全与主题隔离。
- 实际预览 `artifacts/vscode-workbench/{dark-1440,light-1440,dark-640}.png` 已逐张检查：区域连续、正文无卡片，640 宽度下菜单与窗口按钮完整可达，无窗口横向溢出。CDP 字体记录为 Microsoft YaHei UI 与 Segoe UI，中文标题为 MicrosoftYaHeiUI-Bold；记录位于同目录 `font-metrics.json`。
- 首轮回归发现窗口按钮32px置于31px内容高导致向上溢出0.5px，已修为31px，保留严格视口断言后通过。另一个 Mermaid 用例被并行修改触发的 Vite 页面刷新打断；代码冻结后原断言完整通过，无安全实现变更。
- `pnpm.cmd tauri build --no-bundle` 通过，发布产物 `src/host/target/release/md-preview.exe`：10,312,704 bytes，SHA256 `011E553F768FECB2F402C58BDF58B24DF63F68D6F10E203DF72955E9AD659B60`，构建时间 10:59 上海时间。产物打包晚于最后 UI 修改，包含本轮最终样式。
- 11:04 上海时间原生复验通过，见 [native-vscode.json](../../benchmarks/native-vscode.json)：四档 IPC、七样本、图片 / 图表 / 主题，以及真实目录9项、子目录20项、两标签去重与缓存、位置700→700、搜索1项、越界拒绝。`IdleSeconds=0`，未采新性能数据，未覆盖原 M0 结论。
- 通过 Windows Computer Use 操作真实发布窗口，最大化 / 还原、最小化（捕获返回 window is minimized）、关闭（窗口列表消失且本次进程退出）均已验证。标题栏拖动 / 双击未得到可靠实测结果：快速注入和 Tauri 异步原生移动消息时序无法区分，虽观察到窗口位移，但不将它计为人工交互通过。源码与最小权限独立审查未发现确定 P1/P2，这两项仍待人工核验。
- 本轮没有改 Rust 源码，不重复运行此前宿主单测；Tauri 配置由 release 构建和真实窗口验证覆盖。两路独立只读审查未发现本轮确定 P1/P2。没有进行安装、Git 写操作或系统配置修改；所有本次启动的验证进程均已结束。
