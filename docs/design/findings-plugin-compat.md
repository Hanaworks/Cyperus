# T05 — 插件 × markdown-it 15 兼容性实测报告

- **日期**：2026-10-29
- **任务**：`docs/design/12-implementation-plan.md` T05
- **环境**：Windows 11 / Node 24.15.0 / pnpm 11.15.0 / markdown-it 15.0.3
- **测试文件**：`src/ui/tests/unit/plugin-compat.spec.ts`、`src/ui/tests/unit/fixture-render.spec.ts`、`src/ui/tests/unit/markdown-core.spec.ts`
- **结论**：**全部插件在 markdown-it@15 下可用，无需回退到 14.3.3。**

---

## 1. 通过/失败矩阵

| 包 | 版本 | 结论 | 备注 |
|---|---|---|---|
| `markdown-it` | 15.0.3 | ✅ | 内置 TS 声明；不可安装 `@types/markdown-it` |
| `markdown-it-footnote` | 4.0.0 | ✅ | 需本地类型声明（见 §2.1） |
| `markdown-it-anchor` | 10.0.0 | ⚠️ 可用但**不采用** | 见 §2.2（有状态 slugger 缺陷） |
| `markdown-it-github-alerts` | 1.0.1 | ✅ | 只有 default 导出（见 §2.3） |
| `@vscode/markdown-it-katex` | 1.1.2 | ✅ | 必须锁定 katex@0.16.47（见 §2.4） |
| `@shikijs/markdown-it` | 4.5.0 | ⚠️ 不采用其插件 | 自接管 fence 渲染（见 §2.5） |
| `katex` | 0.16.47 | ✅ | 与插件依赖一致 |
| `shiki` | 4.5.0 | ✅ | Chromium/Node 均可用 |

---

## 2. 实测发现（每条都有测试锁定）

### 2.1 `markdown-it-footnote` 无 TypeScript 声明

**现象**：`TS7016: Could not find a declaration file for module 'markdown-it-footnote'`

**根因**：该包未附带 `.d.ts`；社区 `@types/markdown-it-footnote` 未随 markdown-it@15 更新，仍引用已移除的 `markdown-it/lib/*` 内部路径。

**方案**：本地最小声明 `src/ui/src/types/vendor.d.ts`，只声明 `PluginSimple`。

**锁定**：`plugin-compat.spec.ts` 的「markdown-it-footnote@4 + markdown-it 15」用例组。

---

### 2.2 `markdown-it-anchor` 的有状态 slugger 缺陷（最严重）

**现象**：同一文档渲染第二次时，所有标题 id 加 `-1` 后缀漂移。

**复现**：

```text
第一次渲染： id="重复标题", id="重复标题-1"
第二次渲染： id="重复标题-2", id="重复标题-3"   ← 漂移
```

**根因**：`markdown-it-anchor` 的 `slugify` 选项挂在 **MarkdownIt 实例**上，实例跨文档/跨渲染复用。若传入有状态 slugger（`github-slugger` 实例或返回闭包的工厂），计数永不重置。

**影响**：目录跳转 100% 失效、切换标签后锚点漂移、视觉回归无故失败。

**方案**：**不使用 `markdown-it-anchor`**，改为自研 `src/ui/src/core/markdown/anchors.ts`：

- `slugify()` 无状态纯函数
- 去重计数存在**单次 `parse()` 的 env** 里（`state.env.__heading_id_counts`），不在模块或实例级
- 用 `md.core.ruler.after('inline', 'md_heading_anchors', ...)` 注册

**验证**：`markdown-core.spec.ts` 的「标题锚点 id 稳定性」用例组，包含：
- 同一实例渲染同一文档 3 次，id 完全一致
- 真实夹具 `cjk-typography.md` 两次渲染 id 一致
- 不同文档之间无串扰（`相同标题` 在 docA 与 docB 中都是 `相同标题`，不是 `相同标题-1`）
- `computeHeadingIds` 与真实渲染结果一致

---

### 2.3 `markdown-it-github-alerts` 只有 default 导出

**现象**：`TypeError: Cannot read properties of undefined (reading 'apply')`

**根因**：README 与包内容不一致。按其 `dist/index.d.mts`，实际只有 `export { MarkdownItGitHubAlerts as default }`，**没有 `full` 命名导出**。

**方案**：`import githubAlerts from 'markdown-it-github-alerts'`（default 导入）。

**锁定**：`plugin-compat.spec.ts` 的「markdown-it-github-alerts@1」用例组，覆盖 5 种 Alert 全部生成 + 普通引用不误判。

---

### 2.4 katex 三版本共存

**现象**：`pnpm why katex` 显示 3 个版本 → TypeScript 报 `KatexOptions` 类型不兼容。

**根因**：

| 版本 | 来源 |
|---|---|
| 0.16.47 | `@vscode/markdown-it-katex@1.1.2` 的依赖 |
| 0.18.11 | `mermaid@12.2.0` 的依赖 |
| 0.19.1 | 我们显式安装（错误） |

**方案**：显式安装 `katex@0.16.47`，与插件依赖对齐。mermaid 内部的 0.18.11 是其私有依赖，不影响我们的类型。

**结果**：3 版 → 2 版，类型错误消失。

**设计文档需修正**：`00-architecture.md` 与 `11-build-and-release.md` 中的 `katex 0.19.1` 应改为 `0.16.47`。

---

### 2.5 Shiki 未知语言会中断整篇渲染

**现象**：`ShikiError: Language 'zzz-unknown-lang' not found` 且**整篇文档渲染失败**。

**根因**：
1. `@shikijs/markdown-it` 插件对未加载语言直接抛错；
2. 更严重：`highlighter.loadLanguage()` 对**不在 bundle 内的语言是同步抛错**，不是返回 rejected promise。所以 `void promise.catch(...)` 接不住。

**影响**：违反 FR-011（局部失败不得拖垮全文）。含未知语言的文档会整篇白屏。

**方案**：自接管 fence 渲染（`src/ui/src/core/markdown/plugins.ts`）：

```ts
if (!loaded.has(lang)) {
  ctx.unknownLangs.add(raw)
  if (!permanentlyUnknown.has(lang)) {
    try {
      // loadLanguage 同步抛错时会被就地捕获
      const r = ctx.highlighter.loadLanguage(lang)
      if (r && typeof r.catch === 'function') { void r.then(...).catch(...) }
      else { loaded.add(lang) }
    } catch {
      permanentlyUnknown.add(lang)   // 确认不存在，不再重试
    }
  }
  return ''   // 空串 → 走纯文本分支
}
```

**验证**：`fixture-render.spec.ts` 的「未知语言不中断整篇渲染」用例 —— `extended.md` 含 `zzz-unknown-lang` 块，断言 `md-code--plain` 存在**且**后续 `<table>` 仍在。

---

### 2.6 `commonmark` preset 不支持 GFM（设计文档修正）

**现象**：表格不渲染、删除线不渲染、linkify 无效。

**根因**：`markdown-it` 的 `commonmark` preset 规则集是**硬编码子集**，不含 table / strikethrough，且 `linkify` 选项在它下面不生效。

**实测对照**：

| preset | table | strikethrough | linkify | raw HTML |
|---|---|---|---|---|
| `commonmark` | ❌ | ❌ | ❌ | ✅ |
| `default` | ✅ | ✅ | ✅ | ✅ |
| `zero` | ❌ | ❌ | ❌ | ❌ |

**方案**：改用 `default` preset。

**设计文档已修正**：`01-render-pipeline.md` §2 已更新并附实测数据表。

---

### 2.7 中文锚点的百分号编码陷阱（影响 FR-019）

**现象**：`href="#3-本地-markdown-链接"` 被渲染为 `href="#3-%E6%9C%AC%E5%9C%B0-markdown-%E9%93%BE%E6%8E%A5"`，而标题 `id` 保持原文 `3-本地-markdown-链接`。

**根因**：markdown-it 对 `href` 做 URL 规范化（百分号编码非 ASCII），`id` 属性不经过该流程。

**影响**：若前端直接用 `querySelector('#' + href)`，**所有中文锚点跳转 100% 失效** —— 这对中文文档是致命的。

**方案**：跳转前必须 `decodeURIComponent`；Rust 侧 `resolve_link` 判定前也必须先 percent_decode。

**设计文档已修正**：`14-link-navigation.md` §3.3 与新增 §3.3.1。

**验证**：`fixture-render.spec.ts` 的「锚点 href 的编码形式可被 decodeURIComponent 还原为标题 id」用例。

---

### 2.8 slugify 的空白残留缺陷

**现象**：`slugify('🎯 目标')` 返回 `'-目标'`；`slugify('—— …… ））')` 返回 `'--'`。

**根因**：先转空白为 `-`，再移除非法字符 → emoji 被移除后留下前导连字符。

**方案**：调整顺序为「先移除非法字符（保留空白）→ 空白转 `-` → 合并连续 `-` → 去首尾 `-`」。

**验证**：`markdown-core.spec.ts` 的「slugify（无状态）」用例组（7 个用例）。

---

## 3. 建议的依赖锁定

```jsonc
// src/ui/package.json
{
  "dependencies": {
    "markdown-it": "15.0.3",
    "markdown-it-footnote": "4.0.0",
    "markdown-it-github-alerts": "1.0.1",
    "@vscode/markdown-it-katex": "1.1.2",
    "katex": "0.16.47",          // ← 必须与插件依赖一致，不能升到 0.19.x
    "shiki": "4.5.0",
    "@shikijs/markdown-it": "4.5.0",  // 仅用于类型；实际 fence 渲染自接管
    "mermaid": "12.2.0",
    "dompurify": "3.4.17",
    "vue": "3.5.44",
    "pinia": "4.1.0",
    "@tauri-apps/api": "2.12.4"
  }
}
```

**不安装**：`markdown-it-anchor`、`@types/markdown-it`、`github-slugger`（已自研替代）。

---

## 4. 对设计文档的修正清单

| 文档 | 章节 | 修正 |
|---|---|---|
| `01-render-pipeline.md` | §2 | `commonmark` → `default` preset，附实测对照表 |
| `01-render-pipeline.md` | §3.1 | 补各包正确导入形式表 |
| `01-render-pipeline.md` | §3.2 锚点 | 说明有状态 slugger 缺陷 + 改用自研方案 |
| `01-render-pipeline.md` | §3.2 高亮 | 补 `loadLanguage` 同步抛错的兜底代码 |
| `14-link-navigation.md` | §3.3 | 补百分号编码陷阱与 `decodeURIComponent` |
| `14-link-navigation.md` | §3.3.1 | 新增：Rust 侧也必须先 percent_decode |
| `00-architecture.md` | §1.2 | katex `0.19.1` → `0.16.47` |
| `11-build-and-release.md` | 技术栈 | 同上 |

---

## 5. 测试覆盖汇总

| 测试文件 | 用例数 | 覆盖 |
|---|---|---|
| `plugin-compat.spec.ts` | 26 | 逐插件精确断言 |
| `markdown-core.spec.ts` | 33 | slugify / dedupe / anchors 稳定性 / 链接校验 / preset 行为 |
| `fixture-render.spec.ts` | 12 | 真实夹具端到端 + 10 MB 性能下限 |
| **合计** | **71** | |

**全部通过**（2026-10-29）。

**性能基线**（10 MB 夹具，仅 markdown-it 解析 + 高亮 + KaTeX，无 DOM）：

```text
解析耗时：822 ~ 1113 ms
HTML 输出：7.2 MB（原始 10 MB）
```

这不是性能验收，仅用于防止灾难性回归。真实阈值在 M0（T15）实测后写入 ADR-003。
