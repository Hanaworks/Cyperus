# 03 — Live Reload(外部修改实时刷新)

> 覆盖 FR-008 / FR-011 / 需求文档 §3.3 全部 8 条细则 / NFR-004 / NFR-005。
> 当前代码落点:`src/host/src/watcher.rs`、`documents.rs`、`lib.rs`、`src/ui/src/core/documents/session.ts`、`src/ui/src/App.vue`；下文独立模块结构为后续拆分设计。

2026-11-07 实现状态：已接入父目录非递归监听、120 ms 去抖、单调版本、20 / 40 / 80 ms 有界读取重试和前端代次守卫。活动标签自动刷新，后台标签在激活时刷新；删除或读取失败保留旧正文，重建恢复，F5 可手动重试，窗口重新获得焦点时核对活动文件。读取前后比较元数据，避免把不稳定内容提交为新版本。发布程序已验证真实覆写 / 替换 / 删除 / 重建，见 [阅读流程完整性记录](../dev/reader-completion-plan.md)。

当前保留像素阅读位置和搜索状态；下文语义锚点、统一队列预算及连续保存压力验收仍未完成。后文未特别更新的参数与模块拆分属于目标规格，以本段当前实测和代码为准。

---

## 1. 为什么监听父目录而不是文件

编辑器的保存方式有三类:

| 方式 | 典型编辑器 | 文件系统表现 |
|---|---|---|
| **直接覆写** | 记事本、部分 IDE | `Write` 事件落在原 inode |
| **临时文件 + 原子替换** | VS Code、Sublime、JetBrains | 新建 `.tmp` → `rename` 覆盖目标 → 目标 inode 变化 |
| **写后重命名/移入** | 保存对话框、部分同步工具 | `Create` + `Rename` 组合 |

**监听文件本身在第二种方式下会失效**(inode 被替换,旧 handle 继续指向已删除的 inode)。因此:

- 必须 `watch` 文档所在的 **canonical 父目录**(非递归)。
- 收到事件后按路径匹配,而非按 inode。

---

## 2. 技术选型

```toml
# src/host/Cargo.toml
notify = "8.2.1"
notify-debouncer-full = "0.7.0"
```

- `notify` 提供跨平台事件源(Windows: `ReadDirectoryChangesW`;macOS: FSEvents;Linux: inotify)。
- `notify-debouncer-full` 提供**去抖 + rename 追踪 + 事件合并**,避免手写跨平台去抖逻辑。
- **不使用 `tauri-plugin-fs` 的 watch**:它的事件语义由插件定义,难以做版本号与重试编排,且会把文件访问权限扩大到前端。

> ⚠️ 版本匹配:`notify-debouncer-full 0.7.0` 依赖的 `notify` 主版本必须与 `notify 8.x` 一致。安装后须确认 `Cargo.lock` 中只有一个 `notify` 条目,否则事件类型不兼容编译失败。

---

## 3. 模块结构

```text
src/host/src/watcher/
├── mod.rs        WatcherService: 生命周期、按目录复用、向 Tauri emit
├── debounce.rs   去抖参数、待处理集合、代次
└── translate.rs  notify::Event → DocChange{kind} 的纯函数(可单测)
```

### 3.1 `translate.rs`(纯函数,重点单测对象)

```rust
pub enum ChangeKind { Modify, Remove }

pub struct RawEvent {
    pub paths: Vec<PathBuf>,
    pub kind: RawKind,   // Create/Modify/Remove/Rename/Other
}

/// 纯函数:把平台事件翻译为本应用关心的语义
pub fn translate(raw: &RawEvent, doc_path: &Path) -> Option<ChangeKind> {
    let hit = raw.paths.iter().find(|p| paths_equal(p, doc_path))?;
    let _ = hit;
    match raw.kind {
        RawKind::Modify | RawKind::Create => Some(ChangeKind::Modify),
        RawKind::Remove => Some(ChangeKind::Remove),
        RawKind::Rename  => Some(ChangeKind::Modify), // rename 覆盖 = 内容已变
        RawKind::Other   => None,
    }
}
```

要点:

- `paths_equal` 在 Windows 上大小写不敏感 + 统一分隔符;在 Unix 上字节比较。用 `#[cfg(windows)]` 分支,并有两条单测。
- 去抖后再做 stat。如果 stat 显示文件不存在且事件是 `Rename`,视为 `Remove`(rename 后旧名消失)。

### 3.2 `debounce.rs`

```rust
pub const DEBOUNCE_TIMEOUT_MS: u64 = 120;
pub const MAX_RETRIES: usize = 3;
pub const RETRY_DELAYS_MS: [u64; 3] = [50, 150, 300];
```

- 120 ms 是初始值:M0 用真实编辑器(VS Code / 记事本 / Notepad++)压测后调整。
- `notify-debouncer-full` 的 `new_debouncer(Duration::from_millis(120), None, handler)`。
- 合并语义:同一路径在窗口内多次事件 → 合并为一次;`Modify` 与 `Remove` 同现 → 取最后一个。
- **必须处理 tick 延迟**:去抖器回调可能在文件仍在写入时触发 → 用 retry 处理「读到不完整内容」。

### 3.3 `mod.rs` — 服务

```rust
pub struct WatcherService {
    debouncers: Mutex<HashMap<PathBuf /*dir*/, DirWatcher>>,
    app: AppHandle,
}

struct DirWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
    docs: HashSet<PathBuf>,
}
```

职责:

1. `ensure(dir)` — 若该目录已有 watcher 则复用并加入 `docs`;否则新建(见 §7 优化)。
2. 事件到达 → `translate` → 查 `registry` 得到 `docId` 与当前 signature。
3. `stat` 重试(见 §4)→ 成功则 `registry.bump_version()` → `emit("doc:changed")`。
4. `remove(dir, path)` — 文档关闭时从 `docs` 移除;`docs` 空则停掉该目录 watcher。

---

## 4. 刷新编排(端到端)

```text
[notify] Write / Rename
   ↓ 120ms 去抖
[translate] → ChangeKind::Modify
   ↓
[stat] 尝试 #1                            失败 → 50ms
   ↓ 成功(拿到 size/mtime)
[registry.bump_version] → version 1→2
   ↓
[emit doc:changed {docId, version:2, kind:"modify"}]
   ↓
[前端] 若 tab.version >= 2 → 忽略(重复事件)
[前端] 若正在解析旧版本 → 标记该 job 为过期
[前端] 活动标签 → read → parse → 渲染
[前端] 非活动标签 → tab.stale = true,tab.version = 2,不解析
```

### 4.1 读取阶段的写入竞争(需求 §3.3 第 3 条)

```rust
async fn read_with_retry(path: &Path) -> Result<Vec<u8>, AppError> {
    for (i, delay) in RETRY_DELAYS_MS.iter().enumerate() {
        match tokio::fs::read(path).await {
            Ok(bytes) if !bytes.is_empty() || is_really_empty(path) => {
                // 读到 0 字节但文件确实为空 → 合法
                return Ok(bytes);
            }
            Ok(_) | Err(_) if i + 1 < MAX_RETRIES => {
                tokio::time::sleep(Duration::from_millis(*delay)).await;
            }
            Ok(bytes) => return Ok(bytes),
            Err(e) => return Err(e.into()),
        }
    }
    unreachable!()
}
```

关键判据:**读到 0 字节不等于失败**。需要额外 `stat` 判断文件是否真的为空(编辑器截断后写入的中间态会短暂出现 0 字节)。

### 4.2 版本一致性(需求 §3.3 第 4 条)

前端 `jobQueue` 的守卫逻辑:

```ts
// src/ui/src/core/render/jobQueue.ts
submit(req: ParseRequest): void {
  const tab = this.tabs.get(req.docId)
  if (!tab || tab.version !== req.generation) return   // 提交时已过期
  this.pending.set(req.docId, req)                     // 同文档新任务替换旧任务
  this.worker.postMessage(req)
}

onResult(res: ParseResponse): void {
  const tab = this.tabs.get(res.docId)
  if (!tab) return
  if (tab.version !== res.generation) {
    this.metrics.staleResults++                        // 丢弃,计数用于诊断
    return
  }
  this.apply(res)
}
```

两条守卫缺一不可:
- **提交时守卫**:版本已变则不浪费解析。
- **返回时守卫**:解析期间版本又变了则丢弃结果。

### 4.3 位置保持(需求 §3.3 第 6 条)

更新内容前:

```ts
const anchor = captureAnchor(readerEl)   // {line, ratio}
```

更新后:

```ts
restoreAnchor(readerEl, anchor)          // 精确匹配 line;不存在则回落最近前置行
```

`captureAnchor` 逻辑:

1. 取视口顶部(或稍下 20%)位置的元素。
2. 向上找最近的 `[data-src-line]`。
3. `ratio = (scrollTop - blockTop) / blockHeight`,`clamp(0,1)`。

`restoreAnchor` 回落规则:

```ts
function findNearestBlock(blocks: BlockEntry[], line: number): BlockEntry {
  let best = blocks[0]
  for (const b of blocks) {
    if (b.line <= line) best = b
    else break
  }
  return best
}
```

即「内容变了,但你原来读到第 412 行,现在第 412 行不存在 → 落到 412 之前最近的块」,而非跳回顶部。

### 4.4 非活动标签延迟渲染(需求 §3.3 第 5 条)

- 只 `stale = true` + 更新 `version` + 释放 `html`(可通过预算机制自然发生)。
- 切回时:若 `stale` → 显示骨架屏 → `read → parse` → 渲染 → 恢复 anchor。
- **不做**「后台静默解析所有标签」——那会违反 NFR-002。

### 4.5 文件删除(需求 §3.3 第 7 条)

| 事件 | Rust 行为 | 前端行为 |
|---|---|---|
| `Remove` | `emit doc:gone{docId, version}`,**不删除 registry 条目** | 保留最后内容 + 顶部黄条「文件已被移除或移动」,提供「重新载入 / 关闭标签 / 定位文件夹」 |
| 删除后又重建同名文件 | `Create` → 视为 `Modify` → version 递增 | 自动恢复正常显示,黄条消失 |

> `doc:gone` 后若用户点「重新载入」且文件确实不存在 → 显示错误态并禁用该按钮。

### 4.6 未来编辑冲突(需求 §3.3 第 8 条)

首版只读,无冲突。但**现在就要预留字段**,避免 M3 加编辑时重构:

- `DocTab.isDirty?: boolean` — 首版恒为 `false`。
- `registry.bump_version` 增加参数 `origin: ChangeOrigin { External, Internal }`。
- 未来:若 `isDirty && origin === External` → 不自动刷新,提示「文件已被外部修改,是否重新载入?」。

---

## 5. 时序图(连续快速保存)

```text
t=0   编辑器保存 #1
t=10  notify Write
t=30  编辑器保存 #2
t=40  notify Write
t=50  编辑器保存 #3
t=60  notify Write/Rename
t=170 去抖窗口结束 → 单个合并事件
      stat → size/mtime 为 #3 的结果
      version 1 → 2(只 +1)
      emit doc:changed{version:2}
      前端只解析一次
```

若保存间隔 > 120 ms,则会产生多次刷新。此时靠**代次守卫**保证:即使 #1 的解析还在跑,#3 的结果也不会被 #1 覆盖。

---

## 6. 与 Tauri 事件机制的集成

```rust
// emit 位置:watcher 回调线程,不阻塞
app.emit("doc:changed", DocChangedPayload { doc_id, version, kind })?;
```

前端:

```ts
// src/ui/src/core/ipc/events.ts
await listen<DocChangedPayload>('doc:changed', ({ payload }) => {
  useDocuments().onExternalChange(payload)
})
await listen<DocGonePayload>('doc:gone', ({ payload }) => {
  useDocuments().onFileGone(payload)
})
```

- 事件监听在 `App.vue` 的 `onMounted` 注册一次,`onUnmounted` 注销。
- **事件 payload 用 snake_case 还是 camelCase**:统一用 `serde(rename_all = "camelCase")`,与前端习惯一致,并在 DTO 快照测试中锁定。

---

## 7. 优化:按目录复用 watcher

初始实现「每个文档一个目录 watcher」在 100 个文件时可能创建 100 个 OS handle 与线程。设计上直接采用**按目录分组**(不先做简单版再优化,因为改动面大):

```rust
// 每个 canonical dir 一个 Debouncer,内部维护该目录下的 doc 集合
struct DirWatcher {
    debouncer: Debouncer<RecommendedWatcher>,
    docs: HashSet<PathBuf>,
}
```

- 打开文档:`ensure(dir)` → 复用或新建 → `docs.insert(path)`。
- 关闭文档:`docs.remove(path)` → 若空则 `debouncer.stop()` 并从 map 移除。
- 事件到达:遍历 `docs` 匹配路径。

代价:同一目录多文件的 stat 是 O(n);100 文件同目录时每次保存会 stat 100 次。优化:先按事件路径精确匹配(通常 O(1)),仅当事件路径是「未知临时文件名」时才 fallback 到全部 stat。

**必须实测定夺**:M0-04 用 100 个文件(同目录 + 分散目录两种)测量 watcher 的线程数与空闲 CPU。

---

## 8. 错误与告警

| 情况 | 错误码 | 处理 |
|---|---|---|
| 目录 watch 失败(权限/句柄耗尽) | `E_WATCH_FAILED` | 该文档降级为「手动刷新」,状态栏常驻提示 |
| stat 连续 3 次失败且事件是 Modify | — | 记 warning,发出一次 `doc:changed` 让前端尝试读取 |
| 读文件权限被拒 | `E_FILE_ACCESS` | 保留旧内容 + 黄条「无法读取,可能被其他程序占用」 |
| 目录被移走 | `E_WATCH_FAILED` | 尝试重新 `ensure` 新的父目录 |

---

## 9. 待实测项

| 项 | 验证方式 | 失败退路 |
|---|---|---|
| `notify 8.2.1` 与 `notify-debouncer-full 0.7.0` 的依赖版本一致 | `cargo tree -d` 检查重复 | 降级 debouncer 或手写去抖 |
| VS Code / Notepad++ / JetBrains 三种保存模式的真实事件序列 | M0-04 实际编辑器操作 | 调整 `translate` 判定 |
| 120 ms 去抖对「连续快速保存」是否足够 | 脚本 200 次/秒写入 | 调至 200–300 ms |
| Windows 上 `Rename` 覆盖是否稳定产生 `Remove+Create` 而非 `Rename` | 集成测试 | 补充 `Create` 后 stat 兜底 |
| 100 个 watcher 的线程数与空闲 CPU | `src/bench/sample-tree.ps1` | 启用目录分组(已内建) |
