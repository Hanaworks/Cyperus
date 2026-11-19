# Qt 受限对照：功能差异与运行状态

## 当前验证（2026-11-04）

- 可用 Python：3.14.6，`C:\Users\Mana\AppData\Local\Python\pythoncore-3.14-64\python.exe`。
- `-B` 实时探测 `importlib.util.find_spec('PySide6')` 返回 `None`。没有安装依赖；安装需另获用户确认。
- `qt-bench.py --fixture fixtures/basic.md --output benchmarks/qt-results.csv` 已运行：1 条 `blocked`，原因是 `No module named 'PySide6'`；首屏、渲染、RSS、CPU 全部为空，不能据此比较性能。
- 验证结果：标准库测试 12 项通过；Qt 集成测试 4 项因依赖缺失明确跳过。7 份 Python 源码语法检查通过，基准 CLI `--help` 可用。原生集成与可见窗口验收仍待运行。这是当前环境证据，不是对 Qt 可运行性的最终结论。

## 同夹具功能覆盖

下表的「支持」表示原型已提供对应代码路径；当前 Qt 依赖缺失，尚未通过本机原生运行验收。「部分」明确指出降级内容，不将原样显示当成完整渲染。

| 夹具 / 功能 | 覆盖 | 对照边界 |
| --- | --- | --- |
| 所有夹具：打开文件、正文、滚动 | 支持（待运行） | UTF-8 / UTF-8 BOM；整个文档在 GUI 线程解析布局，无 Worker 或分段。 |
| `basic.md`：标题、段落、强调、引用、列表、代码围栏 | 支持（待运行） | Qt 原生 Markdown；没有 Shiki 高亮。 |
| `basic.md`、`cjk-typography.md`：目录与定位 | 支持（待运行） | 使用已解析 Qt 标题和文本位置；重复标题独立定位，不保证与 Web slug 规则一致。 |
| 所有正文：搜索、浅深配色 | 支持（待运行） | 正文前后搜索环绕；统一调色板，不提供主线的 App / Markdown 独立主题组合。 |
| `basic.md`、`extended.md`：相对 PNG / 中文路径 | 支持（待运行） | 文件父目录为 base URL；不同文档使用新 QTextDocument 防止图片缓存串文档。 |
| `extended.md`：表格、任务列表、删除线 | 部分（待运行） | 使用 Qt MarkdownDialectGitHub 的覆盖；布局、复选框及嵌套样式不保证与 Web 相同。 |
| `extended.md`、`theme.md`：脚注 | 不支持 | 不实现脚注与回链及细粒度样式。 |
| `extended.md`、`theme.md`：GitHub Alerts | **不支持** | `[!NOTE]` 等保留普通引用/文本；没有五种 Alert 语义及样式。 |
| `extended.md`、`math-heavy.md`：KaTeX 行内 / 块公式与错误公式 | **不支持** | 数学源码保持文本，不排版、不实现专门错误占位。 |
| `extended.md`、`mermaid-100.md`：Mermaid 与错误图表 | **不支持** | 保留代码文本；没有图表渲染、懒加载或错误图表降级。 |
| `code-heavy.md`：多语言代码高亮 | 不支持 | 原生等宽代码；没有语法颜色或 Shiki 初始化成本。 |
| `theme.md`：三种正文主题及复杂富样式 | 部分（待运行） | 只有统一浅深调色板；没有 paper 或独立正文主题。 |
| `html-safety.md`：HTML、安全和目录边界 | 部分（待运行） | Qt 富文本不包含浏览器 JavaScript 引擎；没有主线 DOMPurify / path_guard 等价验收与资源授权。不能以不开脚本冒充安全契约已完成。 |
| `links.md`：外链 / 本地 md / 附件分流 | 不支持 | 仅尝试 Qt 页内锚点；其他链接显示限制提示，不导航或打开系统程序。 |
| `tabs/`：多文档标签、切换缓存、自动刷新 | 不支持 | 单窗口一次一个文档，无会话持久化或文件监听。 |
| `100kb.md` / `1mb.md` / `10mb.md` / `50mb.md` | 待测 | 文件基准接口已实现；依赖缺失时不能写入零耗时或宣称通过。 |

## 资源与结论限制

当前 `qt-results.csv` 没有有效性能样本。脚本后续可实测冷进程启动、viewport 首次绘制、读取、Qt 原生解析与布局、目录构建、worker CPU，以及 Windows worker RSS / 峰值。进程树 RSS 未实现，始终为空；同机 Web 对照若统计 WebView2 子进程，双方口径不同，不能据此排名。

Mermaid / KaTeX / Alerts 等功能缺口是本任务明确限定，不为补齐对照而另造一套正式渲染器。ADR 必须保留这些差异；性能数据到齐前不能作出资源优劣结论。运行方法及指标定义见 `src/experiments/qt-renderer/README.md`。
