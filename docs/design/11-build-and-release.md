# 11 — 构建、打包与发布

> 覆盖 NFR-011 / NFR-012 / FR-001 文件关联 / AC-11 / AC-12 / 需求文档 §5.7。
> 代码落点:`package.json`、`src/host/tauri.conf.json`、`src/ui/vite.config.ts`、`src/host/capabilities/default.json`。

---

## 1. 开发环境要求

| 项 | 版本 | 本机实测 |
|---|---|---|
| Windows | 10 1809+ / 11 | ✅ Windows 11 专业工作站版 |
| Node.js | `^20.19 \|\| >=22.12` | ✅ 24.15.0 |
| pnpm | 11.x | ✅ 11.15.0（PowerShell 使用 `pnpm.cmd`） |
| Rust / Cargo | ≥ 1.90 | ✅ 1.99.1，dev / release 与 22 项测试通过 |
| MSVC Build Tools | 2019+ 含 Windows SDK | ✅ 本轮宿主构建通过 |
| WebView2 Runtime | 任意现代版本 | ✅ 原生探针 156.0.4314.58 |
| git | 任意 | ✅ 2.54.0 |
| Python(仅 Qt 对照) | 3.11+ | 3.14.6；用户已跳过 T14，不安装 Qt |

### 1.1 Rust 安装(待用户授权后执行)

本机当前无需安装；下列为其他机器的准备参考，安装仍需单独授权。

```powershell
# 方案 A:winget(推荐,可复现)
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
  --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# 方案 B:rustup 官方安装器
# https://win.rustup.rs/x86_64

# 验证
rustc --version   # 期望 >= 1.90
cargo --version
```

> 安装完成后需**新开终端**,`PATH` 才生效。

---

## 2. 根 `package.json`(脚本约定)

```jsonc
{
  "name": "markdown-preview",
  "private": true,
  "type": "module",
  "scripts": {
    "ui:dev":        "pnpm --dir src/ui dev",
    "ui:build":      "pnpm --dir src/ui build",
    "ui:typecheck":  "pnpm --dir src/ui typecheck",
    "ui:test":       "pnpm --dir src/ui test",
    "app:dev":       "cmd /c \"pnpm tauri dev\"",
    "app:build":     "cmd /c \"pnpm tauri build\"",
    "bench":         "node src/bench/web-bench.mjs",
    "fixtures:gen":  "node src/bench/gen-fixtures.mjs",
    "lint":          "biome check --write .",
    "lint:ci":       "biome ci .",
    "e2e":           "playwright test"
  }
}
```

> Windows PowerShell 使用 `pnpm.cmd` 或 `cmd /c pnpm`，避开 `.ps1` shim，无需修改执行策略。实际可运行脚本以根 `package.json` 为准；基准当前直接执行 `node src/bench/web-bench.mjs`。

### 2.1 `src/ui/package.json`

```jsonc
{
  "name": "@md-preview/ui",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 1420 --strictPort",
    "build": "vue-tsc --noEmit && vite build",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run"
  }
}
```

**端口固定 1420 + `strictPort`**:与 `tauri.conf.json` 的 `devUrl` 保持一致;端口被占时立即失败而不是静默换端口(否则 Tauri 连错)。

---

## 3. `tauri.conf.json` 关键片段

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Markdown Preview",
  "identifier": "com.example.markdownpreview",
  "version": "0.1.0",
  "build": {
    "beforeDevCommand": {
      "script": "pnpm dev",
      "cwd": "../ui",
      "wait": false
    },
    "beforeBuildCommand": {
      "script": "pnpm build",
      "cwd": "../ui"
    },
    "devUrl": "http://localhost:1420",
    "frontendDist": "../ui/dist"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "label": "main",
        "title": "Markdown 预览",
        "width": 1100,
        "height": 800,
        "minWidth": 640,
        "minHeight": 480,
        "decorations": true,
        "dragDropEnabled": true
      }
    ],
    "security": {
      "csp": { /* 见 04/06 */ },
      "assetProtocol": { "enable": true, "scope": [] },
      "freezePrototype": false
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"],
    "fileAssociations": [
      {
        "ext": ["md", "markdown", "mdown", "mkd"],
        "name": "Markdown Document",
        "description": "Markdown 文档",
        "role": "Viewer",
        "mimeType": "text/markdown"
      }
    ],
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "languages": ["SimpChinese", "English"],
        "displayLanguageSelector": false
      }
    }
  }
}
```

要点:

- `frontendDist: "../ui/dist"` 相对**配置文件目录**(`src/host/`),已验证 Tauri 按此解析。
- `devUrl` 必须与 Vite 端口一致。
- `role: "Viewer"` 而非 `Editor`(产品是阅读器)。
- `identifier` 不得保留 `com.tauri.dev`(构建时会被拒绝)。
- `bundle.windows.nsis.webviewInstallMode` 默认 `downloadBootstrapper`(检测到已安装则跳过下载)。

### 3.1 WebView2 依赖处理(AC-11)

```jsonc
"bundle": {
  "windows": {
    "webviewInstallMode": {
      "type": "downloadBootstrapper",
      "silent": true
    },
    "minimumWebview2Version": "109.0.1518.0"
  }
}
```

- 安装器:缺失则静默下载引导器并安装。
- 启动器:若仍失败,由**原生**错误提示(见 `06-security.md` §9)。

---

## 4. Vite 配置要点

```ts
// src/ui/vite.config.ts
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',          // 避免 IPv6/IPv4 不匹配导致 Tauri 连不上
    watch: { ignored: ['**/src-tauri/**', '**/src/host/target/**'] },
  },
  worker: { format: 'es' },
  build: {
    target: 'chrome120',        // WebView2 156 对应 Chromium 版本
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // 大依赖显式分 chunk,保证首屏不加载
          mermaid: ['mermaid'],
          shiki: ['shiki', '@shikijs/markdown-it'],
          katex: ['katex', '@vscode/markdown-it-katex'],
        },
      },
    },
  },
  optimizeDeps: { exclude: ['mermaid'] },
})
```

- `build.target`:WebView2 156 ≈ Chromium 140+;取 `chrome120` 保守值。若需支持更老 WebView2,降低 target(代价是更多 polyfill)。
- `manualChunks`:保证主 bundle 不含 Mermaid/Shiki/KaTeX。
- **不要**配置 `base: './'`:Tauri 用 `tauri://localhost` 或 `http://tauri.localhost`,绝对路径 `/assets/...` 是正确行为。

---

## 5. 构建产物与体积预算

| 产物 | 目标 |
|---|---|
| NSIS 安装包 | < 12 MB |
| 应用目录(解包后) | < 35 MB |
| 主 JS bundle(gzip) | < 120 KB |
| Mermaid chunk(gzip) | < 800 KB(按需) |
| Shiki chunk + wasm(gzip) | < 1.2 MB(Worker 内,按需) |
| KaTeX chunk + 字体(gzip) | < 400 KB |
| Rust 可执行文件 | < 12 MB(release,`strip` + LTO) |

### 5.1 Cargo release profile

```toml
[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

> `panic = "abort"` 与 `06-security.md` 中的 `catch_unwind` 冲突!二选一:
> **决策:不使用 `panic = "abort"`**,保留 `unwind`,以便 command 边界捕获 panic 并返回 `E_INTERNAL`(窗口不假死)。代价是二进制大 ~1 MB。

---

## 6. 性能对比原型(M0,仅在需要时)

### 6.1 Web 原型

即 `src/ui` 本身(通过 `VITE_IPC_MOCK=1` 在浏览器中运行),无需单独工程。

### 6.2 Qt 原生对照(Qt / PySide6)

```bash
python -m venv src/experiments/qt-renderer/.venv
src\experiments\qt-renderer\.venv\Scripts\pip install PySide6 markdown-it-py
python src/bench/qt-bench.py --fixtures fixtures/
```

范围限定(遵循需求文档 §5.0「不开发第二套正式产品」):

- 只做:打开文件、QTextDocument 渲染 Markdown、显示、滚动、搜索、目录、浅/深配色、相对图片。
- **不实现**:Mermaid、KaTeX、Alerts、脚注细粒度样式。缺口**明确记录为「不支持」**,不得用于"性能更优"的结论。
- 输出:同一夹具下的首屏时间、内存、CPU、功能缺口表。

### 6.3 结论产物

`docs/decisions/ADR-001` 必须包含:

- 功能覆盖表(逐项:支持/部分/不支持)
- 性能数据(同机、同夹具、含进程树内存)
- 被弃方案与理由
- M1 需要补足的能力清单

---

## 7. 发布检查清单

### 7.1 代码与配置

- [ ] `identifier` 已改为正式反向域名,不是 `com.tauri.dev`
- [ ] CSP 已开启且无 `unsafe-eval`(除经论证的 `wasm-unsafe-eval`)
- [ ] capabilities 无 `fs:*`、`shell:*`、`http:*`
- [ ] Release 构建关闭 devtools(通过 `#[cfg(debug_assertions)]` 控制)
- [ ] `assetProtocol.scope` 仍为空数组,依赖运行期授权
- [ ] 日志级别 release = Info,不含文件内容
- [ ] 图标齐全(16/32/48/64/128/256/512 + ico + icns)

### 7.2 功能验收

- [ ] AC-01 双击打开
- [ ] AC-02 表格/任务/Alert/公式/Mermaid/代码
- [ ] AC-03 相对图片与 md 链接
- [ ] AC-04 外部保存自动刷新
- [ ] AC-05 连续保存最终一致
- [ ] AC-06 多文件切换关闭资源受控
- [ ] AC-07 双主题自由组合
- [ ] AC-08 大文件 UI 响应
- [ ] AC-09 删除文件/图片/错误 Mermaid 有反馈
- [ ] AC-10 静置无高 CPU
- [ ] AC-11 缺 WebView2 有明确指引
- [ ] AC-12(新增平台时)差异已记录
- [ ] **AC-13** 链接四类分流正确,外链不导航离开应用
- [ ] **AC-14** `Tab` 可遍历正文链接,焦点可见,`Enter` 可激活
- [ ] **AC-15** 同一 `.md` 链接重复点击不产生重复标签
- [ ] **AC-16** 20 标签可溢出访问,切换不重解析,各自恢复滚动位置
- [ ] **AC-17** 关闭活动/其他/全部、拖拽重排均正确且重启后保留
- [ ] **AC-18** 恢复最近关闭可逐个恢复并保持原顺序位置
- [ ] **AC-19** 静置时标签栏无持续 CPU 占用

### 7.3 安装验证

- [ ] 全新用户安装 → 双击 `.md` → 直接进阅读视图
- [ ] 已安装旧版 → 覆盖升级 → 文件关联不重复
- [ ] 卸载 → 文件关联清理、设置目录策略(保留/删除需明确)
- [ ] 非管理员账户安装(`currentUser` 模式)
- [ ] 中文路径 + 中文文件名
- [ ] 长路径(> 260 字符,需 `\\?\` 处理验证)

### 7.4 兼容性

- [ ] 无 WebView2 的纯净 Windows(虚拟机)
- [ ] 150% / 200% DPI
- [ ] 双显示器不同 DPI
- [ ] Windows 深色/浅色系统主题切换

---

## 8. 版本与变更管理

| 项 | 约定 |
|---|---|
| 版本号 | SemVer;`package.json` 与 `tauri.conf.json` 同步 |
| 变更记录 | `CHANGELOG.md`(M1 起) |
| 分支 | `main` 为发布基线;功能分支合并前必须 CI 全绿 |
| 提交 | 遵循 Conventional Commits |
| ADR | 任何推翻既有架构的改动必须先写 ADR 并更新相关 design 文档 |

---

## 9. 跨平台(M2 之后)

| 平台 | 额外工作 |
|---|---|
| Linux | 列出 WebKitGTK 4.1+ 依赖;`appindicator` 依赖;deb/rpm/AppImage 三选一先做 AppImage;测试 CJK 字体缺失时的回落 |
| macOS | 最低系统版本;签名与公证;`Viewer` role 的 `CFBundleTypeRole`;菜单栏(系统菜单必须存在) |

**不承诺**:首版仅 Windows。Linux/macOS 的支持范围在 M2 用 AC-12 的测试结果确定。

---

## 10. 待实测项

| 项 | 验证 |
|---|---|
| `beforeDevCommand.cwd: "../ui"` 是否按预期工作 | `tauri dev` 冒烟 |
| CLI 在 `src/host` 的自动发现 | 任务 9 |
| NSIS 安装包的 WebView2 引导行为 | 虚拟机测试 |
| 文件关联图标与显示名 | 安装后检查注册表与资源管理器 |
| `frontendDist` 相对路径解析 | 构建后运行 |
| Vite 8 与 `manifest` 的兼容性 | 冒烟 |
