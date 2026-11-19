# 06 — 安全模型

> 覆盖 NFR-006 / NFR-007 / NFR-008 / 需求文档 §5.6 / AC-09 / AC-11。
> 代码落点:`src/host/src/security/**`、`src/host/capabilities/default.json`、`src/host/tauri.conf.json`、`src/ui/src/core/sanitize/policy.ts`。

---

## 1. 信任边界

```text
┌─────────────── 可信 ───────────────┐
│ Rust host                          │
│  命令实现、路径守卫、URL 策略        │
└──────────────┬─────────────────────┘
               │ IPC(白名单命令)
┌──────────────▼─────────────────────┐
│ 半可信:本应用的 Vue 代码            │
│  可能因第三方依赖或自身 bug 被影响   │
└──────────────┬─────────────────────┘
               │ innerHTML / asset: / 事件
┌──────────────▼─────────────────────┐
│ 不可信:Markdown 内容与本地资源      │
│  任意 HTML / 链接 / SVG / 图表源码   │
└────────────────────────────────────┘
```

**核心原则:不可信内容永远不获得 IPC 能力,也永远不能执行脚本。**

---

## 2. 攻击面清单与对策

| # | 攻击面 | 对策 | 所在层 |
|---|---|---|---|
| 1 | Markdown 内嵌 `<script>` | DOMPurify `FORBID_TAGS` + CSP `script-src 'self'` | 前端 + CSP |
| 2 | 事件处理器 `onerror=` 等 | DOMPurify `FORBID_ATTR` + `ALLOWED_ATTR` 白名单 | 前端 |
| 3 | `javascript:` / `vbscript:` / `data:` 链接 | markdown-it `validateLink`(默认已拦)+ 点击委托拦截 + Rust `url_policy` | 三层防御 |
| 4 | SVG 内嵌脚本(Mermaid 输出) | Mermaid `securityLevel:'strict'` + 二次 DOMPurify SVG profile | 前端 |
| 5 | 相对路径穿越 | Rust `path_guard` 规范化 + 组件级前缀比较 | Rust |
| 6 | 符号链接逃逸 | `canonicalize` 后再比较 | Rust |
| 7 | 整盘读取 | `assetProtocol.scope: []` + 运行期按目录授权 | Rust/配置 |
| 8 | IPC 命令越权 | capabilities 最小集 + 不引入 `fs` 插件 | 配置 |
| 9 | 依赖投毒(供应链) | lockfile 锁定 + `pnpm audit` + 避免 `postinstall` 脚本(见 §7) | 工程 |
| 10 | 远程资源泄露隐私 | 默认禁止远程图片;`connect-src` 仅 IPC | 应用层 + CSP |
| 11 | 拒服务型输入(ReDoS / 嵌套爆炸) | markdown-it 15 已修多处 ReDoS;`maxNesting: 100`;Worker 隔离 + 超时 | 前端 |
| 12 | 大文件内存耗尽 | 200 MB 上限 + 分段模式 + Worker | 应用层 |
| 13 | 恶意 Mermaid 图表导致长时间占用 | 渲染超时 5 s + 单图并发 2 | 前端 |
| 14 | 文件关联传入恶意路径 | `path_guard` + 只接受 `.md/.markdown/.mdown/.mkd` | Rust |

---

## 3. Capabilities 最小化

```jsonc
// src/host/capabilities/default.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "主窗口的最小权限集",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-set-title",
    "core:window:allow-set-focus",
    "dialog:allow-open",
    "store:default",
    "log:default",
    {
      "identifier": "opener:allow-open-url",
      "allow": [{ "url": "https://*" }, { "url": "http://*" }, { "url": "mailto:*" }]
    },
    {
      "identifier": "opener:allow-open-path",
      "allow": [
        { "path": "**/*.md" }, { "path": "**/*.markdown" },
        { "path": "**/*.mdown" }, { "path": "**/*.mkd" },
        { "path": "**/*.png" }, { "path": "**/*.jpg" }, { "path": "**/*.jpeg" },
        { "path": "**/*.gif" }, { "path": "**/*.webp" }, { "path": "**/*.svg" },
        { "path": "**/*.pdf" }, { "path": "**/*.txt" }
      ]
    }
  ]
}
```

> `opener:allow-open-path` 的存在是为了 FR-019 中「其他本地文件交系统默认程序打开」。它仍受 **`path_guard` 二次校验**约束:capability 只限制扩展名,**不**放行目录越界。可执行扩展名(`.exe/.dll/.ps1/.bat/.cmd/.vbs/.js/.msi`)一律不在允许列表中。
>
> `core:webview:allow-internal-toggle-devtools` **不在** release capabilities 中;dev 构建通过独立的 `capabilities/dev.json` 或 `#[cfg(debug_assertions)]` 注册。

明确**不授予**:

| 不授予 | 原因 |
|---|---|
| `fs:*` | 文件读取走自研 command |
| `shell:*` | 不需要执行外部程序 |
| `http:*` | 不需要发 HTTP 请求(远程图片由 WebView 直接加载,走 CSP) |
| `clipboard-manager` 写权限 | 首版只读;复制文本用标准 `navigator.clipboard`(WebView 内置) |
| `process:*` | 不需要 |
| `updater:*` | 首版无自动更新 |
| `core:webview:allow-internal-toggle-devtools`(release) | 用 `tauri.windows.conf.json` 或构建特性区分 |

窗口 label 固定为 `main`,不使用 `*` 通配。

2026-11-05 自定义标题栏：当前发布 capability 在既有 `core:default`、set-title、set-focus 基础上，仅给 main 增加 `core:window:allow-minimize`、`allow-toggle-maximize`、`allow-close`、`allow-start-dragging` 四个窗口动作；窗口设为 `decorations: false`。最大化状态查询、窗口事件与标题栏双击的 internal-toggle-maximize 由当前 core 默认权限覆盖。这里不新增文件、shell、网络或系统设置权限；上方 dialog/opener 段仍属于完整后续规格，实际权限以 `src/host/capabilities/default.json` 为准。

---

## 4. CSP 与配置

见 `04-assets-and-links.md` §4 的完整 CSP。补充约束:

```jsonc
"app": {
  "withGlobalTauri": false,          // 不暴露 window.__TAURI__
  "security": {
    "freezePrototype": false,        // M0 已复现开启时 Mermaid 依赖不兼容，见 ADR-001
    "dangerousDisableAssetCspModification": false,
    "pattern": { "use": "brownfield" }
  }
}
```

- `withGlobalTauri: false` → 前端必须 `import { invoke } from '@tauri-apps/api/core'`,同时避免任意注入的脚本直接拿到 `window.__TAURI__`。
- M0 发布构建实测：开启 `freezePrototype` 会使 Mermaid 的 vscode-jsonrpc 依赖向 `toString` 赋值时抛出只读异常并导致窗口空白；相同发布资源可用 `node src/bench/check-production.mjs --freeze` 重现。当前关闭这项可选硬化，保留严格 script CSP、HTML / SVG 消毒和逐文件资源授权。恢复前必须验证完整发布产物，见 [ADR-001](../decisions/ADR-001-renderer-and-host.md)。
- 当前 M0 的图片 CSP 不包含 `https:`，不提供远程图片开关；后续若实现用户主动开启远程图片，须另行设计安全策略，不能仅放宽 CSP。

---

## 5. 纵深防御:同一策略实现两次

| 策略 | 前端 | 后端 | 为什么重复 |
|---|---|---|---|
| URL scheme 白名单 | `url_policy`(TS) | `url_policy`(Rust) | 前端可被绕过,后端是最后闸门 |
| 路径越界 | 不做(前端无绝对路径) | `path_guard` | 前端根本无法构造路径 |
| 原始 HTML | DOMPurify | CSP `script-src 'self'` | 消毒若被绕过,CSP 仍阻止脚本 |
| 文件类型 | 检查扩展名(UI 层提示) | 检查扩展名 + canonicalize | 前端提示友好,后端强制 |

**唯一真源原则**:路径与 URL 的判定结果**只以 Rust 返回为准**。前端不自行判断「这个链接是否安全」,只负责展示 Rust 给的结果。

---

## 6. 日志与审计

```rust
// src/host/src/infra/logging.rs
// 使用 tauri-plugin-log,写入 app log 目录
// 级别:dev = Debug,release = Info
```

必须记录的审计事件(Info 级别):

| 事件 | 字段 |
|---|---|
| 打开文档 | path, size, encoding |
| 关闭文档 | docId |
| 路径被拒绝 | raw, verdict |
| URL 被拒绝 | raw, reason |
| 绝对路径放行(若开启) | path |
| watcher 失败 | dir, error |
| 命令返回错误 | code, docId |

**不得记录**:文件内容、用户输入的搜索词全文(只记长度)。

日志轮转:tauri-plugin-log 默认按大小轮转,配置 `RotationStrategy::KeepOne` + `max_file_size: 5MB`。

---

## 7. 供应链

| 措施 | 说明 |
|---|---|
| 锁定精确版本 | `package.json` 用固定版本(不用 `^`),`pnpm-lock.yaml` 提交 |
| 禁用生命周期脚本 | `.npmrc` 设 `ignore-scripts=true`;需要构建脚本的包(如 `@biomejs/biome`、`esbuild`)单独放行 |
| 依赖数量控制 | 前端运行时依赖目标 ≤ 20 个直接依赖 |
| 审计 | CI 跑 `pnpm audit --prod`;Rust 跑 `cargo audit` |
| 许可证 | 只用 MIT/Apache-2.0/BSD/ISC;GPL 依赖需确认 |
| 版本审查 | 每次升级 `markdown-it` / `mermaid` / `@tauri-apps/*` 主版本时,检查 release notes 的 breaking + security 段落 |

**已知风险点**:

- `mermaid 12.2.0` 依赖 `dompurify`、`katex`、`marked` 等 20+ 包,是最大的供应链面。缓解:仅在主线程按需 `import('mermaid')` 动态加载,isolate 到独立 chunk;版本锁定。
- `shiki` 的 `oniguruma` WASM 需要 `unsafe-eval`? → **实测确认**。若需要,则 CSP 必须加 `'wasm-unsafe-eval'`(Tauri 文档明确提到 WASM 需 `'wasm-unsafe-eval'`),这会削弱 CSP,需要权衡。备选:`createJavaScriptRegexEngine`(纯 JS 引擎,无 WASM,但语法覆盖略弱)。

---

## 8. 内容安全的具体规则(实现细则)

### 8.1 链接

```ts
// markdown-it 配置:保留默认 validateLink(已拦 javascript:/vbscript:/file:/data:)
// 额外:不允许 data: 图片以外的 data URL
md.validateLink = (url: string) => {
  const s = url.trim().toLowerCase()
  if (s.startsWith('javascript:') || s.startsWith('vbscript:')) return false
  if (s.startsWith('data:')) return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/.test(s)
  if (s.startsWith('file:')) return false
  return true
}
```

### 8.2 图片

- `data:image/svg+xml` **禁止**(SVG 可含脚本)。
- `data:image/png|jpeg|gif|webp` **允许**(常用于嵌入小图)。
- `blob:` 不来自 Markdown,由应用内部生成。

### 8.3 外链

```html
<a href="https://..." rel="noopener noreferrer" target="_blank">
```
但实际点击**不真正打开 target**,而是 `preventDefault` + `invoke open_url`。`rel` 是兜底(万一委托失效)。

### 8.4 剪贴板

首版不做「复制为 Markdown/HTML」的富文本写入(会引入更多 capability)。`Ctrl+C` 用浏览器默认行为。

---

## 9. 缺依赖场景(NFR-011 / AC-11,发布阶段)

| 平台 | 缺失 | 检测时机 | 用户可见行为 |
|---|---|---|---|
| Windows | WebView2 Runtime | NSIS 安装器(`webviewInstallMode: downloadBootstrapper`)+ 启动时 `Builder::build` 报错 | 安装器引导下载;启动失败时由**原生**消息框提示(不依赖 WebView) |
| Linux | WebKitGTK / 图形库 | 启动前 | 原生 stderr + 依赖说明(打包文档) |
| macOS | 系统版本过低 | 安装器 | 明确最低版本 |

**关键约束**(来自需求文档 §5.7):若 WebView 缺失导致主窗口无法创建,提示不能放在 Vue 页面里。实现方式:

```rust
// src/host/src/main.rs
fn main() {
    match run() {
        Ok(()) => {}
        Err(e) if is_webview_missing(&e) => {
            show_native_error_dialog(
                "缺少 Microsoft Edge WebView2 Runtime",
                "请安装后重试:https://go.microsoft.com/fwlink/p/?LinkId=2124703",
            );
            std::process::exit(1);
        }
        Err(e) => { eprintln!("{e}"); std::process::exit(1); }
    }
}
```

原生消息框在 Windows 用 `MessageBoxW`(通过 `windows-sys` 或 Tauri 的 `rfd`),**不依赖 WebView**。此项在 M1 末尾实现,但架构上现在就要把 `main` 写成能捕获错误的形式。

---

## 10. 检查清单(PR 合并前)

- [ ] 新增 IPC 命令 → 已在 capabilities 中最小授权,且入参经过 `path_guard`/`url_policy`
- [ ] 新增 HTML 元素 → 已在 DOMPurify `ALLOWED_TAGS` 中评估,并加测试
- [ ] 新增 URL 来源 → 已在 CSP 中评估,并加测试
- [ ] 新增依赖 → lockfile 更新、许可证合规、无 postinstall
- [ ] 涉及文件系统 → 有对应的 `path_guard` 单测(含 `..` 与 symlink)
- [ ] 涉及日志 → 不包含文件内容或用户搜索词
