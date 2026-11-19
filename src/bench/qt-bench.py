#!/usr/bin/env python3
"""Cold-process Qt baseline. Only PySide6-Essentials plus Python stdlib required."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


PROTOTYPE = Path(__file__).resolve().parents[1] / "experiments" / "qt-renderer"
sys.path.insert(0, str(PROTOTYPE))
from bench_support import CSV_FIELDS, collect_fixtures, result_row


def worker(args) -> int:
    """Isolated process: no Qt from a previous fixture survives into this run."""
    try:
        import PySide6
        from PySide6.QtCore import QTimer, qVersion
        from PySide6.QtWidgets import QApplication
        from main import MarkdownWindow
        from process_metrics import memory_snapshot
    except ImportError as error:
        print(json.dumps({"status": "blocked", "notes": f"Qt dependency unavailable: {error}"}), flush=True)
        return 2

    app = QApplication([sys.argv[0]])
    window = MarkdownWindow()
    startup_ms = (time.perf_counter_ns() - args.started_ns) / 1_000_000
    try:
        load = window.open_file(args.fixture)
    except (OSError, UnicodeError) as error:
        print(json.dumps({"status": "error", "notes": f"Cannot open fixture: {error}"}), flush=True)
        return 1

    def first_paint():
        first_screen_ms = (time.perf_counter_ns() - args.started_ns) / 1_000_000
        cpu_ms = time.process_time() * 1000
        memory, memory_note = memory_snapshot()
        payload = {
            "status": "ok",
            "pyside_version": PySide6.__version__,
            "qt_version": qVersion(),
            "startup_ms": round(startup_ms, 3),
            "first_screen_ms": round(first_screen_ms, 3),
            **{name: round(value, 3) if isinstance(value, float) else value for name, value in load.as_dict().items()},
            **memory,
            "cpu_ms": round(cpu_ms, 3),
            "cpu_mean_percent": round(cpu_ms / first_screen_ms * 100, 3),
            "notes": f"{memory_note}; viewport paint completed, not compositor presentation; Mermaid/KaTeX/Alerts unsupported",
        }
        print(json.dumps(payload, ensure_ascii=True), flush=True)
        QTimer.singleShot(0, app.quit)

    window.browser.after_next_paint(first_paint)
    window.show()
    return app.exec()


def benchmark(fixture: Path, args, run: int) -> dict:
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    if args.mode == "offscreen":
        environment["QT_QPA_PLATFORM"] = "offscreen"
    else:
        # The visible-window baseline must not silently inherit a headless platform.
        if environment.get("QT_QPA_PLATFORM") in {"offscreen", "minimal"}:
            environment.pop("QT_QPA_PLATFORM")
    started_ns = time.perf_counter_ns()
    command = [sys.executable, "-B", str(Path(__file__).resolve()), "--worker", "--fixture", str(fixture), "--started-ns", str(started_ns)]
    row = result_row(fixture, run=run, mode=args.mode, status="error")
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=environment, timeout=args.timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
    except subprocess.TimeoutExpired:
        row.update(status="timeout", notes=f"Worker killed after {args.timeout:g} s; no first-frame measurements available")
        return row
    payload = None
    for line in completed.stdout.splitlines():
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict) and "status" in candidate:
            payload = candidate
    if payload is not None:
        row.update({name: value for name, value in payload.items() if name in CSV_FIELDS})
    else:
        row["notes"] = f"No worker result; exit code {completed.returncode}"
    if completed.returncode and row["status"] == "ok":
        row.update(status="error", notes=f"Worker exited {completed.returncode} after reporting a frame; {row['notes']}")
    if completed.stderr.strip():
        row["notes"] += f"; Qt stderr: {completed.stderr.strip()[:2000]}"
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--fixture", type=Path, help="One Markdown file")
    inputs.add_argument("--fixtures", type=Path, help="Recursively collect Markdown files in a directory")
    parser.add_argument("--output", type=Path, default=Path("benchmarks/qt-results.csv"))
    parser.add_argument("--mode", choices=("window", "offscreen"), default="window")
    parser.add_argument("--repeat", type=int, default=1, help="Fresh process runs per fixture")
    parser.add_argument("--timeout", type=float, default=60, help="Per-fixture worker timeout in seconds")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--started-ns", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.repeat < 1 or args.timeout <= 0:
        parser.error("--repeat must be >= 1 and --timeout must be > 0")
    if args.worker:
        if args.fixture is None or args.started_ns is None:
            parser.error("Worker requires --fixture and --started-ns")
        return worker(args)
    try:
        fixtures = collect_fixtures(fixture=args.fixture, fixtures=args.fixtures)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    import csv
    failures = 0
    with args.output.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        output.flush()
        for fixture in fixtures:
            for run in range(1, args.repeat + 1):
                row = benchmark(fixture, args, run)
                writer.writerow(row)
                output.flush()
                failures += row["status"] != "ok"
                print(f"{row['status']}: {fixture.name} (run {run}, {args.mode})", flush=True)
    print(f"Wrote {len(fixtures) * args.repeat} rows to {args.output}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
