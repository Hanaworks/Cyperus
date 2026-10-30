# 02 — 文档生命周期与多标签

> 覆盖 FR-001 / FR-007 / NFR-002 / NFR-003 / NFR-004。
> 代码落点:`src/host/src/documents/**`、`src/ui/src/stores/documents.ts`、`src/ui/src/core/documents/manager.ts`、`budget.ts`。

---

## 1. 术语

| 术语 | 定义 |
|---|---|
| **docId** | Rust 生成的 UUID v4,前端全流程唯一标识。与路径解耦,避免重命名导致状态错乱。 |
| **canonical path** | 规范化后的绝对路径(`dunce::canonicalize`,Windows 上消除 `\\?\` 前缀)。唯一性判定依据。 |
| **version** | 每次成功读取到有效内容并发生变化时单调递增的整数,由 Rust 持有。 |
| **generation** | 前端派生的渲染代次。提交解析任务时取当前 `version`,结果返回时比对,不一致则丢弃。 |
| **stale** | 非活动标签检测到文件已变更但尚未重新解析的状态。 |
| **anchor** | 滚动位置锚点:`{line, ratio}`,line 为块起始行,ratio 为该块内的可视偏移比例。 |

---

## 2. Rust 侧:DocumentRegistry

### 2.1 数据结构

```rust
// src/host/src/documents/registry.rs
pub struct DocEntry {
    pub id: Uuid,
    pub path: PathBuf,          // canonical
    pub dir: PathBuf,           // canonical parent
    pub encoding: Encoding,     // 探测结果
    pub had_bom: bool,
    pub version: u64,
    pub size: u64,
    pub mtime_ms: u64,
    pub watch_id: Option<WatchHandle>,
}

pub struct DocumentRegistry {
    inner: RwLock<HashMap<Uuid, DocEntry>>,
    by_path: RwLock<HashMap<PathBuf, Uuid>>,   // 去重:重复打开激活已有
}
```

**锁顺序约定(防死锁)**:永远先 `by_path` 后 `inner`;或统一用一把锁。推荐**单锁 + 两个索引字段**,因为全部操作都很短:

```rust
struct RegistryInner {
    by_id: HashMap<Uuid, DocEntry>,
    by_path: HashMap<PathBuf, Uuid>,
}
pub struct DocumentRegistry(RwLock<RegistryInner>);
```

### 2.2 生命周期方法

| 方法 | 行为 | 失败语义 |
|---|---|---|
| `open(path) -> DocMeta` | 规范化 → 查 `by_path` → 命中则返回已有 meta(不新建)→ 否则 stat → 探测编码 → 插入 → 启动 watcher → 授权 asset 目录 | `E_FILE_NOT_FOUND` / `E_PATH_FORBIDDEN` / `E_ENCODING` / `E_WATCH_FAILED` |
| `read(id) -> Vec<u8>` | 拿 path(释放锁)→ 阻塞池读字节 → 校验 size 与 mtime → 若变化则 `version += 1` 并返回新 meta | `E_DOC_UNKNOWN` / `E_FILE_ACCESS` |
| `close(id)` | 停 watcher → 移除索引 → 撤销 asset 授权 | 幂等,未知 id 返回 Ok |
| `bump_version(id, stat) -> Option<u64>` | watcher 调用;仅当 `mtime` 或 `size` 变化才递增 | 未知 id 返回 None |

### 2.3 版本判定细节

```rust
fn stat_signature(md: &Metadata) -> (u64, u64) {
    let mtime = md.modified().ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    (mtime, md.len())
}
```

- **不读内容做哈希**:50 MB 文件每次保存都哈希会显著拖慢刷新。
- `(mtime, size)` 相同但内容真变了的情况:极罕见(同毫秒同大小),可接受;若 M0 实测出现问题,再对 < 2 MB 文件追加内容哈希。
- 版本递增必须在**成功读取之后**还是**stat 之后**?选择:**stat 之后、read 之前递增**,但 read 失败时回滚。理由:前端需要立刻知道"有更新",若等 read 完成才通知,活动标签会白等一个 IO 往返。

### 2.4 编码探测

```rust
// src/host/src/documents/encoding.rs
pub enum Encoding { Utf8, Utf8Bom, Utf16Le, Utf16Be, Gb18030, Big5, ShiftJis, Latin1 }

pub fn detect(bytes: &[u8]) -> (Encoding, bool /*had_bom*/) {
    // 1. BOM 优先
    // 2. chardetng 扫描前 64 KiB
    // 3. 兜底:合法 UTF-8 → Utf8;否则 GB18030
}
```

规则:

1. `EF BB BF` → UTF-8 BOM;`FF FE` → UTF-16LE;`FE FF` → UTF-16BE。
2. `chardetng::EncodingDetector::new()` + `feed(前 64 KiB, true)` → `guess(None, true)`。
3. 若 guess 为 `windows-1252` 且文本中 CJK 比例 > 20% → 改判 `GB18030`(chardetng 对中文短文本常误判为 latin1)。
4. 解码用 `encoding_rs`;**UTF-8 快速路径**用 `std::str::from_utf8`,避免 encoding_rs 开销。
5. 返回给前端的是**原始字节**,解码在 JS 侧 `TextDecoder(encoding)` 完成 —— 这样 Rust 不需要分配第二份 `String`(50 MB 场景省一半内存)。
   - 例外:UTF-16 与 GB18030,Bun/WebKit 的 `TextDecoder` 支持需实测;若不支持,则在 Rust 侧解码为 UTF-8 字节返回。

### 2.5 大小限制

| 阈值 | 行为 |
|---|---|
| > 200 MB | 拒绝打开,提示「文件过大,超出阅读器支持范围」 |
| > 64 MB | 允许打开,但强制启用分段模式并弹一次提示 |
| 其他 | 正常 |

阈值为**初始值**,M0 实测后写入 ADR-003。

---

## 3. 前端:文档状态

### 3.1 Pinia Store

```ts
// src/ui/src/stores/documents.ts
export interface DocTab {
  docId: string
  path: string
  name: string
  version: number
  stale: boolean

  // 内容缓存(可被预算逐出)
  html?: string
  toc?: TocEntry[]
  blocks?: BlockEntry[]
  mermaidCount: number
  hasRawHtml: boolean

  // 阅读状态(不可逐出)
  anchor: { line: number; ratio: number } | null
  searchState: { query: string; index: number } | null

  // 呈现
  error: string | null
  loading: boolean
}

export const useDocuments = defineStore('documents', {
  state: () => ({
    tabs: [] as DocTab[],
    activeId: null as string | null,
    htmlBudgetBytes: 48 * 1024 * 1024,
  }),
})
```

### 3.2 不变量(invariants)

1. `tabs` 中 `path` 唯一(按 canonical path 去重)。
2. `activeId` 为 null 或存在于 `tabs` 中。
3. `activeId` 对应标签必须 `loading === false`(切换时若 stale 则先重解析)。
4. `sum(html.length * 2)` ≤ `htmlBudgetBytes`(UTF-16,1 char = 2 bytes 估算)。

### 3.3 内存预算与逐出

```ts
// src/ui/src/core/documents/budget.ts
export function enforceBudget(tabs: DocTab[], activeId: string | null, budget: number) {
  let total = tabs.reduce((n, t) => n + (t.html?.length ?? 0) * 2, 0)
  if (total <= budget) return

  // 逐出顺序:非活动 → 按 lastAccessedAt 升序
  const candidates = tabs
    .filter(t => t.docId !== activeId && t.html)
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

  for (const tab of candidates) {
    if (total <= budget) break
    total -= (tab.html!.length) * 2
    tab.html = undefined          // 只丢 HTML
    tab.stale = true              // 保留 toc/blocks 以便恢复时先显示目录
  }
}
```

设计取舍:

- **只逐出 `html`**,保留 `toc`/`blocks`(体量小 1~2 个数量级),这样切回标签时能立刻渲染目录骨架。
- 不逐出 `path`/`anchor`/`searchState` —— 这些是用户可感知状态。
- 预算常量 48 MB 初始值,M0 实测后调整。
- 逐出后若该标签再次激活 → 走正常 `read → parse` 流程,从 `anchor` 恢复位置。

### 3.4 标签操作

| 操作 | 流程 |
|---|---|
| `openPath(path)` | `invoke open_document` → 若 docId 已在 tabs → 仅激活 → 否则 push 新 tab → `load(tab)` |
| `activate(id)` | 若 `stale` 或无 `html` → `load(tab)` → 否则直接 render |
| `close(id)` | `invoke close_document` → 移除 tab → 若关闭的是活动标签 → 激活相邻(优先右侧) |
| `closeOthers(id)` / `closeAll()` | 批量 `close`,一次 `nextTick` 内更新 |
| `reload(id)` | 跳过 stale 标记,强制 `read + parse` |
| `revealInExplorer(id)` | `invoke reveal_document` |

### 3.5 重复打开语义

需求 FR-007 要求「重复打开时尽量激活已有文档」:

- `open_document` 在 Rust 侧按 canonical path 查 `by_path` 命中 → 直接返回**同一个 docId**,前端看到 docId 已存在 → 只 `activate`,不新建。
- 这样即使两个窗口/两个入口同时打开同一路径,也只有一份 watcher 与一份版本号。
- 大小写:Windows 文件系统不区分大小写,但 `canonicalize` 已返回磁盘真实大小写,故天然归一。

---

## 4. 会话与持久化

### 4.1 持久化内容

存入 `tauri-plugin-store`(JSON,位于 app data 目录):

```jsonc
{
  "session": {
    "tabs": [
      { "path": "D:\\docs\\a.md", "anchor": { "line": 412, "ratio": 0.33 } }
    ],
    "activeIndex": 0
  },
  "recent": [
    { "path": "D:\\docs\\a.md", "name": "a.md", "openedAt": 1793000000 }
  ],
  "settings": { /* 见 05-themes.md */ }
}
```

- **不存内容**,只存路径与锚点。启动时逐条 `open_document`,文件不存在则静默跳过并在"最近"里置灰。
- 会话写入时机:窗口关闭前(`CloseRequested` 事件)、标签变化后 2 s 去抖、`visibilitychange`。
- 最近文件上限 20 条。

### 4.2 启动恢复策略

| 配置 | 行为 |
|---|---|
| `session.restoreOnStartup = "session"`(默认) | 恢复上次标签与锚点 |
| `"empty"` | 只开空窗口 |
| `"lastFile"` | 只恢复上次活动文件 |

若启动时有命令行参数(文件关联双击),**忽略会话恢复**,直接打开该文件。

---

## 5. 多标签的资源控制(NFR-002 / NFR-003 / NFR-004)

| 资源 | 活动标签 | 非活动标签 |
|---|---|---|
| 原始文本 | 保留(解析后立即释放,仅保留 `html`) | 释放 |
| DOM | 唯一一份 | 无 |
| HTML 字符串 | 保留 | 保留至预算上限,超出按 LRU 逐出 |
| AST/Tokens | 解析后释放 | 释放 |
| Mermaid SVG | 保留渲染结果,缓存键 `hash(code)+theme` | 释放(不缓存 SVG) |
| Shiki 高亮器 | Worker 单例,全局唯一 | 同左 |
| 图片 | 浏览器缓存 | 浏览器缓存 |
| 文件监听 | 有 | **有**(必须,否则切回时不知道已变更) |
| 定时器 | 仅搜索高亮去抖 | 无 |

**监听器必须保留**:这正是 FR-008 的要求;但监听回调在非活动标签上只做 `stale = true` + `version` 更新,不做解析。

**空闲零占用(NFR-004)*:无活动文档时不得有 `setInterval` 轮询;文件监听由 OS 事件驱动,空闲时 CPU 为 0。

---

## 6. 打开 100 个文件的退化行为

需求性能矩阵要求"同时打开 10 / 30 / 100 文件"。设计:

| 打开数 | 行为 |
|---|---|
| ≤ 10 | 全部保留 `html` |
| 11–30 | 预算按比例下调,最旧的非活动标签被逐出 |
| > 30 | 只保留最近 10 个标签的 `html`;其余一律 `stale`,切回时重解析 + 显示进度 |

**不因打开数量拒绝用户**,但要在状态栏显示「当前 87 个标签,内存受控(逐出 61 个)」。

`watcher` 数量线性增长是主要风险:100 个 `notify` watcher(且监听父目录)可能触发 OS 限制。M0 需实测:

- Windows:`ReadDirectoryChangesW` 每个 handle 一个线程,100 个 = 100 线程,可接受但需测量。
- 备选:同一目录的多个文档合并为一个 watcher(按 `dir` 分组)。若实测有压力,采用此优化并写入 ADR。

---

## 7. 状态机

```text
         ┌──────────┐
         │  idle    │
         └────┬─────┘
   openPath() │
         ┌────▼─────┐  read fail   ┌────────┐
         │ loading  ├─────────────►│ error  │
         └────┬─────┘              └───┬────┘
   bytes ready│                   retry│
         ┌────▼─────┐                   │
         │ parsing  │◄──────────────────┘
         └────┬─────┘
      result ok│  fail
         ┌────▼─────┐     ┌──────────┐
         │  ready   │     │ degraded │  (源码视图)
         └────┬─────┘     └──────────┘
   doc:changed│
         ┌────▼─────┐
         │  stale   │  (非活动) / reload (活动)
         └──────────┘
```

- 每次状态迁移必须携带 `version`;若迁移目标版本的 `version` 小于当前 `tab.version`,迁移被丢弃。
- `error` 状态下**保留上一次成功渲染的 `html`**,并在顶部显示黄色提示条。这是 FR-011 与 AC-09 的核心。

---

## 8. 待实测项

| 项 | 验证方式 |
|---|---|
| 100 个 watcher 的实际线程/句柄开销 | M0-04 打开 100 文件,采样进程树线程数 |
| `TextDecoder('gb18030')`/`'utf-16le'` 在 WebView2 156 的支持 | 任务 18 单测 + 运行期探测 |
| 48 MB HTML 预算在 10 MB 文档下的实际占用 | M0 性能测试记录 RSS |
| `dunce::canonicalize` 对 UNC 路径(网络共享)的行为 | 手工用例(若首版不支持 UNC,需明确提示) |
