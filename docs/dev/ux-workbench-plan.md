# 阅读工作台 Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans; follow the existing workspace ownership below, no git writes.

**Goal:** 实现 VS Code 式阅读工作台，让用户从目录连续打开和切换多份 Markdown。
**Architecture:** 独立目录 bridge + 多文档会话控制器 + 单活动 ReaderView；Vue 组件使用 props / events 连接，不重复持有文档状态。
**Tech Stack:** 已安装 Tauri 2 / Rust、Vue 3 / TypeScript、现有 markdown-it Worker，无新依赖。
**Spec:** `docs/design/15-reader-workbench.md`

## Global Constraints

- 用户“继续推进”覆盖前述 UX 范围的文件修改、测试、构建与本地运行；性能专项及 Git 后置。
- 保留已有未提交工作，在当前工作目录继续；不安装、不改系统、不提交、不分支、不推送。
- 不递归授予 asset 目录权限；浏览目录与正文资源授权分开。
- 本轮不扩大成完整 M1：真实 watcher、完整持久化 / 标签右键与重排、LRU 预算仍单列后续；不能将其标为完成。

## Review Focus

- 快速打开 A/B、切换和关闭时，旧异步结果不能抢占当前标签。
- 缓存切换须复用 ParseResult；资源解析仍针对正确 docId。
- 目录枚举遇到越界、符号链接 / junction、权限错误或根目录替换必须失败且可恢复。
- 搜索不修改脚本 / 公式 / SVG 结构，内容替换时移除旧高亮与 Range。
- 多选、取消选择、关闭最后一个标签、空文件、长文件名和窄窗口必须有正确反馈。

## Task 1 — 目录与多选桥接（host agent）

Files: `src/host/src/{folders,commands,lib}.rs`，`src/ui/src/core/ipc/workspaceBridge.ts`，对应 Rust / TS tests。
Produces: `FolderRoot {rootId,path,name}`，`FolderEntry {name,path,kind:'directory'|'markdown'|'file'}`，`DirectoryListing {entries,truncated}`；`WorkspaceBridge.selectFiles():Promise<string[]>`、`selectFolder():Promise<string|null>`、`openFolder(path):Promise<FolderRoot>`、`listDirectory(rootId,path):Promise<DirectoryListing>`、`closeFolder(rootId):Promise<void>`。导出 `workspaceBridge`，mock 使用 fixtures，生产 invoke 独立命令。
- [x] 写路径约束、懒枚举、排序及多选解析失败测试，先看到失败。
- [x] 实现根目录 registry、逐级安全列举及 Windows 原生选择器；保留旧 select_document。
- [x] Rust 针对测试、定向 rustfmt 与前端类型检查通过。

## Task 2 — 多文档会话（session agent）

Files: `src/ui/src/core/documents/session.ts`，`src/ui/tests/unit/document-session.spec.ts`。
Consumes: IpcBridge 的 open/read/close；注入 parse(text,generation):Promise<ParseResult>。
Produces: `DocumentSession`；`tabs:SessionTab[]`、`activeId:string|null`、`active:SessionTab|null`、`open(path):Promise<boolean>`、`openMany(paths):Promise<void>`、`openText(text,name):Promise<SessionTab>`、`activate(id):void`、`close(id):Promise<void>`、`closeAll():Promise<void>`、`setPosition(id,scrollTop):void`。`SessionTab` 有 `id,meta:DocMeta|null,name,path,result:ParseResult|null,status:'loading'|'ready'|'error',error:string,scrollTop:number`。构造 `(io,parse,onChange)`。
- [x] 先写真实并发、路径去重、缓存切换、关闭中读取、错误保留其他标签、openMany 激活首个的测试，验证失败。
- [x] 每个文档保留宿主句柄，关闭时释放；只有显式 activate / 最新 open 选择活动标签；无 Vue 依赖。
- [x] 针对单测绿；全局 parseCount 由注入 parse 计数，不把缓存切换算解析。

## Task 3 — 工作台组件（UI agent）

Files: `app/ActivityBar.vue`、`ExplorerPanel.vue`、`DocumentTabs.vue`、`SearchPanel.vue`。
Interfaces: ActivityBar props `active:'files'|'search'|'outline'|null` emits `select(panel)`；ExplorerPanel props `root:FolderRoot|null,activePath:string,bridge:WorkspaceBridge` emits `open(path),chooseFolder()`；DocumentTabs props `tabs:SessionTab[],activeId:string|null` emits `activate(id),close(id),open()`；SearchPanel props `query:string,count:number,current:number,hasDocument:boolean` emits `update:query(value),next(),previous()`。
- [x] 实现同级可访问入口、惰性树展开 / 错误 / 空状态与当前文件、标签关闭和键盘导航、当前正文搜索控件。
- [x] 局部样式用 `--app-*`，组件不读取 / 修改全局文档或自行调用选择器；数据加载使用注入 bridge。
- [x] 类型检查和组件实际浏览器交互由 Task 4 验收。

## Task 4 — 集成、搜索与文档（root）

Files: `App.vue`、`ReaderView.vue`、`reader/search.ts`、`styles/base.css`、UX E2E 及需求 / 设计 / 进度。
- [x] 先加 E2E：文件树开两文档、缓存切换不解析与位置恢复、搜索 / 大纲切换、关闭标签与侧栏，确认旧 UI 失败。
- [x] App 使用 DocumentSession；保留 M0 hooks 语义，hooks.close 关闭全部，openText 测量前关闭全部。打开原生多选 / 文件夹及多文件拖入 / argv 全量接入。
- [x] Reader 增加 scrollTop 保存 / 恢复与正文搜索，纯 DOM Range 遍历安全文本；匹配高亮优先 CSS.highlights，生命周期清理。
- [x] 紧凑工作台布局、活动栏、侧栏 resize/收起、标签、阅读器 / 状态栏；保留主题、安全与 mock 测试入口。
- [x] 修订旧设计文件树排除条款，记录本轮功能与 Git / 性能后置，不把其余 M1 任务全勾选。
- [x] 运行前端单测 / typecheck / lint、Rust tests、E2E、release 构建及原生功能复验；独立最终审查并修复必修项。原生选择器人工点击因桌面工具访问限制单列未测，不冒充自动验证已覆盖。

## Ledger

- Ruling: 沿用当前有未提交 M0 产物的工作目录，不创建 worktree、不执行技能模板中的 git 提交；用户当前范围只授权 UX 连续推进与本地验证。
- Ruling: 浏览器与原生使用同一 WorkspaceBridge 契约；目录枚举不接入 assetProtocol scope，避免文件树扩大图片权限。
- Pre-flight: Task 1 → 3 的 FolderRoot / WorkspaceBridge、Task 2 → 3 的 SessionTab、Task 2 → 4 的 Session API 如上，根集成适配这些唯一接口。
- Task 1: complete — Rust 目录 6 / picker 2 与 TS bridge 3，均有 RED→GREEN；完整宿主 30 项通过，格式检查通过。
- Task 2: complete — 会话 19 项通过，包含失败标签经新别名重试的 RED→GREEN 修复；前端完整单测 225 项通过。
- Task 3: complete — 4 个组件局部检查与工作台真实浏览器 5 项通过；类型检查通过。
- Task 4: integration verified — 完整浏览器 17 项通过，保留既有安全 / 主题 / 图片 / 图表回归。release 构建及真实原生工作台 / 原渲染样本复验通过，见执行记录；选择器人工点击受桌面工具权限限制，尚未实测。
- Final review: 搜索仅滚父元素与关闭提示误关正常标签两个 P2 均已用浏览器复现 RED，修复后 GREEN；失败标签的新路径别名重开也已修复并通过会话回归。
- Final integration: 浏览器 mock 文档 ID 不再因关闭文档复用，2 项 RED→GREEN 回归通过；原生功能检查使用样本确实包含的 CommonMark，缓存、位置、搜索、目录越界均为真实通过，不采新性能数据。
