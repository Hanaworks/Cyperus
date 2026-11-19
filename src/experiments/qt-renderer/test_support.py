"""Standard-library checks; no Qt import or dependency installation."""

import csv
import io
from pathlib import Path
import tempfile
import unittest

from bench_support import CSV_FIELDS, build_outline, collect_fixtures, result_row, write_csv


class FixtureTests(unittest.TestCase):
    def test_directory_is_recursive_sorted_and_markdown_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "sub").mkdir()
            (root / "sub" / "中文.MD").write_text("# 中文", encoding="utf-8")
            (root / "a.markdown").write_text("# A", encoding="utf-8")
            (root / "image.png").write_bytes(b"png")
            expected = [root / "a.markdown", root / "sub" / "中文.MD"]
            self.assertEqual(collect_fixtures(fixtures=root), expected)

    def test_single_file_and_missing_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary) / "one.md"
            fixture.write_text("# A", encoding="utf-8")
            self.assertEqual(collect_fixtures(fixture=fixture), [fixture])
            with self.assertRaises(FileNotFoundError):
                collect_fixtures(fixture=fixture.with_name("missing.md"))
            with self.assertRaises(ValueError):
                collect_fixtures(fixtures=fixture.parent / "empty")

    def test_input_modes_are_exclusive(self):
        with self.assertRaises(ValueError):
            collect_fixtures()
        with self.assertRaises(ValueError):
            collect_fixtures(fixture=Path("one.md"), fixtures=Path("fixtures"))


class OutlineTests(unittest.TestCase):
    def test_heading_jumps_duplicates_and_chinese_keep_positions(self):
        # Inputs are QTextBlock heading metadata, never lines scanned from Markdown.
        tree = build_outline([(1, "中文", 0), (3, "重复", 12), (3, "重复", 24), (2, "后续", 36), (1, "最后", 48)])
        self.assertEqual([node.text for node in tree], ["中文", "最后"])
        self.assertEqual([node.position for node in tree[0].children], [12, 24, 36])
        self.assertEqual(tree[0].children[0].level, 3)

    def test_hierarchy_uses_nearest_shallower_heading(self):
        tree = build_outline([(2, "Top", 0), (6, "Deep", 10), (4, "Middle", 20), (5, "Child", 30)])
        self.assertEqual([node.text for node in tree[0].children], ["Deep", "Middle"])
        self.assertEqual(tree[0].children[1].children[0].text, "Child")

    def test_non_heading_blocks_are_ignored(self):
        tree = build_outline([(0, "# fenced code", 0), (1, "Real", 20), (0, "# indented code", 30)])
        self.assertEqual([node.text for node in tree], ["Real"])


class CsvTests(unittest.TestCase):
    def test_unmeasured_values_are_empty_and_notes_roundtrip(self):
        row = result_row(Path("missing.md"), run=1, mode="window", status="blocked", notes="PySide6 missing, not installed\nNo measurements")
        self.assertEqual(row["startup_ms"], "")
        self.assertEqual(row["first_screen_ms"], "")
        self.assertEqual(row["rss_bytes"], "")
        self.assertEqual(row["cpu_ms"], "")
        output = io.StringIO(newline="")
        write_csv(output, [row])
        loaded = list(csv.DictReader(io.StringIO(output.getvalue())))[0]
        self.assertEqual(loaded["notes"], row["notes"])
        self.assertEqual(list(loaded), CSV_FIELDS)


if __name__ == "__main__":
    unittest.main()
