"""Failure/timeout and measurement-scope checks without importing Qt."""

import importlib.util
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from process_metrics import memory_snapshot


BENCH_PATH = Path(__file__).resolve().parents[2] / "bench" / "qt-bench.py"
SPEC = importlib.util.spec_from_file_location("qt_bench", BENCH_PATH)
BENCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCH)


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temporary.name) / "test.md"
        self.fixture.write_text("# Test", encoding="utf-8")
        self.args = SimpleNamespace(mode="offscreen", timeout=1)

    def tearDown(self):
        self.temporary.cleanup()

    def test_missing_dependency_does_not_report_zero_measurements(self):
        completed = subprocess.CompletedProcess([], 2, '{"status":"blocked","notes":"PySide6 missing"}\n', "")
        with patch.object(BENCH.subprocess, "run", return_value=completed) as run:
            row = BENCH.benchmark(self.fixture, self.args, 1)
        self.assertEqual(row["status"], "blocked")
        self.assertEqual(row["first_screen_ms"], "")
        self.assertEqual(row["cpu_ms"], "")
        self.assertEqual(row["process_tree_rss_bytes"], "")
        self.assertEqual(run.call_args.kwargs["env"]["QT_QPA_PLATFORM"], "offscreen")
        self.assertIn("-B", run.call_args.args[0])

    def test_timeout_is_distinct_from_dependency_failure(self):
        with patch.object(BENCH.subprocess, "run", side_effect=subprocess.TimeoutExpired("python", 1)):
            row = BENCH.benchmark(self.fixture, self.args, 1)
        self.assertEqual(row["status"], "timeout")
        self.assertEqual(row["rss_bytes"], "")
        self.assertEqual(row["startup_ms"], "")

    def test_worker_exit_after_frame_is_error_and_stderr_is_recorded(self):
        completed = subprocess.CompletedProcess([], 3, '{"status":"ok","first_screen_ms":12.0,"notes":"frame"}\n', "plugin problem")
        with patch.object(BENCH.subprocess, "run", return_value=completed):
            row = BENCH.benchmark(self.fixture, self.args, 1)
        self.assertEqual(row["status"], "error")
        self.assertIn("exited 3", row["notes"])
        self.assertIn("plugin problem", row["notes"])

    def test_invalid_worker_output_cannot_be_success(self):
        completed = subprocess.CompletedProcess([], 0, "unexpected output", "")
        with patch.object(BENCH.subprocess, "run", return_value=completed):
            row = BENCH.benchmark(self.fixture, self.args, 1)
        self.assertEqual(row["status"], "error")
        self.assertEqual(row["render_ms"], "")

    def test_memory_scope_is_explicit(self):
        metrics, note = memory_snapshot()
        self.assertNotIn("process_tree_rss_bytes", metrics)
        self.assertTrue(note)
        for value in metrics.values():
            self.assertGreater(value, 0)


if __name__ == "__main__":
    unittest.main()
