"""Restricted Qt Markdown baseline, not a second production application."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import os
from pathlib import Path
import sys
import time
from typing import Callable

from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtGui import QAction, QColor, QFont, QKeySequence, QPalette, QTextCursor, QTextDocument
from PySide6.QtWidgets import (
    QApplication, QComboBox, QFileDialog, QLabel, QLineEdit, QMainWindow,
    QMessageBox, QSplitter, QTextBrowser, QToolBar, QTreeWidget, QTreeWidgetItem,
)

from bench_support import OutlineEntry, build_outline


@dataclass(frozen=True)
class LoadMetrics:
    fixture_bytes: int
    read_ms: float
    render_ms: float
    toc_ms: float
    heading_count: int
    document_blocks: int

    def as_dict(self) -> dict:
        return asdict(self)


class MarkdownBrowser(QTextBrowser):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._paint_callback: Callable[[], None] | None = None
        self.setOpenLinks(False)
        self.setOpenExternalLinks(False)
        self.setReadOnly(True)

    def after_next_paint(self, callback: Callable[[], None]) -> None:
        self._paint_callback = callback
        self.viewport().update()

    def paintEvent(self, event):
        super().paintEvent(event)
        if self._paint_callback is not None:
            callback, self._paint_callback = self._paint_callback, None
            # Record only after Qt has painted this viewport; not a compositor fence.
            QTimer.singleShot(0, callback)


class MarkdownWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Qt Markdown 受限对照")
        self.resize(1100, 800)
        self.current_path: Path | None = None
        self.render_count = 0
        self.last_metrics: LoadMetrics | None = None

        self.browser = MarkdownBrowser(self)
        self.toc = QTreeWidget(self)
        self.toc.setHeaderLabel("目录")
        self.toc.setMinimumWidth(160)
        self.toc.currentItemChanged.connect(self._navigate_toc)
        split = QSplitter(Qt.Orientation.Horizontal, self)
        split.addWidget(self.toc)
        split.addWidget(self.browser)
        split.setSizes([250, 850])
        self.setCentralWidget(split)

        toolbar = QToolBar("阅读", self)
        toolbar.setMovable(False)
        self.addToolBar(toolbar)
        open_action = QAction("打开文件", self)
        open_action.setShortcut(QKeySequence.StandardKey.Open)
        open_action.triggered.connect(self._choose_file)
        toolbar.addAction(open_action)
        toolbar.addSeparator()
        self.search_field = QLineEdit(self)
        self.search_field.setPlaceholderText("搜索正文（Enter / Shift+F3）")
        self.search_field.setClearButtonEnabled(True)
        self.search_field.setMaximumWidth(320)
        self.search_field.returnPressed.connect(self.find_next)
        toolbar.addWidget(self.search_field)
        for title, shortcut, handler in [
            ("上一个", "Shift+F3", self.find_previous),
            ("下一个", "F3", self.find_next),
        ]:
            action = QAction(title, self)
            action.setShortcut(QKeySequence(shortcut))
            action.triggered.connect(handler)
            toolbar.addAction(action)
        focus_search = QAction("搜索", self)
        focus_search.setShortcut(QKeySequence.StandardKey.Find)
        focus_search.triggered.connect(self.search_field.setFocus)
        self.addAction(focus_search)
        toolbar.addSeparator()
        self.theme_field = QComboBox(self)
        self.theme_field.addItem("浅色", "light")
        self.theme_field.addItem("深色", "dark")
        self.theme_field.currentIndexChanged.connect(lambda _: self.set_theme(self.theme_field.currentData()))
        toolbar.addWidget(self.theme_field)
        self.statusBar().addPermanentWidget(QLabel("受限对照：不支持 Mermaid / KaTeX / Alerts", self))
        self.browser.anchorClicked.connect(self._follow_anchor)
        self.setStyleSheet("QTextBrowser, QTreeWidget { border: 0; }")
        self.set_theme("light")

    def open_file(self, path: str | Path) -> LoadMetrics:
        path = Path(path).resolve(strict=True)
        started = time.perf_counter()
        raw = path.read_bytes()
        text = raw.decode("utf-8-sig")
        read_ms = (time.perf_counter() - started) * 1000

        # A fresh document prevents image-resource cache reuse between directories.
        old_document = self.browser.document()
        document = QTextDocument(self.browser)
        document.setDefaultFont(QFont("Segoe UI", 11))
        document.setDocumentMargin(24)
        document.setBaseUrl(QUrl.fromLocalFile(str(path.parent) + os.sep))
        self.browser.setSearchPaths([str(path.parent)])
        old_document.deleteLater()
        self.browser.setDocument(document)
        started = time.perf_counter()
        document.setMarkdown(text, QTextDocument.MarkdownFeature.MarkdownDialectGitHub)
        # Force the native layout used by the visible QTextBrowser before timing ends.
        document.documentLayout().documentSize()
        render_ms = (time.perf_counter() - started) * 1000
        self.render_count += 1
        self.current_path = path

        started = time.perf_counter()
        rows = self.heading_rows()
        self.toc.clear()
        self._add_outline(build_outline(rows))
        self.toc.expandToDepth(1)
        toc_ms = (time.perf_counter() - started) * 1000
        self.browser.moveCursor(QTextCursor.MoveOperation.Start)
        self.browser.verticalScrollBar().setValue(0)
        self.setWindowTitle(f"{path.name} — Qt Markdown 受限对照")
        metrics = LoadMetrics(len(raw), read_ms, render_ms, toc_ms, len(rows), document.blockCount())
        self.last_metrics = metrics
        self.statusBar().showMessage(f"{path} · {len(raw):,} bytes · 原生渲染 {render_ms:.1f} ms")
        return metrics

    def heading_rows(self) -> list[tuple[int, str, int]]:
        """Use Qt's parsed heading metadata: fenced/indented code is not a TOC."""
        rows = []
        block = self.browser.document().begin()
        while block.isValid():
            level = block.blockFormat().headingLevel()
            if level:
                rows.append((level, block.text(), block.position()))
            block = block.next()
        return rows

    def _add_outline(self, entries: list[OutlineEntry], parent: QTreeWidgetItem | None = None) -> None:
        for entry in entries:
            item = QTreeWidgetItem([entry.text])
            item.setData(0, Qt.ItemDataRole.UserRole, entry.position)
            if parent is None:
                self.toc.addTopLevelItem(item)
            else:
                parent.addChild(item)
            self._add_outline(entry.children, item)

    def _navigate_toc(self, item, _previous) -> None:
        if item is None:
            return
        cursor = QTextCursor(self.browser.document())
        cursor.setPosition(item.data(0, Qt.ItemDataRole.UserRole))
        self.browser.setTextCursor(cursor)
        self.browser.ensureCursorVisible()

    def find_next(self) -> bool:
        return self._find(False)

    def find_previous(self) -> bool:
        return self._find(True)

    def _find(self, backwards: bool) -> bool:
        text = self.search_field.text()
        if not text:
            return False
        flags = QTextDocument.FindFlag.FindBackward if backwards else QTextDocument.FindFlag(0)
        found = self.browser.find(text, flags)
        if not found:
            cursor = self.browser.textCursor()
            cursor.movePosition(QTextCursor.MoveOperation.End if backwards else QTextCursor.MoveOperation.Start)
            self.browser.setTextCursor(cursor)
            found = self.browser.find(text, flags)
        self.statusBar().showMessage(f"搜索：{text}" if found else f"未找到：{text}")
        return found

    def set_theme(self, name: str) -> None:
        dark = name == "dark"
        palette = QPalette()
        colors = {
            QPalette.ColorRole.Window: "#202124" if dark else "#f3f4f6",
            QPalette.ColorRole.WindowText: "#e8eaed" if dark else "#202124",
            QPalette.ColorRole.Base: "#18191c" if dark else "#ffffff",
            QPalette.ColorRole.AlternateBase: "#292b30" if dark else "#f1f3f5",
            QPalette.ColorRole.Text: "#e8eaed" if dark else "#202124",
            QPalette.ColorRole.Button: "#303238" if dark else "#e7e9ed",
            QPalette.ColorRole.ButtonText: "#e8eaed" if dark else "#202124",
            QPalette.ColorRole.Highlight: "#375c88" if dark else "#b8d7ff",
            QPalette.ColorRole.HighlightedText: "#ffffff" if dark else "#101828",
            QPalette.ColorRole.Link: "#8ab4f8" if dark else "#175cd3",
            QPalette.ColorRole.LinkVisited: "#c8a6ff" if dark else "#6941c6",
        }
        for role, color in colors.items():
            palette.setColor(role, QColor(color))
        self.setPalette(palette)
        # Theme is palette-only: no setMarkdown, file IO, or replacement document.
        self.browser.viewport().update()

    def _choose_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "打开 Markdown", str(self.current_path.parent) if self.current_path else "", "Markdown (*.md *.markdown *.mdown *.mkd);;所有文件 (*)")
        if path:
            try:
                self.open_file(path)
            except (OSError, UnicodeError) as error:
                QMessageBox.warning(self, "无法打开文件", str(error))

    def _follow_anchor(self, url: QUrl) -> None:
        if url.isRelative() and not url.path() and url.hasFragment():
            self.browser.scrollToAnchor(url.fragment())
        else:
            self.statusBar().showMessage("此受限原型仅支持页内锚点；请使用打开文件。")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", nargs="?", type=Path)
    args = parser.parse_args()
    app = QApplication([sys.argv[0]])
    window = MarkdownWindow()
    if args.fixture is not None:
        try:
            window.open_file(args.fixture)
        except (OSError, UnicodeError) as error:
            parser.exit(1, f"Cannot open fixture: {error}\n")
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
