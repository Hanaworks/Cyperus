"""Native renderer checks. Requires only PySide6-Essentials and the stdlib."""

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec("PySide6"), "PySide6 is not installed")
class QtRendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from PySide6.QtWidgets import QApplication
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        from main import MarkdownWindow
        self.window = MarkdownWindow()
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.window.close()
        self.window.deleteLater()
        self.app.processEvents()
        self.temporary.cleanup()

    def load(self, content, name="test.md"):
        path = self.root / name
        path.write_text(content, encoding="utf-8")
        self.window.open_file(path)
        self.app.processEvents()
        return path

    def test_native_outline_excludes_code_and_preserves_chinese_duplicates(self):
        self.load("# 中文\n\n```md\n# false\n```\n\n~~~\n## false too\n~~~\n\n    # indented false\n\n### 重复\n\n### 重复\n\n下划线标题\n---\n")
        headings = self.window.heading_rows()
        self.assertEqual([row[1] for row in headings], ["中文", "重复", "重复", "下划线标题"])
        self.assertEqual(len({row[2] for row in headings}), 4)

    def test_search_wraps_and_theme_does_not_reparse(self):
        self.load("# Title\n\nneedle one\n\nneedle two")
        self.window.search_field.setText("needle")
        self.assertTrue(self.window.find_next())
        first = self.window.browser.textCursor().selectionStart()
        self.assertTrue(self.window.find_next())
        second = self.window.browser.textCursor().selectionStart()
        self.assertGreater(second, first)
        self.assertTrue(self.window.find_next())
        self.assertEqual(self.window.browser.textCursor().selectionStart(), first)
        count = self.window.render_count
        text = self.window.browser.toPlainText()
        self.window.set_theme("dark")
        self.window.set_theme("light")
        self.assertEqual(self.window.render_count, count)
        self.assertEqual(self.window.browser.toPlainText(), text)

    def test_relative_image_unicode_path_and_toc_navigation(self):
        from PySide6.QtCore import QUrl
        from PySide6.QtGui import QColor, QImage, QTextDocument
        image_path = self.root / "中文 image.png"
        image = QImage(8, 8, QImage.Format.Format_RGB32)
        image.fill(QColor("red"))
        self.assertTrue(image.save(str(image_path)))
        self.load("# First\n\n![relative](中文%20image.png)\n\n" + "paragraph\n\n" * 100 + "## Last")
        resource = self.window.browser.document().resource(QTextDocument.ResourceType.ImageResource, QUrl("中文%20image.png"))
        self.assertIsNotNone(resource)
        self.assertFalse(resource.isNull())
        last = self.window.toc.topLevelItem(0).child(0)
        self.window.toc.setCurrentItem(last)
        self.assertEqual(self.window.browser.textCursor().position(), self.window.heading_rows()[-1][2])

    def test_first_paint_callback_requires_visible_content(self):
        self.load("# Frame\n\nbody")
        callbacks = []
        self.window.browser.after_next_paint(lambda: callbacks.append(True))
        self.window.show()
        for _ in range(20):
            self.app.processEvents()
            if callbacks:
                break
        self.assertEqual(callbacks, [True])


if __name__ == "__main__":
    unittest.main()
