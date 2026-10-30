# 00 — 总体架构

> 本文是《Markdown 本地预览应用》的实现方案总纲,依据 `docs/requirements/Markdown本地预览应用_项目需求与技术方案_v0.4.md` 展开到可执行的技术细节。
> 状态:Proposed(待 M0 实测数据支撑后转 Accepted)。
> 上游:需求基线 v0.4(FR-001..020 / NFR-001..013 编号沿用该文档)。
> 下游:`01`~`12` 分册;`docs/decisions/ADR-001..004`。

---

## 1. 技术栈锁定(版本为 2026-10-29 实测 registry / crates.io 最新稳定版)

### 1.1 桌面宿主与前端

| 层 | 选型 | 版本 | 备注 |
|---|---|---|---|
| Desktop Host | Tauri | `tauri 2.12.5` / `tauri-build 2.7.4` | Rust ≥ 1.90(插件要求) |
| Tauri CLI / API | `@tauri-apps/cli` / `@tauri-apps/api` | `2.12.4` / `2.12.4` | 同版本成对升级 |
| UI 框架 | Vue | `3.5.44` | 只做外壳与交互,不把 Markdown 节点做成组件 |
| 状态管理 | Pinia | `4.1.0` | peer: `vue ^3.5.11` ✅ |
| 构建 | Vite | `8.3.5` | 要求 Node `^20.19 \|\| >=22.12`(本机 24.15.0 ✅) |
| Vue 插件 | `@vitejs/plugin-vue` | `6.0.10` | peer 支持 vite 5–8 ✅ |
| 类型 | TypeScript | `5.9.3` | **不用 7.0.x**(全新重写,生态未跟齐) |
| 类型检查 | `vue-tsc` | `3.3.13` | peer `typescript >=5.0` ✅ |
| 包管理 | pnpm | `11.15.0` | **必须 `cmd /c pnpm`**,PowerShell 执行策略禁止 `.ps1` shim |
| 格式化/Lint | `@biomejs/biome` | `2.6.4` | 单一工具替代 eslint+prettier |

### 1.2 渲染

| 能力 | 选型 | 版本 |
|---|---|---|
| Markdown Parser | `markdown-it` | `15.0.3`(内置 TS 声明,**不装 `@types/markdown-it`**) |
| GFM 表格/删除线 | markdown-it 内置 | — |
| 脚注 | `markdown-it-footnote` | `4.0.0` |
| 标题锚点 | `markdown-it-anchor` + `github-slugger` | `10.0.0` / `2.0.0` |
| GitHub Alerts | `markdown-it-github-alerts` | `1.0.1` |
| 任务列表 | **自研** `rules/taskList.ts` | — |
| 数学公式 | `@vscode/markdown-it-katex` + `katex` | `1.1.2` / `0.19.1` |
| 代码高亮 | `@shikijs/markdown-it` + `shiki` | `4.5.0` / `4.5.0` |
| 图表 | `mermaid` | `12.2.0` |
| HTML 消毒 | `dompurify` | `3.4.17` |
| 标签栏拖拽 | **原生 HTML5 Drag & Drop** | — |
| 搜索高亮 | **CSS Custom Highlight API** + `mark` 降级 | — |

> 标签栏与链接跳转都不引入第三方 UI/拖拽/路由库:标签是纯 Vue 组件 + 纯函数顺序逻辑(`core/tabs/order.ts`),链接分类的唯一真源在 Rust 侧 `resolve_link`。

### 1.3 Rust 侧

| 用途 | crate | 版本 |
|---|---|---|
| 文件监听 | `notify` + `notify-debouncer-full` | `8.2.1` / `0.7.0` |
| 编码检测 | `chardetng` + `encoding_rs` | `1.0.0` / `0.8.42` |
| 序列化 | `serde` / `serde_json` | `1.0.229` / `1.0.154` |
| ID | `uuid` | `1.29.0` |
| 错误 | `thiserror` | `2.0.21` |
| 进程资源采样(基准用) | `sysinfo` | `0.40.0` |
| 插件 | `tauri-plugin-single-instance 2.5.5`、`opener 2.7.2`、`dialog 2.8.4`、`window-state 2.5.0`、`log 2.10.1`、`store 2.5.0` | — |

### 1.4 明确的排除项

- **不用** `tauri-plugin-fs`:文件读取全部走自研 command,缩小 capability 面。
- **不用** `tauri-plugin-persisted-scope`:asset 授权只在会话内有效,不落盘。
- **不用** `markdown-it-task-lists@2.1.1`(2022-06 后无更新)。
- **不并行**使用 unified/remark 作为第二解析器。
- **不引入**虚拟滚动库、UI 组件库、CSS 框架。
- **不引入**拖拽库(sortablejs / vue-draggable 等):标签重排用原生 HTML5 DnD,顺序逻辑为纯函数。
- **不引入**前端路由库(Vue Router):「当前文档」是状态而非 URL,避免与 Tauri 的 `tauri://` origin 及 `file://` 语义纠缠。

---

## 2. 源码目录布局

> 待 `ADR-004` 最终确认;下面是推荐方案(`src/host` + `src/ui`)。

```text
D:\Project\Markdown\
├── AGENTS.md
├── README.md
├── package.json                    # 根:workspace + tauri CLI + 脚本
├── pnpm-workspace.yaml             # packages: [src/ui]
├── tsconfig.base.json
├── biome.json
├── playwright.config.ts
├── .gitignore  .editorconfig
│
├── docs/
│   ├── requirements/               # 需求基线 v0.4
│   ├── design/                     # 本目录(00~12)
│   └── decisions/                  # ADR-001..004
│
├── fixtures/                       # 纯数据
│   ├── basic.md
│   ├── extended.md
│   ├── theme.md
│   ├── html-safety.md
│   ├── cjk-typography.md
│   ├── resources/
│   └── generated/                  # gitignore
│
├── benchmarks/
│   ├── environment.md
│   ├── results.csv
│   └── findings.md
│
└── src/
    ├── host/                       # Tauri 2 Rust crate 根
    │   ├── Cargo.toml  Cargo.lock  build.rs
    │   ├── tauri.conf.json  tauri.windows.conf.json
    │   ├── capabilities/default.json
    │   ├── icons/
    │   ├── src/
    │   │   ├── main.rs  lib.rs
    │   │   ├── app_state.rs  error.rs
    │   │   ├── ipc/{mod.rs, dtos.rs, events.rs}
    │   │   ├── commands/{mod.rs, documents.rs, assets.rs, links.rs, app.rs}
    │   │   ├── documents/{mod.rs, registry.rs, reader.rs, encoding.rs, meta.rs}
    │   │   ├── watcher/{mod.rs, debounce.rs, translate.rs}
    │   │   ├── security/{mod.rs, path_guard.rs, url_policy.rs}
    │   │   └── infra/{mod.rs, logging.rs, paths.rs}
    │   └── tests/{path_guard.rs, encoding.rs, watcher.rs, registry.rs, dto_snapshot.rs}
    │
    ├── ui/                         # Vue 3 + TS 前端
    │   ├── index.html  vite.config.ts  tsconfig.json  tsconfig.node.json
    │   ├── src/
    │   │   ├── main.ts  App.vue  env.d.ts
    │   │   ├── app/                # 外壳:TitleBar TabBar(+TabItem/TabOverflowList/TabContextMenu)
    │   │   │                       #       Sidebar TocPanel SearchPanel StatusBar SettingsDialog
    │   │   ├── reader/             # 阅读区:ReaderView DocumentBody MermaidCard bindLinks scrollAnchor
    │   │   ├── core/               # 领域逻辑(无 Vue 依赖)
    │   │   │   ├── ipc/            # bridge / contract / tauriBridge / mockBridge / events
    │   │   │   ├── markdown/       # 解析管线 + rules + augment + toc + slug + segment
    │   │   │   ├── sanitize/       # DOMPurify 策略
    │   │   │   ├── render/         # jobQueue / workerClient / mermaid / shiki
    │   │   │   ├── documents/      # manager / reload / linkResolver / assetUrl / budget
    │   │   │   ├── tabs/           # order(纯函数) / recent / persist / dnd
    │   │   │   ├── search/         # 文本搜索 + highlight
    │   │   │   └── theme/
    │   │   ├── workers/parse.worker.ts
    │   │   ├── stores/             # documents / tabs / settings / ui
    │   │   ├── styles/
    │   │   └── i18n/zh-CN.ts
    │   └── tests/{unit,component,e2e}/
    │
    ├── bench/                      # 所有脚本代码
    │   ├── gen-fixtures.mjs
    │   ├── web-bench.mjs
    │   ├── sample-tree.ps1
    │   └── qt-bench.py
    │
    └── experiments/
        └── qt-renderer/            # M0 受限对照(PySide6)
```

### 2.1 Tauri 如何定位 `src/host`

已验证事实(来源:`tauri-apps/tauri` `crates/tauri-cli/src/helpers/app_paths.rs`):

1. `resolve_tauri_dir()` 先检查 `cwd` 与 `cwd/src-tauri` 下是否存在 `tauri.conf.json` / `tauri.conf.json5` / `Tauri.toml`。
2. 未命中则 `lookup(cwd, …)`,**最大深度由 `TAURI_CLI_CONFIG_DEPTH` 控制,默认 3**。`src/host` 深度 2,可命中。
3. 兜底环境变量:`TAURI_APP_PATH`(Rust crate 目录)、`TAURI_FRONTEND_PATH`(含 `package.json` 的目录)。

因此:

- `tauri.conf.json` 中 `build.frontendDist` 相对于**配置文件所在目录**解析 → `"../ui/dist"`。
- `build.beforeDevCommand.cwd` 设为 `"../ui"`,`devUrl` 为 `"http://localhost:1420"`。
- 若未来 CLI 行为变化,用 `TAURI_APP_PATH=src/host` 固定。

---

## 3. 分层与依赖方向

```text
┌──────────────────── Tauri 2 Host (Rust, src/host) ────────────────────┐
│  commands/     open_document read_document close_document             │
│                resolve_assets resolve_link reveal_document            │
│                open_url open_path_with_system get_env_info            │
│  documents/    DocumentRegistry  docId → {path, dir, watcher, ver}    │
│  watcher/      notify + debouncer → emit events                       │
│  security/     path_guard(规范化/越界/符号链接) + url_policy(scheme)   │
│  ipc/          DTO + 错误码 + 事件常量                                 │
└───────────────────────────────────────────────────────────────────────┘
        ▲ invoke / event                          │ asset: 协议(按文档目录授权)
        │                                         ▼
┌──────────────────── UI (Vue 3 + TS, src/ui) ──────────────────────────┐
│  stores/          documents / tabs / settings / ui                    │
│  core/tabs/       order(纯函数) recent persist dnd                    │
│  core/documents/  manager reload linkResolver assetUrl budget         │
│  core/render/     jobQueue(代次/优先级) workerClient mermaid shiki    │
│  workers/         parse.worker.ts  ← markdown-it 全管线               │
│  app/             TitleBar TabBar Sidebar StatusBar SettingsDialog     │
│  reader/          ReaderView → innerHTML → bindLinks → 主线程扩展层    │
└───────────────────────────────────────────────────────────────────────┘
```

**依赖规则(强制)**

1. `core/**` 不得 import `vue`、`pinia`、`@tauri-apps/api`。所有外部能力经 `core/ipc/bridge.ts` 注入的接口访问。
2. `app/**`、`reader/**` 可 import `core/**` 与 `stores/**`;反向禁止。
3. `workers/**` 只 import `core/markdown/**` 与第三方解析库,不得 import Vue/DOM 相关代码。
4. Rust 侧 `commands/**` 依赖 `documents/**`、`watcher/**`、`security/**`;反向禁止。
5. `core/tabs/order.ts`、`core/tabs/recent.ts`、`core/documents/budget.ts` 必须是**纯函数模块**(输入→输出,无副作用,不读全局状态),以便无需挂载组件即可单测。
6. 链接类型的判定**只在 Rust** `resolve_link` 中实现一次;前端 `linkResolver.ts` 只做类型映射与分发,不得复制一份 scheme/扩展名判断逻辑。
7. 违反以上任一条由 Biome 的 `noRestrictedImports` 规则在 CI 拦截。

---

## 4. 进程与线程模型

| 执行体 | 职责 | 禁止事项 |
|---|---|---|
| Rust main thread | Tauri 事件循环、窗口 | 不做文件 IO、不做 debounce 计算 |
| Rust 阻塞池 | `read_document` 读字节、编码检测 | 不长时间持有 registry 写锁 |
| notify 线程 | 文件系统事件源 | 不直接触碰 WebView |
| debouncer 线程 | 合并事件 → emit | 不读文件内容(只 stat) |
| WebView 主线程 | DOM 插入、Mermaid、搜索、滚动 | **不做 Markdown 解析** |
| Web Worker | markdown-it + Shiki + KaTeX | 不做 Mermaid(需 DOM)、不做 DOMPurify(需 DOM) |

**两条硬规则**

1. 解析永不在 WebView 主线程执行(NFR-001)。
2. 同一时刻只有一份"活动 DOM";非活动标签只保留数据,不保留 DOM(NFR-002/NFR-003)。

---

## 5. 端到端数据流

### 5.1 首次打开

```text
双击 .md / Ctrl+O
  → (单实例)第二实例 argv 转交 → app:open-files 事件
  → invoke open_document{path}
      Rust: path_guard 校验 → UUID 生成 → stat → 编码探测 → registry 插入
            → notify watch(父目录) → asset_protocol_scope().allow_directory(dir, true)
      ← DocMeta{docId,path,dir,name,size,mtimeMs,encoding,version:1}
  → invoke read_document{docId}
      ← ArrayBuffer(原始字节)
  → TextDecoder(encoding) → string
  → jobQueue.submit({jobId, docId, generation:1, text, opts})
  → Worker: markdown-it → token 增强 → Shiki → KaTeX → html + toc + blocks
  ← ParseResult
  → 主线程: hasRawHtml ? DOMPurify.sanitize : html
  → readerEl.innerHTML = html
  → IntersectionObserver → Mermaid 懒渲染(并发 2)
  → 建立 blockAnchors → 恢复滚动位置 → 计算首屏
```

### 5.2 外部保存导致刷新

```text
编辑器保存
  → notify(父目录) → DebouncedEvent(120ms)
  → translate: 命中 registry 的 canonical path
  → stat 重试(50/150/300ms × 3)
  → 成功: version += 1 → emit doc:changed{docId, version, kind:"modify"}
  → 前端: 若 generation < version → 丢弃进行中的任务
          活动标签: read → parse → 原子替换 DOM → 恢复锚点
          非活动标签: 标记 stale,不解析
```

---

## 6. 全局错误策略

| 层 | 策略 |
|---|---|
| Rust command | 返回 `Result<T, AppError>`,`AppError` 序列化为 `{code, message, detail}` |
| IPC 桥 | 统一捕获 → 转 `IpcError`,不向上抛原始字符串 |
| Worker | 解析异常捕获 → 返回 `{ok:false, error}`,主线程降级为 `<pre>` 源码视图 |
| 单块渲染失败 | Mermaid/KaTeX/Shiki 局部失败只影响该块,注入错误占位元素 |
| Vue 组件 | 全局 `onErrorCaptured` + `ErrorBoundary` 组件 |
| 进程级 | 设置 `panic = "abort"` 会丢失可诊断性 → 使用 `std::panic::catch_unwind` 包裹 command 边界 |

---

## 7. 实现约束(与需求文档 §5 一致,不复述理由)

- 不做通用多后端渲染插件平台。
- 不为兼容性同时维护两套正式渲染器。
- 不提前设计插件市场、工作区、知识库。
- 所有"阈值"(大文件分段、缓存预算、去抖时长)必须在 M0 实测后写入 ADR,不得凭直觉写死。
