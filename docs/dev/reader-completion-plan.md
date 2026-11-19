# 阅读流程完整性推进

日期：2026-11-07。用户要求继续实现相对完整的产品内容。沿用现有 Tauri + Vue 主线，Code OSS 仅备案；视觉、性能专项、Git、Qt 后置。

目标是形成「打开文件/目录 → 浏览多个文档 → 跟随链接 → 外部保存后刷新 → 重启继续阅读」的可用流程，不将其称为全部 M1 或性能验收完成。

## 执行约束

- 在当前目录保留已有改动，允许本轮实现、文档、测试、构建与本地验证；不安装、不执行 Git 写操作、不修改系统文件关联。
- 复用已有依赖。宿主与前端按以下固定契约分开实现，最终集成验证。
- 功能先补失败用例，再实现；记录实际结果。原生系统浏览器/附件打开只验证参数与边界，不在自动测试中打开用户的其他程序。

## 接口约定

- 现有 `resolve_link(docId, href)` / `open_url(url)` / `open_path_with_system(docId, path)` 接通；`ResolvedLink` 保持现有联合类型。
- 打开文档自动开始父目录监听，关闭最后一个同目录文档后停止；`doc:changed { docId, version, kind: 'modify' }`、`doc:gone { docId, version }`；宿主版本单调递增，删除后保留注册以便恢复。
- `read_document_meta` 返回当前磁盘元数据/版本；`read_document` 保留原始字节接口。前端重读前后核对版本，并丢弃过期解析。
- 新增 `load_workspace_state(): JSON | null`、`save_workspace_state({ state: JSON }): void`。只写应用自身数据目录，体积受限、原子替换、损坏数据可恢复。
- 持久化格式 `schemaVersion: 1`，保存主题、侧栏、字号、根目录、标签顺序/活动路径/各标签阅读和搜索状态、最近文件；不保存正文或 HTML。显式启动文件优先于旧会话。

## 交付任务

### A. 宿主文件能力

- [x] Rust 链接分类、同目录相对 Markdown/附件、锚点、外链及安全拒绝；绝对路径、未知协议、可执行附件、链接目录和越界受限。
- [x] 父目录监听、去抖、版本、覆盖/原子替换/删除/重建、句柄释放及读取重试。
- [x] 设置和会话 JSON 的受限读取、可靠保存与损坏回退。
- [x] Rust 单测覆盖真实临时文件；不增加依赖。

### B. 文档与阅读流程

- [x] 普通/修饰键/中键打开文档链接，后台标签与跨文档锚点，已打开路径去重；链接失败不留下空白标签。
- [x] 活动文件自动重读，后台文件标记待更新并在激活时刷新；删除/读取失败保留旧正文并提示；重建可恢复；手动刷新入口。
- [x] 刷新时保留像素阅读位置与搜索，异步读取/解析不覆盖后来的版本或标签。

### C. 持久化与标签管理

- [x] 重启恢复主题、侧栏、字号、目录、标签与阅读/搜索状态；最近文件入口；损坏配置回退且不阻断启动。
- [x] 标签拖动重排、右键关闭其他/右侧/全部、溢出列表；保留键盘和关闭恢复行为。
- [x] 单测与浏览器测试覆盖恢复、刷新、后台链接、标签顺序及失败路径。

### D. 集成验证

- [x] 完整前端测试、类型检查、静态检查、浏览器测试与 Rust 测试。
- [x] 发布构建及原生报告验证，特别核对真实文件监听和本地状态保存。
- [x] 独立审查本轮改动，修复确定问题；同步进度、剩余事项和程序位置。

## 执行记录

- 开始时现场确认：宿主只有基础读取/目录枚举，链接命令未注册；ReaderView 跨文档链接为占位提示；DocumentSession 没有 reload/version 守卫；主题及会话均未持久化。
- 裁定：沿用当前工作目录和既有文档作为执行台账，不创建额外 worktree、分支或流程目录。新宿主 API 与前端按上方契约并行处理，避免修改同一文件。

## 最终实现与复查

- 宿主：`links.rs`、`watcher.rs`、`workspace.rs`；`documents.rs` 追加稳定读取与单调版本，`commands.rs` / `lib.rs` 注册命令与事件。监听按父目录共享，120 ms 去抖；暂时缺失或占用重试 20 / 40 / 80 ms。删除保留注册，关闭最后一个文档释放目录监听。
- 会话：`session.ts` 接通刷新、后台待更新、跨文档锚点、重排和批量关闭；元数据 / 字节 / 元数据核对后再解析，旧任务不得覆盖新版本。右键“关闭其他”沿用设计 13 的既定规则，保留目标与操作前活动标签，再激活目标。
- 持久化：`workspaceState.ts` 校验 schema / 字段 / 上限，`WorkspaceWriter` 防抖并串行保存。原生写入应用配置目录 `workspace.json`，保留上一份有效备份，最大 2 MiB；浏览器开发模式使用本地存储。显式启动文件优先于旧会话，缺失文件不阻断其他文件恢复；最近文件最多 20 条，恢复标签最多 100 个。
- 界面接线：阅读区链接、F5 刷新、Ctrl+PageUp/Down、最近文件和字号菜单、标签右键 / 重排 / 溢出访问；沿用现有布局和配色。关闭窗口前刷新待保存状态，使用 Tauri [onCloseRequested](https://v2.tauri.app/reference/javascript/api/namespacewindow/#oncloserequested)。
- 独立审查的三个确定问题均已补回归并修复：首次打开期间的文件更新被旧解析误判为打开失败；拖动重排的类方法丢失接收对象；用户关闭全部 / 手动打开时，旧恢复任务继续打开文件。另补齐关闭活动标签后，待更新邻居自动刷新。

## 最终验证（2026-11-07，本地时间）

| 检查 | 结果 | 证据 |
|---|---|---|
| `pnpm ui:test` | 23 个文件，284 / 284 通过 | `benchmarks/reader-completion-unit.local.log` |
| `pnpm ui:typecheck` | 通过 | `benchmarks/reader-completion-typecheck.local.log` |
| `pnpm lint:ci` | 92 个文件，无错误 / 警告，15 条信息 | `benchmarks/reader-completion-lint.local.log` |
| `cargo test --manifest-path src/host/Cargo.toml` | 37 / 37 通过 | `benchmarks/reader-completion-rust.local.log` |
| `cargo fmt --manifest-path src/host/Cargo.toml -- --check` | 通过 | 本轮命令退出码 0 |
| `pnpm e2e --workers 1` | 42 / 42 通过，约 1.4 分钟 | `benchmarks/reader-completion-full-e2e.local.log` |
| `pnpm tauri build --no-bundle` | 发布构建成功；仍有既有大块体积提示 | `benchmarks/build-reader-completion.local.log` |
| 原生 WebView2 验证 | 4 档 IPC、7 个夹具、工作台和本轮宿主流程通过 | `benchmarks/native-reader-completion.json` |

原生验证命令：`./scripts/verify-m0.ps1 -RepoRoot D:\Project\Markdown -IdleSeconds 0 -ReportName native-reader-completion.json -VerifyReader`。本次不做性能采样；设置写入报告旁的隔离测试文件，不覆盖日常配置。脚本仅启动 / 关闭自己的进程，生成的两份实时刷新测试文件已清理。

原生报告 `complete: true`，无错误；`readerHost` 中 `links`、`persistence`、`liveRefresh`、`deletionRetained` 全为 true。实际覆写、替换、删除后重建的成功读取版本为 `[1, 2, 3, 5]`；旧正文在删除期间保留。浏览器用例另覆盖重载恢复目录 / 标签 / 主题 / 搜索 / 阅读位置、损坏设置、消失路径、后台链接与真实拖动后的顺序持久化。

程序：`D:\Project\Markdown\src\host\target\release\md-preview.exe`，10,729,472 字节，构建时间 2026-11-07 01:20:37。

SHA-256：`A38AC0AEF61863E9479F6662A2FEB50042B7E6295487A829556EB7ADDDD6A798`。

## 剩余范围与验证边界

- 当前可串起打开文件 / 目录、多文档阅读、链接、外部保存刷新和下次恢复；本记录完成不等于完整 M1 或正式发布验收。
- 编码仍只支持 UTF-8 / UTF-8 BOM。UTF-16、GB18030 等属于 T18 后续。
- 阅读位置保存像素值；前文插入 / 删除较多内容时，语义段落位置锚定仍待 T29。
- 链接的 `name` 锚点降级、悬停目标、闪烁反馈尚未实现；系统打开命令已接入，但自动测试不实际唤起浏览器 / 附件应用。
- 真实宿主已验证状态保存 / 读取，完整恢复界面由浏览器重载测试覆盖；尚未用原生窗口人工执行“关闭应用再启动”的整套体验核验。连续 20 次保存压力用例也未执行。
- 窗口位置 / 尺寸恢复、单实例、系统文件关联与打包分发待后续；本轮没有修改系统配置。
- LRU、大文件分段、统一解析调度及 M0 性能未达标项继续后置。UI 展示效果待后续设计与核对；Git 仅规划、Qt 跳过，Code OSS 继续仅备案。
