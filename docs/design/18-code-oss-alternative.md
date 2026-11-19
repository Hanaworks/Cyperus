# 18 — 基于 Code OSS 的实现方案（含历史备案）

> **阶段定位，2026-11-19：** Code OSS 是当前集成基线，后续依次验证 VSIX 与精简独立版。参见 [Cyperus 目标与里程碑](../dev/cyperus-milestones.md)。2026-11-07 的首版选型和后续 Code OSS 实施见 [首版计划](../dev/code-oss-first-version-plan.md)，构建及实测证据见 [试验记录](../dev/code-oss-experiment.md)。
>
> 以下为切换前的备案快照，“未启用”“继续 Tauri”等描述仅表示当时状态，不覆盖上述决定；正式发行与完整验收仍未完成。

> 日期：2026-11-07。状态：**备案，未启用、未构建验证**。
> 用户要求额外保留一份“直接拿 VS Code 改造”的方案。本文件是后续选型依据，不是切换主线的决定，也不代表下列任务已经获准执行。
> 当前继续 Tauri + Vue Web 主线，功能优先，视觉调整后置；Git 仅规划，T14 Qt 对照继续跳过。

**目标：** 如果以后决定采用 VS Code 的真实工作台，保留本项目的预览优先、只读、离线及 Markdown 兼容性要求，形成可独立分发的阅读器。

**建议架构：** Code OSS 桌面工作台 + 少量产品层补丁 + 内置只读阅读扩展 + 现有渲染核心。工作台负责窗口、菜单、标签和侧栏，阅读扩展负责文档、正文、搜索、大纲及资源访问。

**技术组成：** Electron / Code OSS / TypeScript；保留 Vue 阅读组件、markdown-it、Shiki、KaTeX、Mermaid 与 DOMPurify。Tauri IPC 需要替换，Rust 宿主不直接嵌入此方案。

**需求依据：** [需求 v0.4](../requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md)、[阅读工作台](./15-reader-workbench.md)、[多标签](./13-tabs.md)、[链接导航](./14-link-navigation.md)、[安全模型](./06-security.md)。现行架构依据仍为 [ADR-001](../decisions/ADR-001-renderer-and-host.md)。

## 1. 方案边界与取舍

| 路线 | 能得到什么 | 需要承担什么 | 本次定位 |
|---|---|---|---|
| 当前 Tauri + Vue，参考 VS Code 规格 | 延续现有程序与测试，产品行为可自行控制 | 菜单、树、标签及无障碍等细节需要自己实现 | 继续推进的主线 |
| 在用户已有 VS Code 中安装阅读扩展 | 快速验证自定义阅读器与工作台的组合 | 依赖用户的 VS Code、配置及其他扩展，不能作为独立只读产品的交付证明 | 将来验证接口的可选手段 |
| 派生 Code OSS，内置阅读扩展 | 使用真实工作台交互，并控制产品默认行为和发行包 | 源码构建、产品裁剪、资源安全、升级及发布维护 | **本备案建议的备选路线** |

单独使用 Monaco 编辑器不会获得完整 VS Code 工作台，仍需自建菜单、文件树、侧栏和标签；不把它作为“直接复用 VS Code”的替代解释。Code OSS 的工作台与编辑器层次可参照官方[源码组织说明](https://github.com/microsoft/vscode/wiki/Source-Code-Organization)。

选择第三条路线的主要收益是工作台交互复用。它不会自动修复本项目的大文档渲染、内存预算或正文排版问题；是否值得切换，要经过下文的同条件验证。

## 2. 源码基线、产品与发行

本次源码参考固定为 **`microsoft/vscode` 的 `1.145.1` 标签**，与 [规格核对文档](./17-vscode-spec-audit.md) 一致，不要求使用历史版本。2026-11-07 已在线核对该标签的许可证、产品配置和 API 声明；尚未检出或构建整个仓库。正式试验时记录完整 commit SHA、工具链和依赖锁文件；届时若换版本，先更新基线，不混用不同版本的结论。

Code OSS 源码使用 MIT 许可证，分发需保留相应版权和许可声明；Microsoft 的 VS Code 发行版另有产品许可和附加内容。基于 Code OSS 的产品不能据此默认接入 Visual Studio Marketplace。本方案采用自己的名称、图标、应用标识及数据目录，只打包经过核对的必要扩展与资源。依据：[固定版本 LICENSE](https://github.com/microsoft/vscode/blob/1.145.1/LICENSE.txt)、[官方产品与源码区别](https://code.visualstudio.com/docs/supporting/faq#_what-is-the-difference-between-the-vscode-repository-and-the-microsoft-visual-studio-code-distribution)、[Marketplace 使用范围](https://code.visualstudio.com/docs/supporting/faq#_can-i-use-extensions-from-the-visual-studio-marketplace-in-other-products)。

产品配置以 [`product.json`](https://github.com/microsoft/vscode/blob/1.145.1/product.json) 为入口，另审查构建时注入项、内置扩展清单及启动服务：

- 使用独立的可执行文件名、Windows 应用标识、协议及用户数据目录，避免覆盖现有 VS Code 或当前阅读器的数据。
- 首版只启用阅读所需功能；不接入账户、同步、AI、扩展商店或 Microsoft 更新服务。不能把“界面上没有入口”作为服务未启动的证明。
- 默认离线；启动、打开文件、切换主题和渲染时检查网络请求。升级渠道另行定义，仍须维护依赖及 Electron 安全更新。
- 单独收集第三方许可和所选扩展的发行条件，不能用仓库根目录 MIT 代替所有依赖的核对。

## 3. 功能映射

| 本项目要求 | 备选实现方式 | 需要核验的差异 |
|---|---|---|
| 无工作区也能打开 Markdown | 系统关联 / 启动参数进入产品打开路由，再打开只读自定义编辑器 | 冷启动、第二次双击、批量打开、中文及空格路径；不先闪出源码编辑器 |
| 窗口、菜单、左侧活动栏和底部状态栏 | 使用 Code OSS 工作台组件及布局配置 | 沿用单行标题/菜单、无顶部搜索、左侧入口；裁剪后核对焦点和快捷键 |
| 多标签、关闭、重排、历史恢复 | 工作台负责标签身份、顺序与编辑器历史；扩展只保存阅读状态 | 关闭后重开、别名路径去重、失效文件、重启恢复；不能假定自定义正文状态会自动恢复 |
| 只读目录浏览 | 独立文件视图，使用原生 Tree View 展示已授权目录 | 不复用带新建/重命名/删除行为的默认 Explorer 产品逻辑；拒绝目录越界和链接目录 |
| 文件 / 搜索 / 大纲同级 | 三个活动栏容器，分别接入文件树、正文搜索和当前文档大纲 | 不沿用默认 Explorer 底部折叠大纲，也不把源码全文搜索当成正文搜索 |
| 正文渲染及兼容性 | 内置阅读扩展的 Webview 使用现有渲染管线 | 内置 Markdown 预览不能直接视为现有脚注、图表、数学、锚点等行为的等价替代 |
| 外部文件保存后刷新 | 文件服务监听 + 文档版本/代次 + 去抖重读 | 临时文件替换、删除、恢复、读取失败、窗口重新激活补查 |
| App / Markdown 独立主题 | 工作台主题与正文主题分开保存和应用 | Markdown 主题不能被 Webview 自动继承的工作台颜色覆盖；两个入口仍在状态栏 |
| 本地图片、跨文档链接及附件 | 扩展内资源代理统一分类、校验及打开 | 继续采用现有协议与目录边界；不能从 Webview 直接执行任意命令或系统路径 |
| Git | 保留后续状态 / 差异查看的设计接口 | 不因上游包含 Git 就启用提交、同步或仓库写操作 |

原生活动栏容器和树可通过扩展贡献点接入，见官方 [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view#view-container)。正文搜索与大纲的适配是本方案的产品设计，不宣称已有 API 会自动完成。

## 4. 进程、文档与渲染设计

```text
系统打开文件 / 文件视图 / 文档链接
                  ↓
Code OSS 产品打开路由 → 原生标签、菜单、侧栏、历史
                  ↓
内置阅读扩展（Extension Host）
  文档注册表 / 只读访问代理 / 路径策略 / 文件监听
                  ↓                         ↑
  解析 Worker → ParseResult 缓存 → 自定义编辑器 Webview
                                  Vue 阅读层 / 搜索 / Mermaid
```

### 4.1 自定义只读文档

采用 `CustomReadonlyEditorProvider<ReaderDocument>`，通过 `openCustomDocument` 创建文档模型、`resolveCustomEditor` 绑定 Webview。它支持交互而不提供保存和撤销接口；与 `CustomTextEditorProvider` 的可编辑文本模型不同。本项目选择它是为了保持“读取磁盘已保存内容”的产品语义。依据：[官方自定义编辑器说明](https://code.visualstudio.com/api/extension-guides/custom-editors#readonly-custom-editors)。

建议扩展标识 `mdReader.preview`，为 `.md/.markdown/.mdown/.mkd` 声明默认编辑器，并在产品打开路由显式指定；扩展声明的 `priority: default` 不等于消除了所有关联冲突。路径校验后才创建文档，重复打开归并到已有身份。

首轮将 `supportsMultipleEditorsPerDocument` 设为 `false`，沿用当前同一文档单实例语义；多编辑器组并排阅读不在本次需求内。之后若开放，需要区分共享文档版本和每个视图的搜索/阅读位置。该选项的含义以 [1.145.1 API 声明](https://github.com/microsoft/vscode/blob/1.145.1/src/vscode-dts/vscode.d.ts) 为准。

工作台负责标签，不能把现有 `DocumentSession.tabs` 再放进 Webview 生成第二套标签。扩展保留文档注册、缓存、版本和别名去重；Webview 保留当前视图的 `scrollTop`、搜索词、匹配序号和正文主题。关闭视图释放 DOM 及图表；最后一个视图关闭后释放文档监听、资源句柄和相应缓存所有权。

### 4.2 解析与缓存

建议在 Extension Host 内由独立解析 Worker 执行 `renderMarkdown`，扩展保留按文档身份、磁盘版本、渲染选项和渲染器版本区分的结果缓存。Worker 首轮串行消费解析任务，保持当前解析器/高亮器共享状态的使用约束；请求和返回值附文档身份、代次，旧结果不得覆盖新文档。

现有 `parse.worker.ts` 使用浏览器 `self` 协议，不能直接放到 Node Worker 中；新增 `worker_threads` 消息入口，复用纯解析模块及 `ParseRequest/ParseResult` 的数据结构。Shiki 的资源加载、字体、WASM 和生产打包必须在原型中核验，不能以开发模式启动成功代替发布验证。

正文仍在 Webview 中消毒、插入 DOM，再处理 Mermaid 和搜索。隐藏视图默认不启用 `retainContextWhenHidden`；保存轻量阅读状态，重新显示时从扩展缓存取结果并重建 DOM，避免重新解析。跨重启只恢复路径及阅读状态，不把持久化 HTML 当可信缓存。自定义编辑器按自身生命周期恢复，不另建一套普通 Webview Panel 的序列化器。

若原型发现 Node Worker 适配成本过高，可单独评估 Webview Worker，但不能照搬现有 Vite 启动方式：官方文档限定其从 `blob:` / `data:` 加载，并指出动态导入限制。隐藏视图的状态与资源代价也需实测，见 [Webview Worker 与状态说明](https://code.visualstudio.com/api/extension-guides/webview#using-web-workers)。

### 4.3 最小通信契约

| 方向 | 消息职责 | 校验要求 |
|---|---|---|
| Webview → 扩展 | `ready`、`saveViewState`、`requestAsset`、`openLink` | 请求 ID、文档 ID、视图 ID、代次、类型及长度；文档必须属于发送消息的面板 |
| 扩展 → Webview | `renderResult`、`restoreViewState`、`search`、`revealHeading`、`assetResult`、`documentError` | 接收方核对身份与代次；正文更新完成后才恢复位置和匹配项 |
| 产品打开路由 → 扩展 | 已校验的文档 URI / 根目录句柄 | 不接受页面自行提供的“已授权”标记；权限以宿主注册表为准 |

首次原型将契约定义在 `protocol.ts` 并做运行时校验，不复用任意命令执行接口。文件切换与正文渲染存在异步间隔，必须保留当前实现的身份守卫，避免旧面板回报的搜索或滚动位置污染新文档。

## 5. 只读与资源边界

**只读自定义编辑器只限制该编辑器，不能让整个 Code OSS 自动成为只读应用。** 内置命令、源码编辑器、文件服务及扩展仍可能写文件。仅隐藏菜单、设置只读标志或开启 Workspace Trust 都不能代替完整边界验证。

本方案建议使用已授权资源注册表及 `md-reader:` 只读文件系统：

1. 系统传入的 `file:` 路径先经过规范化、扩展名及链接路径检查，再登记为不透明资源 ID；自定义编辑器只接收注册后的 `md-reader:` URI。文件夹作为本产品的浏览根目录，不自动加载其 `.vscode` 工作区配置或任务。
2. 以 `isReadonly: true` 注册文件系统，写入、重命名、新建和删除方法明确拒绝；读取和枚举同样校验注册表和范围。[文件系统提供者 API](https://github.com/microsoft/vscode/blob/1.145.1/src/vscode-dts/vscode.d.ts) 提供只读能力声明，但它不限制其他 scheme 或 Node 文件访问。
3. 产品层统一收口启动、拖放、菜单、链接及恢复入口，防止绕过只读路由直接打开本地可写编辑器。裁剪保存/另存为、文件变更、任务、终端及扩展安装入口，并验证命令路径也被约束。应用配置与缓存仅写自身数据目录。
4. 首版只打包经过审查的内置功能，不开放任意扩展执行。此设计不声称把有 Node 权限的恶意扩展放进了操作系统沙箱。

路径与链接规则由扩展中的 `ResourceBroker` 作为此路线唯一判定方，移植现有 Rust 行为及反例测试：组件级路径比较、Windows 大小写/UNC 处理、拒绝符号链接和 junction、目录越界检查、附件及协议白名单。选择文件夹只授权枚举，不顺带扩大正文资源读取范围。路径检查与实际读取间的替换竞态也要纳入原型，必要时增加平台层支持，不能只靠字符串 `startsWith`。

Webview 的 `localResourceRoots` 仅允许扩展自身打包的媒体目录；通过 `asWebviewUri` 加载受信脚本、样式和字体，不直接授权整个用户工作区。用户图片由代理校验后按资源 ID 发送受控内容，在页面形成可回收的 Blob URL；限制类型、大小及生命周期，SVG 沿用专门消毒。大图复制开销作为验收项，之后若采用专用资源通道，也要维持逐资源权限。官方指出 `localResourceRoots` 本身并非完整安全保护，见 [Webview 本地资源](https://code.visualstudio.com/api/extension-guides/webview#controlling-access-to-local-resources)。

CSP 默认拒绝外部连接和未声明资源；仅允许打包的可信渲染脚本。`enableScripts` 是给阅读器运行代码，不能让 Markdown 作者内容执行脚本。禁用 command URI，过滤正文 HTML、事件属性及危险链接；Mermaid 输出仍需二次消毒。外链经宿主白名单后交系统浏览器，附件经路径及类型检查后交系统程序。安全规则以 [04](./04-assets-and-links.md)、[06](./06-security.md)、[14](./14-link-navigation.md) 为基线，迁移差异逐项记录。

## 6. 现有资产如何迁移

| 当前落点 | 处理方式 |
|---|---|
| [`src/ui/src/core/markdown`](../../src/ui/src/core/markdown) 与 [`core/render/contract.ts`](../../src/ui/src/core/render/contract.ts) | 复用解析与数据结构；另加 Worker 传输和任务身份包装 |
| [`ReaderView.vue`](../../src/ui/src/reader/ReaderView.vue)、[`renderInto.ts`](../../src/ui/src/reader/renderInto.ts)、[`MermaidLayer.ts`](../../src/ui/src/reader/MermaidLayer.ts)、[`search.ts`](../../src/ui/src/reader/search.ts) | 复用阅读逻辑和安全处理；改造输入、消息、资源加载及视图生命周期 |
| [`styles/markdown.css`](../../src/ui/src/styles/markdown.css) 与 [`core/theme`](../../src/ui/src/core/theme) | 保留正文样式与独立主题语义；工作台主题另做原生主题包，配色仍待后续审定 |
| [`core/documents/session.ts`](../../src/ui/src/core/documents/session.ts) | 提取身份、代次、缓存及阅读状态规则；标签顺序和关闭历史交工作台，避免两个真源 |
| [`core/ipc`](../../src/ui/src/core/ipc) | 保留错误分类和资源/链接语义；Tauri 调用换为扩展消息与宿主服务，逐条核对契约 |
| [`documents.rs`](../../src/host/src/documents.rs)、[`folders.rs`](../../src/host/src/folders.rs)、[`commands.rs`](../../src/host/src/commands.rs) | 行为与测试作为移植基线；Node 实现需要重新验证，不能标记为直接复用 Rust 安全边界 |
| [`fixtures`](../../fixtures)、[`tests/unit`](../../src/ui/tests/unit)、[`tests/e2e`](../../src/ui/tests/e2e)、[`benchmarks`](../../benchmarks) | 复用输入、语义断言及测量口径；DOM 选择器、宿主打开与 Webview 驱动另适配；既有通过数不能算到新宿主名下 |
| Vue 工作台外壳、Tauri 窗口/文件对话框与发行配置 | 由 Code OSS 工作台、产品打开路由和 Electron 发行替换；继续保留在当前主线 |

未来建议使用独立派生仓库，避免把整份 Code OSS 混进当前 pnpm/Tauri 工程。本次不创建该仓库。拟定改造落点如下，均为**未来路径，不表示文件已存在**：

```text
<code-oss-fork>/
  product.json                          产品身份、数据目录、服务配置
  extensions/md-reader/
    package.json                        自定义编辑器、视图、命令、主题贡献
    src/extension.ts                    注册与退出清理
    src/readerDocument.ts               文档版本、缓存与生命周期
    src/readerEditorProvider.ts         只读编辑器与面板绑定
    src/readOnlyFileSystem.ts           md-reader: URI 与拒绝写操作
    src/resourceBroker.ts              路径、资源及链接的唯一策略入口
    src/protocol.ts                     宿主 / Webview 消息与校验
    src/parseWorker.ts                  Node Worker 消息适配
    src/views/                         文件树、搜索、大纲
    webview/                           迁入的阅读层与正文样式
    test/                              迁移后的语义、宿主和安全用例
  src/vs/workbench/contrib/mdReader/    产品打开路由与入口裁剪补丁
```

代码位置以固定版本实际服务入口为准。原生文件关联和安装包身份另走该版本构建脚本；不通过大范围修改上游组件 CSS 或复制整个工作台来实现产品定制。

## 7. 启用后实施顺序与交付门槛

以下阶段仅供以后确认启用时执行，不追加到当前 T07–T16 或 T24 系列中。启动前读取本方案及需求基线，再按阶段拆解可执行任务；必要安装、仓库操作和发行仍遵循项目协作规则。

| 阶段 | 交付范围 | 必须通过的验证 |
|---|---|---|
| C0 基线与独立包 | 固定源码 SHA/工具链，构建独立身份的最小工作台；记录修改清单、许可及启动服务 | 能重复构建；数据目录不冲突；离线启动；原有应用和 VS Code 配置不受影响 |
| C1 阅读闭环 | 只读文件系统、打开路由、自定义编辑器、解析 Worker、资源代理与基础正文 | 无工作区打开真实文件；图表/数学/高亮/图片兼容；源码不被写入；路径攻击及网络资源用例通过 |
| C2 工作台闭环 | 三个同级侧栏入口、原生标签、每文档搜索和位置、关闭恢复、双主题入口 | 打开多个文件和目录逐个阅读；重复路径去重；切换缓存不解析；加载中切换不串状态；键盘和焦点可用 |
| C3 文件与会话可靠性 | 外部保存刷新、替换/删除处理、跨重启恢复、资源释放及错误隔离 | 临时文件 rename 保存、瞬时不可读、删除后恢复、旧代次返回、窗口重开等场景通过 |
| C4 同条件对照与决定 | 原生交互核对、功能矩阵、性能及发行维护报告 | 按下列验收表记录差异和失败项，再决定是否切换；未通过时继续现有主线 |

优先暴露的五类失败：只读入口被绕过、目录链接越界、旧异步结果污染新文档、生产包资源/WASM 缺失、关闭/恢复丢失状态。分别归入 C1、C1、C2、C1、C2/C3，不能留到最后只做外观演示。

## 8. 验收与切换条件

| 维度 | 对照方法与通过要求 |
|---|---|
| 功能 | 使用相同 fixtures 和需求 AC 清单；现有主线已具备能力不得倒退。待实现能力单独列出，不因复用了上游就自动勾选 |
| 只读和安全 | 在测试目录记录文件内容/名称，触发保存、拖放、删除、重命名、命令及恶意文档路径；用户文件无变更。越界资源/链接、脚本、命令 URI 和默认远程请求必须被拒绝 |
| 状态 | 多文件各自搜索词、匹配位置及滚动位置；切换解析计数、最近关闭恢复、重启恢复、失效文件和加载竞态有明确断言 |
| 原生体感 | 固定窗口尺寸、主题、标签模式；100%/125%/150%系统缩放检查菜单命中、边距、图标、焦点、拖动、滚动条及窗口按钮。复用上游不能代替定制后的实机核对 |
| 资源与性能 | 与当前主线在同一设备、发布模式、相同文档及冷/热条件比较启动、首屏、交互、空闲 CPU、进程树内存和体积。沿用 [性能设计](./08-performance.md) 与 [ADR-003](../decisions/ADR-003-performance-thresholds.md) 的口径；不虚构体积或性能优势 |
| 升级维护 | 试做一次上游版本升级，记录补丁冲突、构建修复与完整回归范围；能列出后续安全更新和发布负责人 |

Code OSS 桌面路线采用 Electron，发行将承担自带运行时及其更新成本；当前 Tauri 的 WebView2 依赖说明不能原样复制。具体下载体积、内存与启动差异均须测量。构建环境按固定源码的要求检查，不能假定当前 pnpm/Rust 工具链足够，参见官方[构建与贡献指南](https://github.com/microsoft/vscode/wiki/How-to-Contribute)。

**只有同时满足以下条件，才提出主线切换决定：** 阅读功能与安全门槛通过；工作台体验收益已实机确认；资源成本有测量并可接受；上游升级和发行维护责任明确。之后另写新的 ADR，记录用户决定和迁移范围。本备案本身不修改 ADR-001 状态。

迁移先导入路径、阅读状态和主题选择，使用带版本的配置格式；不迁移可信 HTML 缓存。两个程序保持独立身份和数据目录，试验失败可以继续使用现有程序。移除旧主线、合并仓库或变更默认文件关联均不包含在备案内。

## 9. 当前结论与未验证项

该路线在架构上可行，适合“希望直接沿用 VS Code 工作台并愿意长期维护派生产品”的取向。建议保持扩展承载阅读能力、产品层补丁尽量少的边界。

**本次已完成的只有方案与官方接口/源码核对。** 尚未构建 Code OSS，尚未验证 Node Worker 打包、只读产品裁剪、资源代理效率、文件监听和会话恢复，也没有新宿主的性能或视觉验收结果。现有主线的构建及测试结果不外推到这条路线。
