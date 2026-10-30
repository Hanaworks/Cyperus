# 14 — 链接点击跳转

> 覆盖 **FR-019(P0)**、FR-006、UC-06、AC-03 / AC-13 / AC-14 / AC-15。
> 代码落点:`src/ui/src/reader/bindLinks.ts`、`src/ui/src/core/documents/linkResolver.ts`、`src/host/src/commands/links.rs`、`src/host/src/security/url_policy.rs`。
> 需求细则见需求文档 §3.4。资源解析(图片/附件路径校验)见 `04-assets-and-links.md`,本文专注**点击后的跳转行为与 UI 反馈**。

---

## 1. 问题

「正文里的链接能点」看似简单,但预览器常见四类失败:

| 失败 | 根因 |
|---|---|
| 点了没反应 | `preventDefault` 后没有实现跳转分支 |
| 跳出去回不来 | 外链在 WebView 内发生顶层导航,应用界面被替换 |
| 打开空白标签 | 目标不存在/无权限时仍创建了标签 |
| 执行了脚本 | 只在前端用字符串判断 scheme,未做白名单 |

本规格要求:**每一类链接都有确定行为,失败有可见反馈,应用界面永不流失。**

---

## 2. 链接分类(唯一真源在 Rust)

前端**不自行判断链接类型**。所有判断由 `resolve_link` 完成,前端只根据返回的 `kind` 分发。

```ts
// src/ui/src/core/ipc/contract.ts(已在 07 定义)
export type ResolvedLink =
  | { kind: 'anchor';   anchor: string }
  | { kind: 'localMd';  absPath: string; anchor?: string }
  | { kind: 'asset';    absPath: string }
  | { kind: 'external'; url: string }
  | { kind: 'blocked';  reason: string }
```

### 2.1 Rust 侧判定顺序

```rust
pub fn resolve_link(scope: &DocScope, href: &str) -> ResolvedLink {
    let s = href.trim();

    // 1. 空
    if s.is_empty() { return Blocked("empty"); }

    // 2. 页内锚点
    if let Some(anchor) = s.strip_prefix('#') {
        return Anchor { anchor: percent_decode(anchor) };
    }

    // 3. 有 scheme
    if let Some(scheme) = scheme_of(s) {
        return match scheme.to_ascii_lowercase().as_str() {
            "http" | "https" => External { url: s.to_string() },
            "mailto"          => External { url: s.to_string() },
            "javascript" | "vbscript" | "data" | "file" | "asset"
                              => Blocked("scheme"),
            _                 => Blocked("unknown-scheme"),
        };
    }

    // 4. 无 scheme:本地路径(可能带 #fragment)
    let (path_part, anchor) = split_fragment(s);

    // 5. 扩展名分流
    let ext = extension_lower(path_part);
    if matches!(ext.as_str(), "md" | "markdown" | "mdown" | "mkd") {
        return match path_guard::resolve_md_link(scope, path_part) {
            Allowed(p) => LocalMd { abs_path: p, anchor },
            NotFound   => Blocked("target-not-found"),
            OutsideScope => Blocked("outside-scope"),
            _          => Blocked("invalid-path"),
        };
    }

    // 6. 其他本地文件
    match path_guard::resolve_asset(scope, path_part) {
        Allowed(p) => Asset { abs_path: p },
        NotFound   => Blocked("target-not-found"),
        OutsideScope => Blocked("outside-scope"),
        _          => Blocked("invalid-path"),
    }
}
```

**判定要点**:

1. **`#` 优先于一切**:`#foo` 永远当锚点,不做文件查找。
2. **scheme 判定在路径判定之前**:`javascript:alert(1)` 不能被当成"扩展名是 `(1)` 的本地文件"。
3. **扩展名先小写再匹配**:`.MD` `.Markdown` 都识别。
4. **`target-not-found` 必须在返回前被检出**:不能先返回 `LocalMd` 再让前端调用 `open_document` 时才发现不存在 —— 那会创建空白标签。
5. **`file:` 一律拦截**,即便是本地路径。需要打开本地文件的场景应写相对路径(不带 scheme)。

### 2.2 为什么绝对路径链接默认被拒

`[x](C:\Windows\win.ini)` 或 `[x](/etc/passwd)`:
- 默认为 `Blocked("outside-scope")`;
- 设置 `allowAbsoluteAssetPaths: true` 后仅对**非可执行扩展名**放行,并写审计日志(详见 `04-assets-and-links.md` §2.4)。

---

## 3. 前端分发

```ts
// src/ui/src/reader/bindLinks.ts
import { bridge } from '@/core/ipc'

export function bindLinks(container: HTMLElement): () => void {
  const onClick = async (ev: MouseEvent) => {
    const a = (ev.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return

    // 1. 必须阻止默认行为:否则 WebView 可能发生顶层导航
    ev.preventDefault()
    ev.stopPropagation()

    const href = a.getAttribute('href') ?? ''
    const docId = activeDocId()
    if (!docId) return

    let res: ResolvedLink
    try {
      res = await bridge.resolveLink(docId, href)
    } catch (e) {
      toastError(`无法解析链接:${href}`)
      return
    }

    switch (res.kind) {
      case 'anchor':
        scrollToAnchor(res.anchor, { flash: true })
        break

      case 'localMd': {
        const activate = !ev.ctrlKey && !ev.metaKey && ev.button !== 1
        await tabs.openPath(res.absPath, { activate })
        if (activate && res.anchor) {
          await nextTick()
          pendingAnchor.set(res.absPath, res.anchor)
        }
        break
      }

      case 'asset':
        await bridge.openPathWithSystem(res.absPath)   // 见 §5.3
        break

      case 'external':
        await bridge.openUrl(res.url)
        break

      case 'blocked':
        toastWarn(blockedMessage(res.reason, href))
        break
    }
  }

  const onAuxClick = (ev: MouseEvent) => {
    if (ev.button !== 1) return
    const a = (ev.target as HTMLElement | null)?.closest?.('a[href]')
    if (!a) return
    ev.preventDefault()
    void onClick(ev)   // 中键复用同一逻辑,但按 §3.2 决定是否激活
  }

  container.addEventListener('click', onClick)
  container.addEventListener('auxclick', onAuxClick)
  return () => {
    container.removeEventListener('click', onClick)
    container.removeEventListener('auxclick', onAuxClick)
  }
}
```

### 3.1 事件委托的必要性

正文通过 `innerHTML` 替换,若逐链接 `addEventListener`:
- 每次刷新都要遍历数百个 `<a>`;
- 关闭标签时容易漏掉解绑 → 内存泄漏。

因此**只在整个阅读容器上绑定一次**。容器在应用生命周期内复用,不需重复绑定。

### 3.2 修饰键与激活语义

| 事件 | 本地 Markdown | 外部 |
|---|---|---|
| 左键单击 | 新标签并激活 | 系统浏览器 |
| `Ctrl`/`Cmd` + 左键 | 新标签,**不**激活 | 系统浏览器 |
| 中键(`auxclick` button 1) | 新标签,**不**激活 | 系统浏览器 |
| `Shift` + 左键 | 首版等同普通点击(与 Chrome 的"新窗口"语义留待 Phase 3) | 系统浏览器 |

**必须同时处理 `click` 与 `auxclick`**:`click` 只在主键触发,中键走 `auxclick`。只监听 `click` 会导致"中键没反应"。

### 3.3 锚点跳转

> **⚠️ 实测陷阱（T05，markdown-it@15.0.3）**
>
> markdown-it 会对 `href` 做 URL 规范化，**非 ASCII 字符被百分号编码**，而标题的
> `id` 属性保持原文。例如：
>
> ```text
> Markdown 源码：  [x](#3-本地-markdown-链接)
> 渲染后 href：    #3-%E6%9C%AC%E5%9C%B0-markdown-%E9%93%BE%E6%8E%A5
> 标题 id：        3-本地-markdown-链接          ← 未编码
> ```
>
> 因此**绝不能**拿 `href` 直接去 `querySelector('#...')`，否则所有中文锚点都会失效。
> 必须先 `decodeURIComponent` 再查找。这一点若不处理，中文文档的目录跳转会 100% 失效。

```ts
export function scrollToAnchor(rawAnchor: string, opts: { flash?: boolean } = {}) {
  const root = readerEl()

  // 1. 先解码：href 可能被 markdown-it 百分号编码
  let anchor = rawAnchor
  try {
    anchor = decodeURIComponent(rawAnchor)
  } catch {
    /* 非法百分号序列，保留原文继续尝试 */
  }

  // 2. 按 id 查找（CSS.escape 必须用：中文/emoji/特殊字符不转义会抛异常）
  let el = root.querySelector(`#${CSS.escape(anchor)}`)

  // 3. 降级：按 name 属性（旧式锚点 <a name="x">）
  if (!el) el = root.querySelector(`a[name="${CSS.escape(anchor)}"]`)

  // 4. 再降级：用原始未解码值（有些文档的 id 本身就是编码后的形式）
  if (!el && anchor !== rawAnchor) {
    el = root.querySelector(`#${CSS.escape(rawAnchor)}`)
  }

  if (!el) {
    toastWarn(`文档中不存在锚点 #${anchor}`)
    return
  }

  el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  if (opts.flash) flashElement(el)
}
```

- `CSS.escape` 必须使用：中文与特殊字符 id 不加转义会导致 `querySelector` 抛异常。
- 跳转后给目标加 `.md-anchor-flash`，1.2 s 后移除（视觉反馈，避免"点了不知道跳哪了"）。
- 平滑滚动期间暂停 TOC 的自动高亮（300 ms 抑制窗口），避免两侧高亮跳动。

### 3.3.1 同一问题影响 Rust 侧 `resolve_link`

`resolve_link` 收到的 `href` **已经是百分号编码形式**。因此 Rust 侧在判定
"是锚点还是文件" 之前必须先做一次 `percent_decode`：

```rust
// 关键：先解码再判断，否则：
//   "#%E4%B8%AD%E6%96%87"  会被当成合法锚点，但锚点名是编码串
//   "./%E4%B8%AD%E6%96%87.md" 会被当成不存在（实际文件是 中文.md）
let decoded = percent_encoding::percent_decode_str(s).decode_utf8_lossy();
```

具体见 §2.1 判定顺序的第 2 步与第 4 步（那里的 `percent_decode` 调用就是为此）。

### 3.4 跨文档锚点

`[x](./other.md#section)` 的处理顺序:

```text
1. resolve_link → { kind: 'localMd', absPath, anchor: 'section' }
2. openPath(absPath, { activate: true })
   → 若已打开:activate(该标签)
   → 若未打开:new tab → read → parse → render
3. await 该标签进入 'ready'
4. scrollToAnchor('section')
5. 消费后清除 pendingAnchor,避免刷新时重复跳转
```

`pendingAnchor` 用 `Map<canonicalPath, string>` 保存,在标签 `ready` 时消费。

### 3.5 链接悬停提示

```ts
container.addEventListener('mouseover', (ev) => {
  const a = (ev.target as HTMLElement)?.closest?.('a[href]')
  if (!a) return
  showStatusHint(describeHref(a.getAttribute('href')!))
})
```

状态栏右侧显示目标(本地路径显示相对路径,外链显示完整 URL),提升可发现性,满足 §3.4 第 5 条。

---

## 4. 链接的渲染要求

这些在渲染管线里保证(`01-render-pipeline.md` §4.4),此处列出与前端的契约:

| 要求 | 由谁保证 |
|---|---|
| 外链带 `rel="noopener noreferrer"` | markdown-it 规则 |
| 外链带 `data-md-external="1"`(用于样式) | markdown-it 规则 |
| 锚点链接保留原始 `#...` | 不修改 |
| 不允许 `target="_blank"` | 默认不生成;即便生成也被委托拦截 |

CSS(在 Markdown Theme 内):

```css
.md-doc a {
  color: var(--md-link);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.15em;
}
.md-doc a:hover { text-decoration-thickness: 2px; }
.md-doc a:focus-visible {
  outline: 2px solid var(--md-link);
  outline-offset: 2px;
  border-radius: 2px;
}
/* 外链:不依赖颜色,增加可区分线索 */
.md-doc a[data-md-external='1']::after {
  content: '↗';
  font-size: 0.8em;
  vertical-align: super;
  margin-inline-start: 0.1em;
  opacity: 0.7;
}
```

**不使用颜色作为唯一区分线索**(WCAG 1.4.1):下划线常驻,外链另有 `↗` 标记。

---

## 5. 外链与本地附件

### 5.1 外链

```rust
#[tauri::command]
async fn open_url(app: AppHandle, url: String) -> Result<(), AppError> {
    match url_policy::classify(&url) {
        UrlAction::AllowExternal => {
            tauri_plugin_opener::open_url(&app, &url, None::<&str>)
                .map_err(|e| AppError::Internal(e.to_string()))
        }
        UrlAction::Blocked(reason) => Err(AppError::UrlBlocked(reason.into())),
    }
}
```

- 前端与后端**都**执行 scheme 白名单(纵深防御)。
- capability 中 `opener:allow-open-url` 仅允许 `https://*`、`http://*`、`mailto:*`。
- `mailto` 额外拒绝 `\r` / `\n`(防 header 注入)。

### 5.2 `javascript:` 类链接的额外处理

DOMPurify 会剥离 `href="javascript:..."` 吗?**会**(其默认 URI 白名单不含 `javascript:`),但:

- 若 `hasRawHtml === false`(跳过 DOMPurify),则 `javascript:` 链接仍会进入 DOM;
- 因此 markdown-it 的 `validateLink` 必须拦截(默认已拦,且 `01` §8.1 显式覆写加强)。

两层都做,任一层失效另一层仍拦。

### 5.3 本地附件(非 Markdown)

需求未要求内嵌查看 PDF/图片。行为:

```ts
// Rust
#[tauri::command]
async fn open_path_with_system(path: String) -> Result<(), AppError> {
    // 必须再次经过 path_guard,不信任前端传入
    // 然后调用 tauri_plugin_opener::open_path
}
```

- 首版**不做内嵌 PDF/img 查看器**;点击交给系统默认程序。
- 若后续要做内嵌图片查看,走 `10-ui-and-navigation.md` §7 的 Lightbox(仅图片,不含 PDF)。

---

## 6. 错误提示文案

```ts
// src/ui/src/i18n/zh-CN.ts
export const linkBlockedReasons: Record<string, string> = {
  'empty':              '链接地址为空',
  'scheme':             '出于安全考虑,不允许打开该类型链接',
  'unknown-scheme':     '不支持的链接类型',
  'outside-scope':      '目标位于当前文档目录之外,已被阻止',
  'target-not-found':   '目标文件不存在',
  'invalid-path':       '目标路径无效',
}
```

**提示形态**:右下角 toast,4 s 自动消失,可手动关闭;同时状态栏短暂显示。不使用模态对话框(避免打断阅读)。

---

## 7. 测试

### 7.1 单元(Vitest)

| 用例 | 断言 |
|---|---|
| `describeHref` | 本地/外链/锚点的提示文本正确 |
| `scrollToAnchor` | 中文 id 可定位;不存在时调用 toast |
| `blockedMessage` | 6 种 reason 均有中文文案 |
| 修饰键判定 | `ctrlKey` / `metaKey` / `button === 1` 组合 |

### 7.2 Rust 单元

| 用例 | 期望 |
|---|---|
| `#section` | `Anchor { anchor: "section" }` |
| `#%E4%B8%AD%E6%96%87` | `Anchor { anchor: "中文" }` |
| `./a.md` | `LocalMd`(存在时) |
| `./a.md#x` | `LocalMd { anchor: Some("x") }` |
| `../outside.md` | `Blocked("outside-scope")` |
| `./A.MD` | `LocalMd`(大小写) |
| `./missing.md` | `Blocked("target-not-found")` |
| `https://example.com` | `External` |
| `mailto:a@b.c` | `External` |
| `javascript:alert(1)` | `Blocked("scheme")` |
| `data:text/html,<script>` | `Blocked("scheme")` |
| `file:///C:/x.md` | `Blocked("scheme")` |
| `vbscript:x` | `Blocked("scheme")` |
| `chrome://settings` | `Blocked("unknown-scheme")` |
| `./dir with space/a.md` | 正确解码并解析 |
| `./a.md?query=1` | 忽略 query 或按未找到处理(需定策略) |
| 超长(> 4096) | `Blocked("invalid-path")` |

> `?query` 策略:**忽略 query,仅用 path 部分解析**。Markdown 链接带 query 罕见,严格拒绝会让用户困惑。

### 7.3 E2E(Playwright)

| 编号 | 用例 | 断言 |
|---|---|---|
| E2E-31 | 点击 `#标题` | 滚动到目标;`.md-anchor-flash` 短暂出现 |
| E2E-32 | 点击 `#不存在` | toast 出现,滚动位置不变 |
| E2E-33 | 点击 `./b.md` | 新标签出现并激活,内容为 b.md |
| E2E-34 | 再次点击同一链接 | 标签数不变,激活 b.md |
| E2E-35 | `Ctrl`+点击 `./c.md` | 新标签但**未**激活(当前标签仍是原标签) |
| E2E-36 | 中键点击 `./c.md` | 同上 |
| E2E-37 | 点击 `./b.md#sec` | 新标签打开并滚动到 sec |
| E2E-38 | 点击 `https://example.com` | mock 记录 `openUrl` 一次;页面 URL 未变化 |
| E2E-39 | 点击 `javascript:alert(1)` | toast;`window.__pwned` 未定义;页面未导航 |
| E2E-40 | 点击 `./missing.md` | toast;标签数不变 |
| E2E-41 | 点击 `./pic.png`(本地图片) | mock 记录 `openPathWithSystem` |
| E2E-42 | `Tab` 遍历正文 | 每个链接可获得焦点;`Enter` 触发跳转 |
| E2E-43 | 悬停链接 | 状态栏出现目标提示 |

---

## 8. 待实测项

| 项 | 验证 |
|---|---|
| WebView2 中中键是否触发 `auxclick` | 手工 + E2E |
| `scrollIntoView({ behavior: 'smooth' })` 在长文档(10 MB 分段模式)的准确性 | 段内跳转 vs 跨段跳转(跨段需先渲染目标段) |
| `CSS.escape` 对 emoji / 组合字符 id 的行为 | 夹具覆盖 |
| 点击链接时 WebView 是否仍发生导航(若 `preventDefault` 失效) | E2E-38/39 断言 `page.url()` 不变 |
| `mailto:` 在无邮件客户端的机器上的表现 | 手工 |

---

## 9. 分段模式下的跨段锚点

大文件启用分段模式后(`08-performance.md` §4),目标锚点可能位于未渲染的段:

```text
1. scrollToAnchor 找不到元素
2. 在 SectionIndex 中查找 anchor 所属的 Section
3. 渲染该段 → 插入 DOM
4. 重新查询元素 → scrollIntoView
5. 仍找不到 → toast「文档中不存在锚点」
```

**必须处理的边界**:用户点击目录深处条目时,不能因为"该段未渲染"而报"锚点不存在"。这是分段模式最容易被忽略的回归点,需专门 E2E 用例。
