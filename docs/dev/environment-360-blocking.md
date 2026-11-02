# 环境问题：360 安全卫士拦截 Rust 构建

> 状态：**待处理**（阻塞 T09 的 S1/S3，不影响已提交的代码成果）
> 记录日期：2026-10-30

---

## 现象

```
error: failed to run custom build command for `mime_guess v2.0.5`
Caused by: could not execute process
  `D:\Project\Markdown\src\host\target\release\build\mime_guess-...\build-script-build`
  (never executed)
Caused by: 拒绝访问 (os error 5)
```

`crc32fast` 与 `mime_guess` 两次复现。

---

## 诊断过程（证据链）

| 步骤 | 观察 | 结论 |
|---|---|---|
| 1 | `cargo check` 失败，报 os error 5 | 不是编译错误 |
| 2 | 磁盘上 **exe 确实存在**（351 KB） | 编译成功，是**执行**被拦 |
| 3 | 手工执行该 exe → `拒绝访问` | 确认是执行权限问题 |
| 4 | **复制到 `%TEMP%` 后再执行 → 仍拒绝访问，且文件执行后被删除** | 不是路径限制，是**主动防御隔离** |
| 5 | 重跑 `cargo check`，`crc32fast` 这次通过 | 360 的启发式是**间歇性**的 |
| 6 | `AntiVirusProduct` 查到 `360安全卫士`，`productState=331776` | 来源确认 |
| 7 | 进程 `ZhuDongFangYu`（360 主动防御）存活，PID 4444 | 拦截主体确认 |
| 8 | Windows Defender 实时保护 = **关闭** | 排除 Defender |

**根因**：360 主动防御把 Rust 编译产生的临时 build script 判定为可疑程序，执行时隔离删除。

**为什么 Rust 特别容易踩**：cargo 会为每个带 `build.rs` 的 crate 编译一个临时可执行文件并立即执行。这些文件：
- 名字随机（`build_script_build-<hash>.exe`）
- 位于 `target/debug|release/build/` 这类非标准目录
- 没有数字签名
- 首次出现即执行

这正好命中启发式规则。

---

## 解决方案：在 360 添加信任目录

**只放行 Rust 构建产物，不影响其他防护。**

### 步骤

1. 打开 **360 安全卫士**
2. 右下角 → **木马查杀**
3. 右上角 → **信任区**（或「设置 → 信任与拦截 → 信任区」）
4. 点击 **添加目录**，依次添加以下 3 个目录（勾选「包含子目录」）：

```text
D:\Project\Markdown\src\host\target
C:\Users\Mana\.cargo
C:\Users\Mana\.rustup
```

| 目录 | 为什么要放行 |
|---|---|
| `src\host\target` | cargo 的编译输出与 build script 临时 exe 都在这里 |
| `C:\Users\Mana\.cargo` | registry 缓存 + cargo 自身二进制 |
| `C:\Users\Mana\.rustup` | rustup 管理的 toolchain（含 rustc / rustdoc） |

5. 如果 360 有「文件/目录白名单」与「主动防御白名单」两个入口，**两处都加**。

### 替代方案（不推荐，仅作记录）

- 临时退出/关闭 360 主动防御 → 跑完构建再开。缺点：每次改 Rust 代码都要重复；360 可能自动拉起。
- 换 `CARGO_TARGET_DIR` 到 `%TEMP%`。**已实测无效**：复制到 `%TEMP%` 后仍被拦。

---

## 验证方法

添加信任后，在**新开的终端**执行：

```powershell
cd D:\Project\Markdown
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
cmd /c "pnpm tauri build --no-bundle"
```

**通过判据**：退出码 0，且存在 `src\host\target\release\md-preview.exe`。

然后验证窗口：

```powershell
$p = Start-Process "D:\Project\Markdown\src\host\target\release\md-preview.exe" -PassThru
Start-Sleep -Seconds 5
$p.Refresh()
"进程存活 = $(-not $p.HasExited)"
"窗口标题 = $($p.MainWindowTitle)"
Stop-Process -Id $p.Id -Force
```

**通过判据**：
- `进程存活 = True`
- `窗口标题 = Markdown 预览`

---

## 另一个环境问题：PATH 未生效（暂不处理）

`rustup` 只把 `C:\Users\Mana\.cargo\bin` 写进**用户级** PATH，当前终端进程读不到，导致 `tauri info` 一开始报 `rustc: not installed`。

**临时绕过**（每条命令前执行）：

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

**注意**：`cmd /c` 启动的子进程会继承 PowerShell 的 `$env:Path`，所以在 PowerShell 里设置一次即可覆盖后续 `cmd /c "pnpm tauri ..."`。

**永久修复**（暂缓，待用户决定）：新增 `scripts/app-build.ps1` / `scripts/app-dev.ps1` 自动注入 PATH。

---

## 影响范围

| 受影响 | 不受影响 |
|---|---|
| `cargo build` / `tauri build` / `tauri dev`（需要编译 Rust） | `cargo check`（部分情况需要，间歇性） |
| 任何新增 Rust 依赖的首次编译 | 前端全部工作（typecheck / vitest / playwright / vite build） |
| CI 环境（若也用 360，不会；CI 通常无杀软） | 已提交的代码正确性 |

---

## 相关文档

- `docs/design/11-build-and-release.md` §1（环境要求）
- `docs/design/12-implementation-plan.md` T09
- `docs/decisions/ADR-004-source-layout.md`（已通过 S2 验证）
