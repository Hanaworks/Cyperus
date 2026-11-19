# 功能连续性推进 Implementation Plan

日期：2026-11-07。用户要求继续推进其余功能，UI展示效果后置。本轮落实已有T24c/T31与菜单交互缺陷，不改配色、尺寸或布局。

后续已继续实施前后端阅读流程，见 [阅读流程完整性记录](./reader-completion-plan.md)。本文只记录先前三个交付项的范围与验证，其“后续任务”不代表最新实现状态。

**Goal:** 切换文件保留搜索上下文，恢复误关的路径文档，鼠标与键盘共用一个菜单活动项。
**Architecture:** DocumentSession保存每标签查询/当前匹配和最多15条关闭记录；ReaderView在切换时恢复高亮而不抢走阅读位置；菜单焦点作为活动项的唯一依据。
**Tech Stack:** 现有Vue、TypeScript、Vitest、Playwright、Tauri；不新增依赖。
**Spec:** [标签设计](../design/13-tabs.md)、[搜索与导航](../design/10-ui-and-navigation.md)、[菜单问题取证](../design/17-vscode-spec-audit.md)。

## 范围与执行约束

- 在现有工作目录继续，保留已有改动；不安装、不创建worktree、不进行Git写操作、不修改系统配置。
- Qt继续跳过，Git只规划，性能专项及配色/几何调整后置。
- 按现有计划直接执行，逐项先复现/建立失败用例，再实现与验证；不重复请求已授权范围的确认。
- 只恢复有真实路径的关闭文档，不保留浏览器临时导入的全文；记录仅限当前会话，跨启动恢复后续。
- 无关联的watcher、跨文档链接、右键/重排及设置持久化不在本次三个交付项中，继续保留后续任务。

## Review Focus

- 切换时旧文档异步搜索/滚动事件不能覆盖新标签状态。
- 恢复搜索高亮不能将已保存阅读位置强制跳到第一匹配。
- 连续恢复、关闭仍在加载的恢复任务、路径别名去重不能复活已关标签或丢失宿主句柄。
- 文件消失/读取失败时应提示、移除该关闭记录，不留下新错误空标签；不误删原有标签。
- 键盘移动后鼠标仍停在旧项目上，只有键盘活动项高亮；禁用项不能获得焦点。

## Task 1：每标签搜索上下文

Files: `src/ui/src/core/documents/session.ts`、`src/ui/src/reader/search.ts`、`src/ui/src/reader/ReaderView.vue`、`src/ui/src/App.vue`及对应单测/浏览器工作台测试。

Interfaces: `SessionTab.search: { query: string; current: number }`；`setSearch(id, query, current = 0): void`；`DocumentSearch.update(query, current = 1, reveal = true): SearchSummary`，current使用界面的一基序号，无匹配为0。

- [x] 先验证两个标签的查询/匹配独立、清除只影响当前标签；恢复越界序号夹紧，恢复高亮不滚动。
- [x] 在session保存状态，App使用当前标签的查询；ReaderView区分新查询和文档切换，恢复时保留scrollTop，隐藏搜索面板不清除上下文。
- [x] 定向单测、浏览器中往返两文档/切换面板/清除/关闭验证通过；切换不增加parseCount。

## Task 2：恢复最近关闭

Files: `session.ts`、`App.vue`、`WorkbenchTitlebar.vue`及会话、菜单、浏览器测试。

Interfaces: `canReopen: boolean`只读getter；`reopenLastClosed(): Promise<boolean>`；文件菜单新增“恢复关闭的文档”，快捷键Ctrl+Shift+T。

- [x] 先验证LIFO、最多15条、原标签位置与阅读/搜索恢复、重复路径、失败清理和快速关闭/恢复。
- [x] 记录路径/原位置/scrollTop/search，不保留解析结果或宿主句柄；恢复走现有host队列重新读取，已打开路径直接激活，不覆盖存活标签状态。
- [x] 加入快捷键和菜单入口，无记录时禁用；关闭全部前保存当前阅读位置；验证原位置、最新文件内容及出错后其他标签可用。

## Task 3：统一菜单活动项

Files: `WorkbenchTitlebar.vue`、`workbench-titlebar.spec.ts`及浏览器工作台测试。

- [x] 复现键盘打开→鼠标移到末项→方向键：原鼠标未更新焦点，存在双高亮与旧焦点导航。
- [x] 鼠标移动到可用项时更新焦点；选择背景只跟随焦点，避免静止鼠标继续产生第二高亮；不改颜色/尺寸。
- [x] 验证方向键循环、禁用项、Escape返回菜单入口，以及实际浏览器单高亮。

## 最终验证与记录

- [x] 完整 `pnpm.cmd ui:test`、`pnpm.cmd ui:typecheck`、`pnpm.cmd lint:ci`。
- [x] 完整 `pnpm.cmd e2e --workers 1`；只使用已安装浏览器。
- [x] 只读独立审查本轮文件，修正实际问题并验证。
- [x] `pnpm.cmd tauri build --no-bundle` 与原生功能报告复验；不采性能、不进行系统关联设置。
- [x] 同步README、T24c/T31、搜索/标签文档与执行记录；保留历史验证数字并标明本轮新结果。

## 执行记录

- 开始：现场确认查询为App共享ref，搜索update总从第一项滚动，关闭记录未实现；菜单:hover和:focus-visible独立且鼠标未更新焦点。
- 接口检查：恢复关闭记录依赖Task 1搜索状态；其他任务共享App/标题栏，顺序修改避免覆盖。
- Task 1：查询独立与指定序号恢复的单测先失败后通过；浏览器验证往返标签保留查询/序号/阅读位置，离开搜索清高亮但保留上下文，清除只影响当前标签，parseCount不增加。
- Task 2：6项恢复会话用例先失败后通过，覆盖15条/LIFO、最新文件内容、原顺序与状态、存活路径和别名去重、文件消失清理、快速关闭与加载中再次关闭。
- Task 3：鼠标不更新焦点的单测先失败后通过；浏览器确认鼠标移到末项再按Down后只有首项高亮，即使鼠标仍停在末项。
- 首次集成发现加载占位的空matches与scroll事件覆盖恢复状态，分别出现序号2→1、位置700→0；App忽略非ready事件后定向恢复回归通过。原失败日志保留，不作为通过证据。
- 独立审查发现P2：恢复仍在加载时再次切标签，rememberPosition会取空Reader的0。新增延迟读取的浏览器回归先失败（700→0），再让Reader暴露带sessionId且渲染完成的有效位置，App仅记录匹配的ready标签，最终完整回归通过。无其他确定缺陷；临时正文恢复、跨启动持久化与视觉调整按明确范围留待后续。
- 最终前端验证：19文件255项单测通过，类型检查通过，静态检查82文件通过（13项非阻断info）。日志为 `benchmarks/functional-unit.local.log`、`functional-typecheck.local.log`、`functional-lint.local.log`。
- 最终浏览器验证：37项通过，包含5项新增功能/回归检查；日志 [functional-e2e-passed.local.log](../../benchmarks/functional-e2e-passed.local.log)。`functional-workbench-e2e.local.log`、`functional-e2e-final.local.log`与`functional-loading-red.local.log`为保留的失败调查记录。
- 执行环境：默认本地预览启动未就绪后结束该自有测试进程，按既有授权在允许本地预览/浏览器运行的环境重试；未安装任何依赖。含竖线的测试筛选参数曾被Windows命令包装器拆开，改用测试路径/行号与完整测试命令。
- 发布构建通过：[md-preview.exe](../../src/host/target/release/md-preview.exe)，10,314,752 bytes，2026-11-07 00:35:37上海时间；SHA256 `933BEEDB9BA99606DCC784974C8CB9FC68B95DC2C8317A091A9A4C0CA3F17497`。日志 [build-functional.local.log](../../benchmarks/build-functional.local.log)。保留既有大chunk与未使用错误枚举提示，未扩展性能优化范围。
- 原生功能复验通过：[native-functional.json](../../benchmarks/native-functional.json)，complete=true、errors为空，4档IPC与7样本继续通过。真实目录9/20项、缓存切换不解析、路径去重与越界拒绝通过；新增independentSearch=true、reopenedState=true，切换及重新打开的阅读位置均700。此次探针不替代原生选择器手动点击或系统缩放验收；IdleSeconds=0，未采性能，自己的PID 20248已退出。
- 文档相对链接检查与 `git diff --check` 通过。没有提交/分支操作，也没有安装依赖或修改系统配置。

## 接续顺序

本轮三个功能交付项之外，优先继续T24b文档内本地/外部链接与跨文档锚点，再推进T21/T22真实文件变更监听和T33设置/跨启动恢复。完整标签右键/重排/溢出仍在T24c内保留。上述为既有待办排序，不表示已实现；视觉细节、性能、Git和Qt沿用用户指定边界。
