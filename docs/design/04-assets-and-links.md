# 04 — 资源与链接解析

> 覆盖 FR-006 / UC-06 / AC-03 / NFR-006 / NFR-008。
> 代码落点:`src/host/src/commands/assets.rs`、`src/host/src/commands/links.rs`、`src/host/src/security/path_guard.rs`、`src/host/src/security/url_policy.rs`、`src/ui/src/core/documents/linkResolver.ts`。

---

## 1. 威胁模型(先定义拦什么)

| 攻击/误用 | 载体 | 后果 |
|---|---|---|
| 目录穿越 | `![](../../../Windows/System32/config/SAM)` | 读取任意文件 |
| 符号链接逃逸 | 文档目录内放一个指向 `C:\` 的 symlink | 绕过目录限制 |
| 脚本执行 | `<script>` / `onerror=` / `javascript:` 链接 | XSS,拿到 IPC 能力 |
| 本地文件探测 | 大量 `<img src="asset://...">` 推测文件是否存在 | 信息泄露 |
| 协议滥用 | `file://`、`data:text/html` | 越权/脚本 |
| SSRF | 远程图片/CSS 拉取到攻击者服务器 | IP 泄露 |

结论:**默认最小权限**;所有对本地文件的读取都必须经过 `path_guard`;所有 URL 都要过 `url_policy`。

---

## 2. 路径守卫(path_guard)

### 2.1 接口

```rust
// src/host/src/security/path_guard.rs
pub struct DocScope {
    pub root: PathBuf,      // canonical 文档目录
    pub doc_path: PathBuf,  // canonical 文档自身
}

pub enum PathVerdict {
    Allowed(PathBuf),       // canonical,已确认在 root 内
    OutsideScope,
    NotFound,
    NotAFile,
    Invalid,
}

pub fn resolve_asset(scope: &DocScope, raw: &str) -> PathVerdict;
pub fn resolve_md_link(scope: &DocScope, raw: &str) -> PathVerdict;
```

### 2.2 校验步骤(顺序不可省)

```
1. 空/超长(> 4096)→ Invalid
2. 百分号解码(markdown-it 已 normalizeLink,可能仍有 %20)
3. 拒绝包含 NUL 字符
4. 若是 URL scheme(http/https/data/mailto/javascript/asset) → Invalid(不在此函数处理)
5. 把 '\' 统一成 '/' 仅用于解析;交给 PathBuf 处理平台差异
6. 拼接:scope.root.join(raw)(若 raw 是绝对路径 → 直接判定 OutsideScope)
7. dunce::canonicalize(规范化,消解 .. 与 symlink)
8. 检查 starts_with(scope.root)(路径前缀比较,按组件而非字符串比较)
9. 检查 is_file()
```

**第 8 步必须按组件比较**:

```rust
fn is_within(root: &Path, p: &Path) -> bool {
    p.starts_with(root)          // Path::starts_with 是组件级比较,天然正确
}
```

不要用 `p.to_string_lossy().starts_with(root_str)`,否则 `C:\docs-evil` 会被判为在 `C:\docs` 内。

### 2.3 符号链接

`dunce::canonicalize` 会解析 symlink,因此:

- 文档目录内的 `link -> C:\Windows` 会被规范化为 `C:\Windows\...` → 第 8 步失败 → `OutsideScope`。
- 文档目录**自身**是 symlink 时,`root` 也已规范化,因此比较仍成立。

> 若出于性能考虑不想每次 canonicalize(50 张图 = 50 次系统调用),正确做法是**在 `open_document` 时**把 `root` 规范化一次并缓存到 `DocScope`,后续只 canonicalize 目标路径。目标路径的 canonicalize 不可省。

### 2.4 绝对路径策略

默认:**拒绝**。设置项 `allowAbsoluteAssetPaths`(默认 `false`)开启后允许绝对路径,但仍需满足:

- 路径存在且是文件;
- 不是可执行文件类型(`.exe/.dll/.ps1/.bat/.cmd/.vbs/.js/.msi`);
- 记录审计日志(每次放行写一条 `log::warn!`)。

**为什么不干脆允许**:Markdown 文件常来自网络下载,绝对路径引用是低成本的信息探测手段。

### 2.5 本地 Markdown 链接

`resolve_md_link` 与 `resolve_asset` 的差异:

| 差异点 | asset | md link |
|---|---|---|
| 允许扩展名 | 任意(但按 MIME 处理) | `.md` `.markdown` `.mdown` `.mkd` |
| 允许目录 | 文档目录递归 | 同左(初始版本);后续可放宽到「同目录 + 子目录」 |
| 页内锚点 | 不适用 | `a.md#section` → 拆出 `anchor` |

若链接目标不存在:返回 `NotFound`,前端显示「目标文件不存在:xxx」,不弹错误对话框。

---

## 3. Asset 协议授权

### 3.1 机制

Tauri 的 `asset:` 协议需要:

1. `tauri.conf.json` 中 `app.security.assetProtocol.enable = true`。
2. `assetProtocol.scope` 非空 **或** 运行期授权。

静态 scope 若写成宽松模式(`**/*`)等于开放整盘读取,违背 NFR-006。M0 实测后采用**先校验文档目录边界与链接，再逐文件运行期授权**，不开放整个目录:

```rust
// src/host/src/commands.rs —— resolve_assets 校验通过后
{
    use tauri::Manager;
    let scope = app.asset_protocol_scope();
    scope.allow_file(&validated_path)?;
}
```

已验证事实(`docs.rs`,commit 2026-10):`tauri::scope::fs::Scope` 存在 `allow_file` / `allow_directory` / `forbid_directory` / `forbid_file` / `is_allowed` 等方法,且 `Manager::asset_protocol_scope()` 需启用 **`protocol-asset` cargo feature**。

### 3.2 配置

```jsonc
// src/host/Cargo.toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
protocol-asset = ["tauri/protocol-asset"]
```

```jsonc
// src/host/tauri.conf.json
"app": {
  "security": {
    "assetProtocol": { "enable": true, "scope": [] }
  }
}
```

- `scope: []` 为空数组 → 启动时无任何路径可用,全部靠运行期授权。
- 关闭标签时:

```rust
scope.forbid_directory(&doc_dir, true)?;
```

但注意:**同一目录可能被多个文档共享**。因此不能在关闭单个文档时无条件 `forbid`。正确做法:

- 维护 `dir → refcount`;refcount 归零时才 `forbid_directory`。
- 或更简单:**会话内不撤销**,仅在应用退出时全部失效(asset scope 本来就不持久化)。选择后者,因为撤销逻辑的复杂度与收益不成正比,且进程退出即失效。

> 决策:不撤销,只授权。记录在 `docs/decisions/ADR-002` 的可选项里。

### 3.3 前端 URL 生成

```ts
// src/ui/src/core/documents/assetUrl.ts
import { convertFileSrc } from '@tauri-apps/api/core'

/** raw 为 markdown 中的原始 src;absPath 由 Rust resolve_asset 返回 */
export function toAssetUrl(absPath: string): string {
  return convertFileSrc(absPath)
}
```

- `convertFileSrc` 在 Windows 生成 `http://asset.localhost/<encoded>`。
- **不能在前端拼接路径**:前端拿不到真实绝对路径(只有 Rust 返回的)。流程必须是:

```text
worker 解析出 img src="./pic.png"(原文)
   → 主线程收集所有相对资源(遍历 img[src],不含 scheme)
   → 一次性批量 invoke resolve_assets{docId, raws:[...]}
   ← [{raw, verdict, absPath?, assetUrl?}]
   → 批量改 DOM: img.src = assetUrl 或 占位
```

**批量而非逐个**:50 张图逐个 await 会产生 50 次 IPC 往返;批量化后 1 次。

### 3.4 图片加载失败

- `img.onerror` → 替换为占位元素:

```html
<div class="md-image-error" data-raw="./pic.png">
  <span>图片无法加载</span><code>./pic.png</code>
</div>
```

- `onerror` 通过事件委托在容器上捕获(`capture: true`,因为 `error` 不冒泡)。
- 占位元素保留原始路径,便于用户排查。

---

## 4. CSP 与资源来源

```jsonc
"csp": {
  "default-src": "'self'",
  "script-src": "'self'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' asset: http://asset.localhost data: blob:",
  "font-src": "'self' data:",
  "connect-src": "ipc: http://ipc.localhost",
  "worker-src": "'self' blob:",
  "object-src": "'none'",
  "frame-src": "'none'",
  "base-uri": "'none'",
  "form-action": "'none'"
}
```

逐条理由:

| 指令 | 值 | 理由 |
|---|---|---|
| `script-src 'self'` | 无 `unsafe-inline`/`unsafe-eval` | 禁止任何内联脚本执行;Tauri 会自动为打包脚本加 nonce/hash |
| `style-src 'unsafe-inline'` | **必需** | KaTeX、Mermaid、Shiki 都会注入内联 `style` 属性与 `<style>` 元素 |
| `img-src` 不含 `https:` | 当前 M0 策略 | 应用层先拦截远程资源，CSP 同时拒绝网络图片；M0 不提供远程图片开关。下文远程图片开启行为是待实现设计，须另行评估 CSP 与资源边界 |
| `worker-src 'self' blob:` | 必需 | Worker 由 Vite 以 blob/独立文件方式加载 |
| `connect-src ipc:` | 必需 | Tauri IPC |
| `frame-src 'none'` | 严格 | 不使用 iframe(Mermaid `securityLevel` 不用 sandbox 模式) |

> **不要**设置 `dangerousDisableAssetCspModification`。让 Tauri 正常给资源加 nonce/hash。

---

## 5. 链接点击处理 → **见 `14-link-navigation.md`**

本文原本在此处给出链接点击的实现草案。为避免**同一策略两处维护导致漂移**,该内容已整体迁入独立规格文档 **`14-link-navigation.md`**(对应 FR-019):

| 内容 | 现在的位置 |
|---|---|
| 链接分类的唯一真源(Rust `resolve_link`) | `14` §2 |
| 前端事件委托(`click` + `auxclick`)与分发 | `14` §3 |
| 修饰键语义(普通 / `Ctrl` / 中键) | `14` §3.2 |
| 页内锚点跳转与失败提示 | `14` §3.3 |
| 跨文档 `目标.md#anchor` | `14` §3.4 |
| 本地附件交系统程序(`open_path_with_system`) | `14` §5.3 |
| 错误提示文案 | `14` §6 |
| 分段模式下的跨段锚点 | `14` §9 |

本文仍然负责且**不重复**的部分:

- **资源路径解析**(§2 `path_guard`、§3 asset 授权、§8 `resolve_assets` 批量契约)—— 决定"这个路径能不能读";
- **CSP 与资源来源**(§4)—— 决定"这个来源能不能加载"。

两者的分工:**04 管"能不能访问",14 管"点击后做什么"。**

---

## 6. 外部 URL 策略(url_policy)

```rust
// src/host/src/security/url_policy.rs
pub enum UrlAction { AllowExternal, Blocked(&'static str) }

pub fn classify(raw: &str) -> UrlAction {
    let s = raw.trim();
    if s.is_empty() { return Blocked("empty") }
    // 相对路径不在此处理
    match scheme_of(s) {
        Some("http") | Some("https") => AllowExternal,
        Some("mailto") => AllowExternal,
        Some("javascript") | Some("vbscript") => Blocked("script-scheme"),
        Some("data") => Blocked("data-scheme"),
        Some("file") => Blocked("file-scheme"),
        Some("asset") => Blocked("asset-scheme-in-md"),
        Some(_) => Blocked("unknown-scheme"),
        None => Blocked("no-scheme"),
    }
}
```

- `mailto` 允许但**必须**再校验无 CRLF 注入(防 header injection):拒绝包含 `\r` `\n`。
- 打开外部链接调用 `tauri-plugin-opener` 的 `open_url`,并在 capability 中仅允许 `http/https/mailto`。
- 前端的 `openUrl` 命令在 Rust 侧**再次**执行 `classify`,不信任前端传入(纵深防御)。

---

## 7. 远程资源策略

| 资源 | 默认 | 开关 |
|---|---|---|
| 远程图片 `![](https://…)` | **不加载** | 设置 `allowRemoteImages`(默认 false) |
| 远程链接(点击) | 允许 | 无 |
| 远程 CSS/字体 | 禁止(无 `@import`、无外链字体) | 不做 |

默认不加载远程图片的理由:隐私(NFR-006)、离线优先(NFR-007)、避免违反用户预期的网络请求。

关闭时:

```html
<div class="md-image-blocked" data-raw="https://...">
  <span>已阻止远程图片</span>
  <button data-action="load-remote">加载</button>   <!-- 单次放行 -->
</div>
```

状态栏显示「已阻止 3 个远程图片」,并提供「本次会话允许」的批量开关。

---

## 8. 批量解析契约

```rust
#[tauri::command]
async fn resolve_assets(
    doc_id: Uuid,
    raws: Vec<String>,
    registry: State<'_, DocumentRegistry>,
) -> Result<Vec<ResolvedAsset>, AppError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAsset {
    pub raw: String,
    pub verdict: String,       // "ok" | "outside" | "notFound" | "invalid"
    pub abs_path: Option<String>,
}
```

- 上限 500 个/次;超出则分批(前端负责分批)。
- 返回**不包含** `assetUrl`,由前端调用 `convertFileSrc` 生成,避免 Rust 侧硬编码协议格式。
- 去重:`raws` 先去重(同一图片在多处引用)。

---

## 9. 测试清单

| 用例 | 期望 |
|---|---|
| `![](./resources/sample.png)` | `ok`,图片显示 |
| `![](../secret.png)`(父目录外) | `outside`,占位 |
| `![](/etc/passwd)`(Linux)/ `![](C:\Windows\win.ini)` | `outside`(默认拒绝绝对路径) |
| 目录内 symlink 指向外部 | `outside` |
| `![](https://example.com/a.png)` 且 `allowRemoteImages=false` | 阻止占位 |
| `![](https://example.com/a.png)` 且开启 | 正常加载 |
| `![](javascript:alert(1))` | `invalid`,不生成 `<img>` |
| `![](./missing.png)` | `notFound`,占位 |
| `[link](./b.md)` | 打开新标签 |
| `[link](./b.md#sec)` | 打开并滚动到锚点 |
| `[x](javascript:alert(1))` | `blocked`,toast |
| `<script>alert(1)</script>` | 消毒后消失 |
| `<img src=x onerror=alert(1)>` | `onerror` 被剥离 |
| 100 张图片 | 1 次批量 IPC,渲染 < 200 ms |
