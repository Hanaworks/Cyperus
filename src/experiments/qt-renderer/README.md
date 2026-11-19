# Qt 受限对照（T14）

使用 Python 标准库及 PySide6 的 QtCore / QtGui / QtWidgets（`PySide6-Essentials` 已包含这些模块）。Markdown 直接交给 `QTextDocument.setMarkdown`，不需要 `markdown-it-py`。这是一套有意受限的 M0 对照，不是正式产品。

## 运行

2026-11-04 实时诊断：可用 Python 3.14.6 位于 `C:\Users\Mana\AppData\Local\Python\pythoncore-3.14-64\python.exe`，PATH 中的 `python` 指向 WindowsApps 别名。该可用解释器中当前未找到 PySide6；没有安装依赖。下面命令须使用已具备 PySide6 的解释器，不能把此说明当作安装已获授权。

在项目根目录运行（`<python>` 替换为解释器完整路径）：

```powershell
& '<python>' -B src/experiments/qt-renderer/main.py fixtures/extended.md
& '<python>' -B src/bench/qt-bench.py --fixture fixtures/generated/100kb.md --output benchmarks/qt-results.csv
& '<python>' -B src/bench/qt-bench.py --fixtures fixtures/generated --output benchmarks/qt-results.csv --repeat 3
& '<python>' -B src/bench/qt-bench.py --fixture fixtures/basic.md --mode offscreen --output benchmarks/qt-offscreen.local.csv
& '<python>' -B -m unittest discover -s src/experiments/qt-renderer -v
```

支持：打开 UTF-8 / UTF-8 BOM 文件（`Ctrl+O`）、原生正文与滚动、目录定位、正文搜索（`Ctrl+F` / `F3` / `Shift+F3`，到末尾环绕）、浅深配色、相对本地图片。浅深配色仅更改调色板，不重新解析。目录遍历 Qt 已解析的 `QTextBlock.headingLevel()`；不会扫描 Markdown 源码误收围栏或缩进代码中的 `#`。

不支持：Mermaid、KaTeX、GitHub Alerts、Shiki 语法高亮、脚注跳转及细粒度样式、文件监听、多标签、跨文件链接分流、生产级资源授权。外链/本地附件不会自动打开。图片按 Qt 本地资源规则加载，没有正式主线的目录授权边界。

## 基准口径

每个夹具、每个重复轮次启动独立子进程；默认显示 1100×800 原生窗口。`--mode offscreen` 只在子进程环境中启用 Qt offscreen 平台，CSV 明确标注，不能当作可见窗口结果。`--fixtures` 递归收集目录中所有 Markdown；`--fixture` 只测一个文件。`--timeout` 默认每文件 60 秒；超时由父进程终止本轮。`--output` 覆盖目标 CSV，每完成一轮立即刷新。

| 字段 | 定义 |
| --- | --- |
| `startup_ms` | 父进程发起创建子进程前 → QApplication 与未显示的阅读窗口构造完成。包含 Python / Qt 导入。 |
| `first_screen_ms` | 同一起点 → 文档 viewport 第一次 `paintEvent` 完成后的事件回调；不是显示器合成器提交时间。包含读取、Qt 原生解析/布局、目录和首次绘制。 |
| `read_ms` | 读取字节并按 UTF-8 BOM 可选解码。 |
| `render_ms` | Qt `setMarkdown` 加同步 `documentSize` 布局；不把该值标为可单独观测的 parse 时间。 |
| `toc_ms` | 遍历 Qt 文档标题并填充目录控件。 |
| `rss_bytes` | Windows `GetProcessMemoryInfo.WorkingSetSize`，首帧后 worker 单进程工作集。其他系统无法读取当前值时留空。 |
| `peak_rss_bytes` | Windows `PeakWorkingSetSize`；Linux / macOS 为 `ru_maxrss` 峰值，并在 notes 区分。 |
| `process_tree_rss_bytes` | 当前脚本没有采样进程树，始终留空。不可与 WebView2 进程树内存直接比较。 |
| `cpu_ms` | worker 从进程创建至首帧的累计用户态 + 内核态 CPU 时间；不包含父基准驱动进程。 |
| `cpu_mean_percent` | `cpu_ms / first_screen_ms × 100`，一个逻辑核心满载为 100%，可多于 100%。不是空闲 CPU。 |

`status=blocked` 表示运行依赖不可用，`timeout` 表示未在限时完成，`error` 表示其他错误。未测得的数值保留空字段，绝不写成 0。单轮冷进程测量不能说明性能稳定性；没有等价功能时不得据此声称 Qt 更优。功能表与当前记录见 `benchmarks/qt-compatibility.md`、`benchmarks/qt-results.csv`。

原生行为依据：[QTextDocument](https://doc.qt.io/qtforpython-6/PySide6/QtGui/QTextDocument.html)、[QTextBlockFormat](https://doc.qt.io/qtforpython-6/PySide6/QtGui/QTextBlockFormat.html)、[QTextBrowser](https://doc.qt.io/qtforpython-6/PySide6/QtWidgets/QTextBrowser.html)。
