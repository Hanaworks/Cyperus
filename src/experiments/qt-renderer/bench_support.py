"""Qt-free benchmark data and hierarchy helpers."""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import platform
from typing import Iterable, TextIO


MARKDOWN_SUFFIXES = {".md", ".markdown", ".mdown", ".mkd"}
CSV_FIELDS = [
    "timestamp_utc", "renderer", "scenario", "fixture", "fixture_bytes", "run",
    "status", "mode", "python_version", "pyside_version", "qt_version",
    "startup_ms", "first_screen_ms", "read_ms", "render_ms", "toc_ms",
    "rss_bytes", "peak_rss_bytes", "process_tree_rss_bytes", "cpu_ms",
    "cpu_mean_percent", "memory_scope", "cpu_scope", "heading_count",
    "document_blocks", "notes",
]


@dataclass
class OutlineEntry:
    level: int
    text: str
    position: int
    children: list[OutlineEntry] = field(default_factory=list)


def build_outline(headings: Iterable[tuple[int, str, int]]) -> list[OutlineEntry]:
    """Nest *parsed* QTextBlock headings; never infer headings from source lines."""
    roots: list[OutlineEntry] = []
    stack: list[OutlineEntry] = []
    for level, text, position in headings:
        if not 1 <= level <= 6:
            continue
        entry = OutlineEntry(level, text, position)
        while stack and stack[-1].level >= level:
            stack.pop()
        (stack[-1].children if stack else roots).append(entry)
        stack.append(entry)
    return roots


def collect_fixtures(*, fixture: Path | None = None, fixtures: Path | None = None) -> list[Path]:
    if (fixture is None) == (fixtures is None):
        raise ValueError("Choose exactly one of --fixture and --fixtures")
    if fixture is not None:
        path = fixture.resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Fixture not found: {path}")
        if path.suffix.lower() not in MARKDOWN_SUFFIXES:
            raise ValueError(f"Not a Markdown fixture: {path}")
        return [path]
    assert fixtures is not None
    directory = fixtures.resolve()
    if not directory.is_dir():
        raise ValueError(f"Fixture directory not found: {directory}")
    paths = sorted(
        (path for path in directory.rglob("*") if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES),
        key=lambda path: str(path).casefold(),
    )
    if not paths:
        raise ValueError(f"No Markdown fixtures in: {directory}")
    return paths


def result_row(fixture: Path, *, run: int, mode: str, status: str, notes: str = "") -> dict:
    """Empty measurements stay empty; a blocked run is never a zero-time run."""
    row = dict.fromkeys(CSV_FIELDS, "")
    row.update(
        timestamp_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        renderer="qt-qtextdocument",
        scenario="open",
        fixture=str(fixture),
        fixture_bytes=fixture.stat().st_size if fixture.is_file() else "",
        run=run,
        status=status,
        mode=mode,
        python_version=platform.python_version(),
        memory_scope="worker_process",
        cpu_scope="worker_total_through_first_frame",
        notes=notes,
    )
    return row


def write_csv(output: TextIO, rows: Iterable[dict]) -> None:
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="raise", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
