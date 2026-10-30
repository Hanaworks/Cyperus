# 07 — IPC 契约

> 覆盖 FR-001 / FR-006 / FR-007 / FR-008 / FR-011。
> 代码落点:`src/host/src/ipc/{dtos,events}.rs`、`src/host/src/commands/**`、`src/ui/src/core/ipc/{bridge,contract,tauriBridge,mockBridge}.ts`。

---

## 1. 设计原则

1. **唯一真源**:TypeScript 的 `contract.ts` 是定义;Rust 的 DTO 用 `serde` 快照测试与之对齐。
2. **命令少而粗**:不为每个字段开一个命令;一次交互一个命令。
3. **事件单向**:Rust → 前端只用 `emit`;前端 → Rust 只用 `invoke`。
4. **错误结构化**:永远返回 `{code, message, detail}`,不返回裸字符串。
5. **字节优先**:大内容用 `tauri::ipc::Response` 返回 `ArrayBuffer`,不走 JSON 字符串。

---

## 2. 命令清单

| 命令 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `open_document` | `{ path: string }` | `DocMeta` | 打开或激活;重复路径返回同一 docId |
| `read_document` | `{ docId: string }` | `ArrayBuffer` | 原始字节;`version` 变化时递增 |
| `read_document_meta` | `{ docId: string }` | `DocMeta` | 取当前版本号(不读内容) |
| `close_document` | `{ docId: string }` | `void` | 停 watcher、移除索引 |
| `resolve_assets` | `{ docId: string, raws: string[] }` | `ResolvedAsset[]` | 批量解析资源路径 |
| `resolve_link` | `{ docId: string, href: string }` | `ResolvedLink` | **链接分类(FR-019 唯一真源)** |
| `reveal_document` | `{ docId: string }` | `void` | 在资源管理器中显示 |
| `open_url` | `{ url: string }` | `void` | 校验 scheme 后用默认浏览器打开 |
| `open_path_with_system` | `{ docId: string, path: string }` | `void` | 本地附件交系统程序;**再次经 `path_guard`** |
| `get_startup_paths` | — | `string[]` | 启动时命令行传入的文件 |
| `get_env_info` | — | `EnvInfo` | 版本与 WebView 信息,用于诊断面板 |
| `get_settings_path` | — | `string` | 设置文件位置(诊断用) |

> `open_path_with_system` 的路径参数必须是**前端从 `resolve_link` 返回值中拿到的 `absPath`**,不得由前端拼接。Rust 侧仍会重新执行 `path_guard` 校验,不信任传参。
>
> FR-020(多标签)不新增 IPC 命令:标签是纯前端状态,打开/关闭复用 `open_document` / `close_document`,去重由 registry 的 `by_path` 索引保证。

---

## 3. DTO 定义

### 3.1 TypeScript(真源)

```ts
// src/ui/src/core/ipc/contract.ts

export interface DocMeta {
  docId: string
  path: string             // canonical 绝对路径
  dir: string
  name: string             // basename
  size: number
  mtimeMs: number
  encoding: string         // "utf-8" | "utf-8-bom" | "utf-16le" | "gb18030" | ...
  hadBom: boolean
  version: number
  tooLarge: boolean        // 超过分段阈值
}

export interface ResolvedAsset {
  raw: string
  verdict: 'ok' | 'outside' | 'notFound' | 'invalid'
  absPath?: string
}

export type ResolvedLink =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'localMd'; absPath: string; anchor?: string }
  | { kind: 'asset'; absPath: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked'; reason: string }

export interface EnvInfo {
  appVersion: string
  tauriVersion: string
  rustVersion: string
  os: string
  osVersion: string
  webviewVersion: string
  locale: string
}

export type ErrorCode =
  | 'E_FILE_NOT_FOUND'
  | 'E_FILE_ACCESS'
  | 'E_FILE_TOO_LARGE'
  | 'E_ENCODING'
  | 'E_PATH_FORBIDDEN'
  | 'E_DOC_UNKNOWN'
  | 'E_WATCH_FAILED'
  | 'E_ASSET_FORBIDDEN'
  | 'E_URL_BLOCKED'
  | 'E_INTERNAL'

export interface IpcError {
  code: ErrorCode
  message: string
  detail?: string
}
```

### 3.2 Rust(对齐)

```rust
// src/host/src/ipc/dtos.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    pub doc_id: String,
    pub path: String,
    pub dir: String,
    pub name: String,
    pub size: u64,
    pub mtime_ms: u64,
    pub encoding: String,
    pub had_bom: bool,
    pub version: u64,
    pub too_large: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAsset {
    pub raw: String,
    pub verdict: String,
    pub abs_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolvedLink {
    Anchor { anchor: String },
    LocalMd { abs_path: String, anchor: Option<String> },
    Asset { abs_path: String },
    External { url: String },
    Blocked { reason: String },
}
```

> ⚠️ `ResolvedLink` 使用 `#[serde(tag = "kind")]` 内部标签枚举,与 TS 的判别联合精确对应。`rename_all = "camelCase"` 同时作用于变体名(`anchor`/`localMd`/...)与字段名。

### 3.3 错误类型

```rust
// src/host/src/error.rs
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("file not found: {0}")] FileNotFound(String),
    #[error("file access denied: {0}")] FileAccess(String),
    #[error("file too large: {0} bytes")] FileTooLarge(u64),
    #[error("unsupported encoding")] Encoding,
    #[error("path forbidden: {0}")] PathForbidden(String),
    #[error("unknown document")] DocUnknown,
    #[error("watch failed: {0}")] WatchFailed(String),
    #[error("asset forbidden: {0}")] AssetForbidden(String),
    #[error("url blocked: {0}")] UrlBlocked(String),
    #[error("internal error: {0}")] Internal(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    code: &'static str,
    message: String,
    detail: Option<String>,
}

impl AppError {
    fn code(&self) -> &'static str { /* 映射到 E_* */ }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
            detail: match self { /* 可放可选细节 */ },
        }.serialize(s)
    }
}
```

前端把 `invoke` 的 reject 值直接断言为 `IpcError`(Tauri 会把 `Serialize` 的错误对象原样传过来)。

---

## 4. 事件定义

```rust
// src/host/src/ipc/events.rs
pub const DOC_CHANGED: &str = "doc:changed";
pub const DOC_GONE: &str = "doc:gone";
pub const APP_OPEN_FILES: &str = "app:open-files";
pub const APP_ERROR: &str = "app:error";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocChangedPayload {
    pub doc_id: String,
    pub version: u64,
    pub kind: String,     // "modify" | "remove"
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocGonePayload { pub doc_id: String, pub version: u64 }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilesPayload { pub paths: Vec<String> }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorPayload {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}
```

前端订阅(只在 `App.vue` 里注册一次):

```ts
// src/ui/src/core/ipc/events.ts
export async function bindEvents(h: EventHandlers) {
  const un1 = await listen<DocChangedPayload>(DOC_CHANGED, e => h.onDocChanged(e.payload))
  const un2 = await listen<DocGonePayload>(DOC_GONE, e => h.onDocGone(e.payload))
  const un3 = await listen<OpenFilesPayload>(APP_OPEN_FILES, e => h.onOpenFiles(e.payload))
  const un4 = await listen<AppErrorPayload>(APP_ERROR, e => h.onAppError(e.payload))
  return () => { un1(); un2(); un3(); un4() }
}
```

---

## 5. IPC 桥(前端唯一入口)

```ts
// src/ui/src/core/ipc/bridge.ts
export interface IpcBridge {
  openDocument(path: string): Promise<DocMeta>
  readDocument(docId: string): Promise<Uint8Array>
  readDocumentMeta(docId: string): Promise<DocMeta>
  closeDocument(docId: string): Promise<void>
  resolveAssets(docId: string, raws: string[]): Promise<ResolvedAsset[]>
  resolveLink(docId: string, href: string): Promise<ResolvedLink>
  revealDocument(docId: string): Promise<void>
  openUrl(url: string): Promise<void>
  openPathWithSystem(docId: string, absPath: string): Promise<void>
  getStartupPaths(): Promise<string[]>
  getEnvInfo(): Promise<EnvInfo>
}
```

两个实现:

| 实现 | 使用场景 |
|---|---|
| `tauriBridge` | 生产;包装 `invoke` |
| `mockBridge` | Vitest / Playwright / 纯浏览器预览 |

`mockBridge` 通过 `import.meta.glob('/../../fixtures/*.md', { as: 'raw' })` 或 Vite 的 `?raw` 提供内容,路径映射到虚拟 docId。**必须**具备:

- 模拟 `doc:changed`(测试用 `window.__mockEmit('doc:changed', payload)`)
- 模拟错误码(通过 `?mockError=E_FILE_ACCESS` 查询参数)
- 模拟删除文件

选择:

```ts
// src/ui/src/core/ipc/index.ts
export const bridge: IpcBridge =
  import.meta.env.VITE_IPC_MOCK === '1' ? mockBridge : tauriBridge
```

---

## 6. 大内容传输

### 6.1 首选:`tauri::ipc::Response`(ArrayBuffer)

```rust
#[tauri::command]
async fn read_document(
    doc_id: String,
    registry: State<'_, DocumentRegistry>,
) -> Result<tauri::ipc::Response, AppError> {
    let bytes = registry.read_bytes(&doc_id).await?;
    Ok(tauri::ipc::Response::new(bytes))
}
```

前端:

```ts
const buf = await invoke<ArrayBuffer>('read_document', { docId })
const bytes = new Uint8Array(buf)
```

**收益**:避免 `Vec<u8>` → JSON 数组(50 MB 会膨胀为 ~180 MB 文本并卡死)。这是 Tauri 官方推荐的大二进制传输方式。

**必须在 Phase 1 实测**:某些 Tauri 版本对 `Response` 的 `ArrayBuffer` 编解码需要特定前端调用形态。若不达标,退路:

```rust
// 退路:返回 base64 字符串(体积 +33%,但稳定)
Ok(BASE64.encode(bytes))
```
并在 `docs/decisions/ADR-005` 记录实测结论。

### 6.2 编码转换位置

| 编码 | 在哪解码 |
|---|---|
| UTF-8 / UTF-8 BOM | JS `TextDecoder('utf-8')` |
| UTF-16LE/BE | JS `TextDecoder('utf-16le'/'utf-16be')`(需实测 be 支持) |
| GB18030 / Big5 / Shift_JIS | 首选 JS `TextDecoder`;不支持则 Rust 侧 `encoding_rs` 转 UTF-8 后返回 |
| 未知 | Rust 侧转 UTF-8 + 标记 |

判定在 `open_document` 完成,存入 `DocMeta.encoding`;`read_document` 依据它决定是否在 Rust 侧转码。

---

## 7. 命令实现约束

```rust
#[tauri::command]
async fn open_document(
    app: tauri::AppHandle,
    path: String,
    registry: State<'_, DocumentRegistry>,
) -> Result<DocMeta, AppError> { … }
```

规则:

1. **全部 `async`**,文件 IO 不阻塞主线程。
2. **不在持有锁时 await**:先取快照 → 释放锁 → await → 重新加锁提交。
3. **入参 `snake_case` 还是 `camelCase`**:Tauri 默认把前端 `camelCase` 映射到 Rust `snake_case` 参数名;不要加 `rename_all` 到命令入参结构体以外的地方,避免混乱。
4. **命令粒度为一次完整交互**,不做 `set_x`/`get_x` 式碎片命令。
5. **所有命令在最外层 `catch_unwind`**,把 panic 转为 `E_INTERNAL`,避免窗口假死。

```rust
fn guard<T>(f: impl FnOnce() -> Result<T, AppError> + std::panic::UnwindSafe) -> Result<T, AppError> {
    match std::panic::catch_unwind(f) {
        Ok(r) => r,
        Err(_) => Err(AppError::Internal("panic in command".into())),
    }
}
```

---

## 8. 类型一致性保障

| 机制 | 说明 |
|---|---|
| Rust DTO 快照测试 | `src/host/tests/dto_snapshot.rs`:用 `serde_json::to_value` 序列化每个 DTO,与 `src/host/tests/snapshots/*.json` 比对 |
| TS 侧同一份 JSON | `src/ui/tests/unit/contract.spec.ts` 载入**同一份** `snapshots/*.json`,断言字段集与 JSON 完全一致 |
| 字段缺失检测 | 两边都用「精确字段集合」断言(`Object.keys` 排序比较),不是 `toMatchObject` |
| CI 顺序 | 先跑 Rust 快照生成/比对,再跑 TS 比对;任一失败即失败 |

这样任何一侧改了字段名或增减字段,CI 立刻红,不会出现「前端读到 undefined」的运行期 bug。

---

## 9. 命令时序容错

| 场景 | 行为 |
|---|---|
| `read_document` 时文档已被 `close` | `E_DOC_UNKNOWN`;前端静默丢弃(该标签已关闭) |
| `open_document` 同时被调用两次(同路径) | registry 保证幂等,两个调用返回同一 docId |
| `close_document` 未知 id | 返回 Ok(幂等) |
| `resolve_assets` 含 500+ 项 | 前端分批,每批 ≤ 500 |
| `open_url` 被恶意 scheme | `E_URL_BLOCKED` + 审计日志 |
| IPC 整体超时 | 前端 30 s 超时 → 显示「操作超时」,不永久挂起 |
