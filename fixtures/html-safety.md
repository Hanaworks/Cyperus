# 安全测试样本

本文件用于验证 DOMPurify 消毒与 CSP 是否生效。

**验证方法**：打开本文件后，在控制台检查 `window.__pwned` 是否仍为 `undefined`，且页面未发生跳转。

## 1. 脚本注入

<script>window.__pwned = 'inline-script'</script>

<script src="https://example.com/evil.js"></script>

<img src="x" onerror="window.__pwned = 'img-onerror'">

<svg onload="window.__pwned = 'svg-onload'"></svg>

<body onload="window.__pwned = 'body-onload'">

<iframe src="javascript:window.__pwned='iframe-js'"></iframe>

<iframe src="https://example.com"></iframe>

<object data="https://example.com/evil.swf"></object>

<embed src="https://example.com/evil.swf">

## 2. 链接型注入

[点击我](javascript:window.__pwned='link-js')

[大写变体](JaVaScRiPt:window.__pwned='link-js-upper')

[HTML 实体绕过](&#106;avascript:window.__pwned='entity-bypass')

[a](data:text/html,<script>parent.__pwned='data-url'</script>)

## 3. SVG 内嵌脚本

```html
<svg xmlns="http://www.w3.org/2000/svg">
  <script>window.__pwned = 'svg-script'</script>
  <rect width="100" height="100" fill="red"/>
</svg>
```

内联版本：

<svg xmlns="http://www.w3.org/2000/svg"><script>window.__pwned = 'svg-script-inline'</script><rect width="50" height="50" fill="blue"/></svg>

## 4. 样式与表单注入

<style>body { background: red !important; }</style>

<form action="https://example.com/steal" method="post">
  <input name="csrf" value="x">
  <button type="submit">提交</button>
</form>

<link rel="stylesheet" href="https://example.com/evil.css">

<meta http-equiv="refresh" content="0;url=https://example.com">

<base href="https://example.com/">

## 5. 原型污染尝试

<img name="__proto__" src="x">
<img name="constructor" src="x">

<form><input name="__proto__.polluted" value="1"></form>

## 6. 应被保留的正常内容

以下是**合法**内容，消毒后必须仍然可见：

- 文本与 **粗体**、*斜体*、`代码`
- [正常外链](https://example.com)
- [正常锚点](#6-应被保留的正常内容)
- 表格：

  | 列 | 值 |
  |---|---|
  | a | 1 |

- 行内公式 $a^2+b^2=c^2$ 必须仍渲染为 KaTeX
- 块级公式必须仍渲染：

  $$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$

- 图片占位（不存在的图，应显示占位而非消失）

- `details`/`summary` 折叠：

  <details>
  <summary>展开</summary>

  折叠内容中的 **Markdown**。

  </details>

- `kbd` 标签：<kbd>Ctrl</kbd>
- 上标下标：<sup>1</sup> 与 <sub>2</sub>
- 删除线：<del>删除了</del>

## 7. 事件处理器全集（全部必须被剥离）

<p onclick="window.__pwned='p-click'">段落点击</p>
<div onmouseover="window.__pwned='div-over'">悬停</div>
<a href="#" onfocus="window.__pwned='a-focus'">聚焦</a>
<details ontoggle="window.__pwned='details-toggle'"><summary>h</summary>c</details>
<input onfocus="window.__pwned='input-focus'" autofocus>

## 8. 结果检查清单

| 检查项 | 期望 |
|---|---|
| `window.__pwned` | `undefined` |
| 页面 URL | 仍为本应用地址，未被重定向 |
| 页面背景 | 未变成红色 |
| 是否存在 `<script>` 元素 | 否 |
| 是否存在 `<iframe>` / `<object>` / `<embed>` | 否 |
| 是否存在 `<form>` | 否 |
| 是否存在 `<style>` 元素（来自本文件） | 否 |
| `on*` 属性 | 全部不存在 |
| `.katex` 元素数量 | > 0（公式仍可见） |
| `details` 元素 | 存在且可折叠 |
| `kbd` / `sup` / `sub` / `del` | 存在 |
