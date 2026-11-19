"""Measure this worker only. No psutil, subprocess tree, or fabricated values."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import sys


def memory_snapshot() -> tuple[dict[str, int], str]:
    if sys.platform == "win32":
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessMemoryCounters), wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        if not psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            return {}, f"GetProcessMemoryInfo failed ({ctypes.get_last_error()}); RSS unavailable"
        return {"rss_bytes": counters.WorkingSetSize, "peak_rss_bytes": counters.PeakWorkingSetSize}, "Windows working set; worker only; process tree not sampled"
    if sys.platform in {"linux", "darwin"}:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return {"peak_rss_bytes": int(peak if sys.platform == "darwin" else peak * 1024)}, "ru_maxrss is peak only; current RSS and process tree not sampled"
    return {}, "Current RSS, peak RSS and process tree unavailable on this platform"
