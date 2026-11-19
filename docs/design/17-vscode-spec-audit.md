# VS Code 源码规格与体感核对

2026-11-07更新：用户将UI展示效果后置。本轮仅修复菜单鼠标/键盘双高亮及活动项不一致，见 [功能推进记录](../dev/functional-progress-plan.md)；下文“未修复”指11月6日审计时状态。尺寸、边距、配色建议尚未实施，原生缩放视觉对照仍待验。

日期：2026-11-06。用户同意提取规格，并明确不必限定老版本。当前源码基线更新为 **VS Code 1.145.1 稳定版**。本次重新核对新版源码，沿用同日上一轮的本项目浏览器测量；未重新运行浏览器取证，未修改产品代码。

## 当前基线：1.145.1稳定版

核对当日的 [GitHub稳定版发布](https://github.com/microsoft/vscode/releases/tag/1.145.1)和[官方更新页](https://code.visualstudio.com/updates/v1_145)均指向1.145.1。以下链接固定到该标签，不混用main；下方1.60.0记录仅解释现有实现的来源，不再作为后续修正依据。

用户已确认的单行标题/菜单、无顶部搜索、左侧活动栏、文件/搜索/大纲同级、白紫浅色、底部状态及主题入口继续有效。继续使用Tauri + Vue，不派生Code OSS。新版默认值、可选布局模式和本产品适配分别记录；CSS变量回退值不能直接当作全部模式下的最终尺寸。

| 核对项 | 1.145.1源码与适用条件 | 已有本项目实测及结论 |
|---|---|---|
| 顶部高度 | 浏览器工作台minimumHeight在无命令中心且无Web窗口控件覆盖时取30px，另有缩放分支。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/browser/parts/titlebar/titlebarPart.ts) | 外框30px、菜单内容29px。与所选分支接近；不能说新版所有标题栏都高30px，原生与缩放待验 |
| 顶部标志与标题 | 图标槽35px、背景图16px、标题12px。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css) | 槽32px、SVG 19px，存在差异；保留自己的标志并核对视觉中心。窗口按钮46px尚未用新版原生实现复核 |
| 顶部菜单 | 标题padding为0 8px、圆角5px；按钮使用默认箭头光标。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/base/browser/ui/menu/menubar.css) | 水平9px、直角、手形光标；标题内框和点击区域要分别核对 |
| 下拉菜单 | 最终菜单项高24px、左右margin各4px、圆角为cornerRadius-medium变量；菜单上下padding各4px；标签/快捷键水平padding各2em；分隔线上下margin各5px。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/base/browser/ui/menu/menu.ts) | 当前行高26px、上下4px、整行选择、分隔线上下4px、最小宽260px。上下留白一致，其余需核对；圆角最终像素值与完整盒模型仍待运行确认 |
| 菜单鼠标/键盘 | mouseover更新同一个focused item，并在变化时updateFocus。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/base/browser/ui/menu/menu.ts) | 上一轮复现双高亮、方向键从旧焦点继续移动。与新版统一活动项不符，问题仍待修正；Alt/F10及打开入口的平台分支另验 |
| 活动栏 | CSS变量回退宽48px、入口高48px、图标24px；指示线左边框2px、top 0、height 100%。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/browser/parts/activitybar/media/activityaction.css) | 48×48和24px盒一致；指示线实际高32px有差异。其他密度模式可覆盖回退值，图形轮廓另需视觉检查 |
| 侧栏标题 | 高35px；外层左右8px、文字另左padding 12px，合计起点20px；标题11px普通字重。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/browser/media/part.css) | 高35px、左20右8一致；12px标题是中文适配 |
| 文件树 | 行高22px；workbench.tree.indent默认8px、允许4–40px。[行高](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts)、[缩进](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/platform/list/browser/listService.ts) | 行高22px一致；当前层级步长16px、首两级padding 8/24px。箭头、图标、文字槽与层级起点须整体核对 |
| 标签 | normal 35、compact 22；modernUI 32、modernUICompact 28（含上下各4px）；connected 28、connectedCompact 24。标签左padding 10px，操作区0/8/0/4px。[模式](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/browser/parts/editor/editorTabsControl.ts)、[样式](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/browser/parts/editor/media/multieditortabscontrol.css) | 当前35px对应normal高度，不代表新版所有模式。120–240px宽度限制和图文间7px为本项目取值；关闭按钮、长标签待验 |
| 状态栏 | 高22px、字12px。[来源](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/browser/parts/statusbar/media/statusbarpart.css) | 基本尺寸一致；新版项目外间距、内边距与边缘项命中面积尚未逐项核实，不沿用旧版间距结论 |
| 正文 | 左右26px；字号/行高回退14/22px；普通段落下间距16px，标题字重600、上24/下16px；列表仍有0.7em规则。[来源](https://github.com/microsoft/vscode/blob/1.145.1/extensions/markdown-language-features/media/markdown.css) | 当前15/24px为阅读适配；普通段落16px、标题600与新版相符。常规左右26px一致，640宽的20px为适配 |
| 正文块 | 表格单元格5×10px；代码块16px；引用左10/右16px、左边框5px。[来源](https://github.com/microsoft/vscode/blob/1.145.1/extensions/markdown-language-features/media/markdown.css) | 当前表格8×12px、代码/引用12×16px、引用边框4px为适配；结合嵌套末项和长内容核对密度 |

### 配色与历史紫色的区别

新版 [Light Modern主题](https://github.com/microsoft/vscode/blob/1.145.1/extensions/theme-defaults/themes/light_modern.json)将状态栏及未打开文件夹状态栏都设为 **#F8F8F8**，字色 **#3B3B3B**、边界 **#E5E5E5**；活动栏也是#F8F8F8，焦点/活动指示色为#005FB8。该主题不默认使用紫色底栏。

[通用主题注册](https://github.com/microsoft/vscode/blob/1.145.1/src/vs/workbench/common/theme.ts)仍保留未打开文件夹状态栏的 **#68217A** 回退值，但主题可覆盖它；不能把该值称作新版Light Modern的实际配色。白紫方向按用户决定保留；#6D28D9、#68217A候选及各类选中紫色属于本产品配色取舍。下方对照截图是本项目画面，不是新版VS Code本体截图。

### 当前修正与验收依据

1. 菜单先统一鼠标/键盘活动项，复核“键盘→鼠标→方向键→Enter/Escape”。新版Alt/F10、鼠标打开初始状态与窗口失焦需专项核实。
2. 按新版24px行高、左右4px内缩、上下4px留白、分隔线5px及圆角变量核对菜单。**撤销旧版1.8em行高、0.5em上下留白和透明细边框换算作为实施目标**。
3. 核对树默认8px缩进、活动线全高、顶部35/16图标占位、菜单8px留白；固定标签模式后再比较标签关闭按钮、侧栏操作区和状态栏点击面积。
4. 在完整浅色界面中比较紫色候选，单独定义强调、柔和选中与菜单选中；正文15/24px、窄窗留白和中文标题字号作为阅读适配保留记录，不自动改回。
5. 固定窗口大小、系统缩放、主题、标签模式和密度后做运行画面对照。面板外边距0、连续直角是现有产品选择，不称为新版所有模式的默认外观。检查图标实际轮廓、字形、边框、滚动条、拖动范围及悬停命中面积。

**证据边界：** 下方1440/1024/640、DPR=1测量来自同日上一轮，仍可说明未修改的本项目界面；本次参考版本更新没有重新执行这些检查。未运行原生VS Code 1.145.1本体，100%/125%/150%系统缩放与原生窗口拖动/双击/失焦仍待验。源码数值和截图记录不能代替体感验收。

## 历史审计记录：1.60.0（已被上方基线取代）

以下保留前一轮的来源、测量与判断，用于解释当前实现。这里的“本轮”指前一轮1.60.0审计；旧版建议不是当前实施要求，当前要求以上方1.145.1章节为准。

### 历史参考基线与取值原则

统一参考 `microsoft/vscode` 的 **1.60.0 标签、Windows、自定义单行标题栏**。选择依据是前一轮已使用这一代连续工作区作为边距参考；不声称它就是用户截图的精确版本。链接固定到该标签，不混用当前 main 的值。用户指定的左侧活动栏、白紫浅色默认、文件/搜索/大纲同级及底部双主题继续有效。

本项目继续使用 Tauri + Vue。用户选择的是提取规格；Code OSS 整体派生作为已讨论的另一方案，不在本轮实施范围。

核对结果区分：**一致**（当前实测与源码值相符）、**差异**（需要纠正或明确决定）、**适配**（本阅读器已有取值，不能标成原版规格）、**待验**（缺少同环境运行证据）。CSS 中的 em、边框和内容盒分别记录，不能把声明高度直接当作最终外框高度。

### 历史尺寸、内外边距与排版

| 项目 | VS Code 1.60.0 源码 | 当前程序与核对结果 | 建议 |
|---|---|---|---|
| Windows 顶部 | 高/行高30px、外层padding 0；标题12px。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L30-L48) | 实测外框30px；底边1px占内部空间，菜单按钮实际29px | 外框一致；按钮内容盒及边界线需继续核对 |
| 顶部图标 | 占位35px，背景图16px。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L78-L90) | 占位32px，自绘SVG 19px | 占位/图形尺寸均有差异；建议35/16，保留阅读器自己的标志 |
| 窗口按钮 | 每个46px，组宽138px。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css#L115-L137) | 46px × 3 | 宽度一致；Tauri拖动及双击仍需原生窗口验收 |
| 顶部菜单按钮 | 水平padding 8px，默认箭头光标。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/base/browser/ui/menu/menubar.css#L20-L29) | 水平9px，手形光标 | 明确差异；建议按参考收齐 |
| 活动栏 | 宽48px；入口48×48，Codicon字号24px。[栏宽](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css#L5-L8)、[入口](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/activitybar/media/activityaction.css#L49-L69) | 48×48，自绘SVG盒24×24，四周padding 12px | 外框一致；字形与自绘图标的实际轮廓并不等同，仍需视觉对照 |
| 活动栏选中线 | 宽2px，top 0，贯穿入口全高。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/activitybar/media/activityaction.css#L71-L83) | 宽2px，上下各8px，实测高32px | 明确差异；建议全高48px，核对选中/焦点状态 |
| 侧栏标题 | 高35px；外层左右8px，文字再左移12px，即文字起点20px；标题11px、普通字重。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/media/part.css#L27-L57) | 高35px、左20右8、标题12px | 高度与水平起点一致；12px为中文阅读适配，不应称原版字号 |
| 文件树行 | `ITEM_HEIGHT = 22`。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/contrib/files/browser/views/explorerViewer.ts#L58-L63) | 实测22px | 一致 |
| 文件树缩进 | 默认8px/级；基准8px加(depth−1)×缩进。[默认值](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/platform/list/browser/listService.ts#L1170-L1175)、[计算](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/base/browser/ui/tree/abstractTree.ts#L318-L327) | 每级16px；实测第1/2级左padding为8/24px | 明确差异；建议8px/级；箭头、图标、文字占位另行核对，不能只改一个padding |
| 标签 | 高35px、左padding 10px；fit模式宽120px且允许按内容增长，shrink另有80px最小值。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/editor/media/tabstitlecontrol.css#L61-L116) | 高35px、左10px，固定限制120–240px，图标/文字间7px | 高度、左起点一致；240上限及内部间距是本项目适配。长标签、关闭按钮占位待进一步对照 |
| 底部状态栏 | 高22px、字12px；普通项目外侧margin各3px，内部padding各5px，边缘项还有7px规则。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/browser/parts/statusbar/media/statusbarpart.css#L4-L92) | 高22px、字12px；整体左右5px，各项内部6px；窄窗整体3px、各项4px | 高度一致；外间距与内间距不同会改变悬停面积，不能只比较文字间距。底部双主题为本项目适配 |
| 阅读面左右留白 | Markdown预览CSS左右26px。[来源](https://github.com/microsoft/vscode/blob/1.60.0/extensions/markdown-language-features/media/markdown.css#L5-L14) | 1440/1024宽实测26px，640宽20px | 常规宽度一致；窄窗20px是阅读器适配 |
| 正文密度 | 默认14px/22px，顶部1em；段落/列表下方0.7em。[来源](https://github.com/microsoft/vscode/blob/1.60.0/extensions/markdown-language-features/media/markdown.css#L5-L25)、[块间距](https://github.com/microsoft/vscode/blob/1.60.0/extensions/markdown-language-features/media/markdown.css#L129-L136) | 15px/24px，顶部16px，普通块下方16px；标题字重600 | 已有阅读适配，密度明显不同；保留为明确取舍，不因“参考VS Code”自动改回 |
| 侧栏总宽 | 随布局和用户调整，不能由单张截图推导成恒定宽度 | 本项目默认240px，最小180px，最大min(480, 窗宽−340) | 产品约束；不冒充上游固定值 |

面板外边距0与连续直角结构已落地；边缘的边框、拖动命中范围、滚动条占位仍应分别测量。当前原生滚动条和固定保留的滚动槽并不等于 VS Code 自定义滚动条的表现。

### 历史菜单尺寸与操作体感

该版本的下拉菜单样式嵌在 [menu.ts](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/base/browser/ui/menu/menu.ts#L945-L1198)，不存在同路径下的 menu.css，不能根据猜测路径建立来源。

源码字体13px，最终菜单内部行高1.8em，上下留白0.5em；每项外层另有透明细边框。以13px换算，内部高度23.4px、上下留白各6.5px，外框必须再按边框和实际布局测量。标签与快捷键各有2em水平留白，分隔线也采用em规则。当前是整行26px、上下留白4px、260px最小宽、分隔线上下4px；260px未找到同值来源，应标成适配。后续应按完整盒模型收齐，而不是简单把26改为23.4。

| 操作 | 参考行为与来源 | 本轮核对 | 优先级 |
|---|---|---|---|
| 键盘打开后移动鼠标 | 鼠标进入菜单项时更新同一个focused item。[menu.ts](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/base/browser/ui/menu/menu.ts#L155-L167) | **复现双高亮**：首项仍有focus-visible，鼠标悬停的第四项也变紫 | 优先修正 |
| 鼠标悬停后按方向键 | 鼠标与键盘沿用统一活动项 | 当前鼠标在第四项，按Down却从旧的第一项跳到第二项 | 与双高亮一起修正 |
| 鼠标/键盘打开入口 | 源码记录openedViaKeyboard，并传递给弹层打开逻辑。[menubar.ts](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/base/browser/ui/menu/menubar.ts#L804-L816) | 当前两种入口都强制聚焦首项 | 需统一状态逻辑，不能只用CSS掩盖 |
| Alt进入菜单 | Windows默认允许独立Alt聚焦菜单，再按Alt离开。[来源](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/base/browser/ui/menu/menubar.ts#L781-L845) | 当前从正文按Alt未聚焦菜单 | 待实施交互规格；F10本轮未核实，不作已确认要求 |
| Escape关闭 | 关闭弹层、恢复合理焦点 | 本轮从菜单Escape后焦点回到对应菜单按钮 | 当前这一条复验通过，不代表全部焦点行为等同 |
| 菜单切换/关闭/失焦 | 需区分鼠标、键盘、窗口失焦及点击外部 | 当前有左右切换、Escape和外点处理；窗口失焦、本机原生快捷键尚未专项验证 | 待补交互矩阵 |

当前手形光标、弹层阴影、禁用态、选中轮廓均应纳入同一套状态定义。源码能确定的行为直接建立验收项；阴影实际合成、原生菜单与Web菜单区别仍需同环境画面对照。

### 历史紫色：源值、适配与选择

[1.60.0主题源码](https://github.com/microsoft/vscode/blob/1.60.0/src/vs/workbench/common/theme.ts#L296-L335)明确：未打开文件夹的状态栏为 **#68217A**，打开工作区时为 **#007ACC**，文字为白色。这是有状态含义的配色，不是“整个VS Code都用这一种紫”。本产品若始终使用紫色，是用户白紫方向下的品牌适配。

| 颜色角色 | 当前值 | 核对与建议 |
|---|---|---|
| 浅色状态栏 | #6D28D9 | 白字对比度约7.10:1；更亮、偏蓝紫 |
| 历史参考紫 | #68217A | 白字对比度约10.06:1；更暗、偏红紫，建议作为底栏对照候选 |
| 强调/焦点 | #7C3AED | 本项目选色，不能标成VS Code原色 |
| 柔和整行选中 | #E6E0F1 | 本项目选色，需同时核对焦点和未聚焦状态 |
| 菜单选中 | #6D28D9 | 本项目选色；不能仅因底栏采用历史紫就机械替换所有选中态 |

两种底栏色已经在同一浏览器、同一页面状态下截图比较，只临时改变浏览器中的底栏变量，没有修改源码默认值：

- [当前底栏色](../../artifacts/single-title-menu/spec-audit-current.png)
- [历史紫色候选](../../artifacts/single-title-menu/spec-audit-reference-purple.png)

更暗的底栏视觉占用更克制，是设计判断；对比度数值只说明文字可辨性，不能证明哪一种主观上最舒服。颜色应与完整浅色界面一起确认。

### 上一轮证据与当时未完成的核对

2026-11-06本轮重新启动隔离的本地预览，在1440/1024/640宽、900高、DPR=1检查当前程序。测量记录见 [spec-audit-metrics.json](../../artifacts/single-title-menu/spec-audit-metrics.json)，执行日志见 [spec-audit.local.log](../../benchmarks/spec-audit.local.log)。检查脚本位于 `artifacts/single-title-menu/spec-audit.local.spec.ts`，配置位于同目录；不属于产品代码。

- 三种宽度均无窗口横向溢出；顶部30、活动栏48、侧栏标题/标签35、文件行22、底栏22已重新测量。
- 第1/2级树缩进8/24、活动指示线32px、菜单上下4px及26px行高均有运行时证据。
- [双高亮复现截图](../../artifacts/single-title-menu/spec-audit-keyboard-hover.png)与鼠标/键盘状态已保存。
- 1项取证脚本执行成功、无页面脚本错误。脚本记录差异，因此“执行成功”**不等于UX验收通过**；本轮没有修改产品代码，也没有重新构建桌面程序。
- 未运行原生VS Code 1.60本体，没有完成与其在同一Windows缩放下的逐项实机对照。100%/125%/150%系统缩放、原生窗口拖动/双击/失焦、滚动条和字形光学对齐仍为待验项，不用旧测试结论替代。

### 历史修正建议（当前要求见上方1.145.1章节）

1. 先修菜单统一活动项，覆盖“键盘→鼠标→方向键→Enter/Escape”，任一时刻只有一个活动项；再核对Alt、鼠标打开时的初始状态与返回焦点。
2. 收齐树8px缩进、活动线全高、顶部35/16图标占位与8px菜单留白；逐项展示修改前后画面，其他已确认结构保持明确记录。
3. 按完整盒模型核对菜单、标签关闭按钮、侧栏操作区和状态栏悬停面积。图标除外框尺寸外，还要比对实际轮廓、笔画和视觉中心。
4. 在固定浅色基准画面中确认底栏紫色，保留独立的强调、柔和选择、菜单选择角色；深色和纸张正文分别复核。
5. 补齐同环境原生对照与缩放验证。对齐边界按CSS像素测量，正常浮点布局允许0.5px差异；缩放后的物理像素、文字清晰度和点击体感另做人工检查。

每个条目的关闭条件是“源码/产品取舍已写明 + 实际布局证据 + 对应操作检查 + 人工画面复核”。不得用固定数值测试通过替代实际体感核对，也不将本次核对视为原版质感已完全达成。
