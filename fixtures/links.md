# 链接跳转测试样本（FR-019）

本文件用于验证所有链接类型的分流行为。逐条点击，行为见各条说明。

## 1. 页内锚点

- 跳到本文件章节：[跳到第 3 节](#3-本地-markdown-链接)
- 中文锚点：[跳到中文标题](#中文标题测试)
- 含空格锚点：[跳到第 1 节](#1-页内锚点)
- **不存在的锚点**（应提示「文档中不存在锚点」，不滚动）：[跳空](#不存在的锚点)

## 2. 特殊字符锚点

### 中文标题测试

这一节用于验证中文 slug。

#### emoji 与符号：🎯 目标

这一节用于验证 emoji 与全角符号在 id 中的处理。

## 3. 本地 Markdown 链接

- 存在的目标：[tabs/a.md](./tabs/a.md)
- 大写扩展名：[tabs/B.MD](./tabs/B.MD)
- 带锚点：[tabs/a.md#章节一](./tabs/a.md#章节一)
- 带空格路径：[带空格的文件.md](./带空格的文件.md)
- **不存在**（应提示目标不存在，且**不创建空白标签**）：[不存在](./不存在的文件.md)
- **父目录越界**（应被拒绝）：[越界](../../outside.md)

## 4. 本地附件（交系统默认程序）

- 图片：[sample.png](./resources/sample.png)
- 中文名图片：[中文图片.png](./resources/中文图片.png)
- **不存在**（应提示）：[缺失](./resources/missing.png)

## 5. 外部链接（交系统浏览器，应用界面不得被导航离开）

- HTTPS：[https://example.com](https://example.com)
- HTTP：[http://example.com](http://example.com)
- 带路径与查询：[https://example.com/path?q=1#frag](https://example.com/path?q=1#frag)
- 邮件：[mailto:test@example.com](mailto:test@example.com)
- 自动链接：<https://example.org>
- 裸链接文本（linkify）：https://example.net

## 6. 必须被拦截的链接

- `javascript:`：[恶意](javascript:alert(1))
- 大小写变体：[变体](JaVaScRiPt:alert(2))
- `vbscript:`：[vb](vbscript:msgbox(1))
- `data:` HTML：[data](data:text/html,<script>alert(3)</script>)
- `file:`：[file](file:///C:/Windows/win.ini)
- 未知 scheme：[chrome](chrome://settings)
- `asset:`：[asset](asset://localhost/x)

## 7. 特殊形态链接

图片包裹的链接：[![图片链接](./resources/sample.png)](https://example.com)

表格中的链接：

| 类型 | 链接 |
|---|---|
| 页内 | [第 1 节](#1-页内锚点) |
| 外链 | [example](https://example.com) |
| 本地 | [a.md](./tabs/a.md) |

列表中的链接：

1. [第 2 节](#2-特殊字符锚点)
2. [sample](./resources/sample.png)

引用中的链接：

> 引用里的[外链](https://example.com)与[锚点](#3-本地-markdown-链接)。

脚注引用[^fn]与回链。

## 8. 超长与边界

- 超长 URL（应仍能安全处理或提示无效）：
  [超长](https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)
- 空链接：[空](#)
- 只有井号：[井](#)
- 百分号编码锚点：[编码](#%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98%E6%B5%8B%E8%AF%95)
- 反斜杠路径：[反斜杠](./tabs\a.md)

## 9. 自引用

- 指向本文件：[links.md](./links.md)
- 指向本文件带锚点：[第 5 节](./links.md#5-外部链接交系统浏览器应用界面不得被导航离开)

## 10. 连续点击同一目标（FR-019 AC-15）

- [目标 A](./tabs/a.md)
- [目标 A 再来一次](./tabs/a.md)
- [目标 A 第三次](./tabs/a.md)

[^fn]: 脚注内容，用于验证脚注回链可点击。
