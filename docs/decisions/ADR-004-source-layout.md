# ADR-004 — 源码目录布局:`src/host` + `src/ui`

- **状态**:Proposed(待确认)
- **日期**:2026-10-29
- **决策者**:项目负责人
- **影响范围**:全部工程结构、构建脚本、Tauri 配置路径

---

## 背景

用户要求「所有源码的内容都放在 `src` 目录下」。

而 Tauri 的标准项目结构是:

```text
project/
├── src/          # 前端源码
└── src-tauri/    # Rust crate(根目录下,与 src 平级)
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/      # Rust 源码
        └── main.rs
```

两者存在两处真实冲突:

### 冲突 A — 位置

`src-tauri/` 是 `src/` 的**兄弟目录**,不在 `src/` 内。把 Rust crate 放进 `src/` 需要打破官方布局。

### 冲突 B — 命名(`src/src` 双层)

Cargo 硬性要求 crate 根目录下存在 `src/`。因此若 crate 根放在 `src/host/`,Rust 源码路径必然是 `src/host/src/main.rs` —— 出现两层 `src`。这是 **Cargo 规范导致的,不可规避**。

---

## 候选方案

### 方案 1:`src/host`(Rust crate)+ `src/ui`(前端)✅ 推荐

```text
src/
├── host/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/main.rs        ← 双层 src
└── ui/
    ├── package.json
    ├── index.html
    └── src/main.ts        ← 双层 src
```

**Tauri CLI 能否找到 `src/host`?** 已验证(tairu 源码 `crates/tauri-cli/src/helpers/app_paths.rs`):

```rust
pub fn resolve_tauri_dir() -> Option<PathBuf> {
  let src_dir = env_tauri_app_path().or_else(|| current_dir().ok())?;

  // 1. 先查 cwd 与 cwd/src-tauri
  for standard_tauri_path in [src_dir.clone(), src_dir.join("src-tauri")] {
    if /* tauri.conf.json | .json5 | Tauri.toml 存在 */ {
      return Some(standard_tauri_path);
    }
  }

  // 2. 再在 cwd 下递归查找,默认最大深度 3(TAURI_CLI_CONFIG_DEPTH 可调)
  lookup(&src_dir, |path| { /* 是否有 tauri 配置文件 */ })
}
```

`src/host` 的深度为 **2 < 3**,第 2 步可命中。

兜底手段:`TAURI_APP_PATH=src/host`(CLI 源码中的 `ENV_TAURI_APP_PATH`)。

| 优点 | 缺点 |
|---|---|
| 满足「所有源码在 src 下」 | 路径出现双层 `src` |
| 前端/Rust 平级,结构对称 | 与社区教程/文档对不上 |
| 后续可加 `src/bench`、`src/experiments` 保持统一 | 依赖 CLI 的递归查找行为(可被兜底环境变量覆盖) |

### 方案 2:`src/`(前端)+ `src-tauri/`(Rust,根目录下)

| 优点 | 缺点 |
|---|---|
| 零风险,完全标准 | Rust 不在 `src` 内,**违反用户要求** |
| 文档/教程完全对得上 | 目录结构不对称 |

### 方案 3:`src/app/host` + `src/app/ui`

- 深度为 3,**正好处于 CLI 递归查找的上限边缘**。
- 必须始终靠 `TAURI_APP_PATH` 显式指路,稳定性最低。
- 相对路径更深(`frontendDist` 变 `../../ui/dist`),易错。

### 方案 4:`src/`(前端)+ `src/host`(Rust)

```text
src/            ← 前端源码(标准 Tauri 位置)
src/host/       ← Rust crate
```

- 前端完全符合 Tauri/Vite 默认。
- 但 `src/host/src/` 与前端 `src/components/` 混在一起,`src/` 语义混乱(既是前端源码根,又是多项目容器)。**不推荐**。

---

## 决策

**采用方案 1:`src/host` + `src/ui`。**

理由:

1. 唯一同时满足「所有源码在 `src` 下」与「Tauri CLI 可自动发现」的方案。
2. 双层 `src` 是 Cargo 规范的固有结果,不是设计缺陷;`src/host/src/` 的语义清晰(Rust crate 的一部分)。
3. 可扩展:基准脚本进 `src/bench`,实验原型进 `src/experiments`,与「源码全在 `src`」一致。
4. 风险可控:CLI 查找失败时可用 `TAURI_APP_PATH` 兜底,且此事实已由源码验证,非推测。

---

## 后果

### 必须遵守

| 项 | 值 |
|---|---|
| Rust crate 根 | `src/host/` |
| 前端包根 | `src/ui/` |
| `tauri.conf.json` 位置 | `src/host/tauri.conf.json` |
| `frontendDist` | `"../ui/dist"`(相对配置文件目录) |
| `beforeDevCommand.cwd` | `"../ui"` |
| pnpm workspace | `packages: ['src/ui']` |
| 开发命令 | 根目录执行 `pnpm tauri dev` |

### 需要验证(T09)

- [ ] `pnpm tauri dev` 在根目录能自动发现 `src/host`(查看 CLI 日志)
- [ ] 若不能,设 `TAURI_APP_PATH=src/host` 并确认可用
- [ ] `frontendDist` 相对路径在 `tauri build` 时正确解析

### 回滚成本

若后续发现该布局有无法绕过的问题,回滚到方案 2 只需:

1. `git mv src/host src-tauri`
2. `frontendDist` 从 `"../ui/dist"` 改为 `"../src/ui/dist"`
3. `beforeDevCommand.cwd` 从 `"../ui"` 改为 `"../src/ui"`
4. pnpm-workspace 的 `packages` 从 `['src/ui']` 改为 `['src/ui']`(不变)

即 **3 处配置 + 1 次目录移动**,约 15 分钟。风险可接受,故选择满足用户要求的方案。

---

## 相关文档

- `docs/design/00-architecture.md` §2(目录布局)
- `docs/design/11-build-and-release.md` §3(`tauri.conf.json` 片段)
- `docs/design/12-implementation-plan.md` T09(验证任务)

## 参考

- Tauri 官方项目结构文档:<https://v2.tauri.app/start/project-structure/>
- Tauri CLI 源码 `crates/tauri-cli/src/helpers/app_paths.rs`(`resolve_tauri_dir` / `ENV_TAURI_APP_PATH`)
