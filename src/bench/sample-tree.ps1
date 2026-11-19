<#
.SYNOPSIS
Sample one explicitly selected process tree. No process is stopped or changed.
.EXAMPLE
powershell -NoProfile -File src/bench/sample-tree.ps1 -RootProcessId 1234 -DurationSeconds 60 -IntervalMs 200 -OutFile benchmarks/native-tree.csv
.NOTES
RSS means summed WorkingSetSize, including shared pages in each process. CPU percent
uses one logical core as 100%; cpu_elapsed_ms is the cumulative observed CPU delta.
Short-lived processes between snapshots can be missed. This is sampled, not OS peak RSS.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$RootProcessId,
    [ValidateRange(0.1, 86400)]
    [double]$DurationSeconds = 60,
    [ValidateRange(20, 60000)]
    [int]$IntervalMs = 200,
    [Parameter(Mandatory = $true)]
    [string]$OutFile
)

function Get-TreeProcessKey($Entry) {
    # CIM stores microseconds while Process.StartTime retains 100ns ticks.
    $created = ([datetime]$Entry.CreationDate).ToUniversalTime().ToString('yyyyMMddHHmmssffffff')
    return "$($Entry.ProcessId)/$created"
}

$ErrorActionPreference = 'Stop'
$outputPath = [System.IO.Path]::GetFullPath($OutFile)
if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetDirectoryName($outputPath)) -PathType Container)) {
    throw 'The output directory must already exist.'
}
if (Test-Path -LiteralPath $outputPath) {
    throw "Refusing to overwrite an existing sample file: $outputPath"
}
if (-not (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue)) {
    throw "Root process $RootProcessId does not exist."
}

$useCim = $true
$previousCpu = @{}
$cpuElapsedMs = [double]0
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$firstSample = $true
$firstElapsedMs = [double]0
$rootIdentity = $null

do {
    $method = 'CIM'
    if ($useCim) {
        try {
            $allProcesses = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, WorkingSetSize, KernelModeTime, UserModeTime, CreationDate)
        } catch {
            $useCim = $false
            Write-Warning 'CIM is unavailable; falling back to Get-Process with Toolhelp parent IDs.'
        }
    }
    if (-not $useCim) {
        # Toolhelp provides parent IDs without changing the selected processes.
        # The type is defined only in this sampler process; no files are emitted.
        if (-not ('MarkdownBench.ProcessTree' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace MarkdownBench {
    public static class ProcessTree {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct Entry {
            public uint size, usage, id; public IntPtr heap;
            public uint module, threads, parent; public int priority; public uint flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string exe;
        }
        [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint id);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        public static Dictionary<int, int> Parents() {
            var result = new Dictionary<int, int>();
            var snapshot = CreateToolhelp32Snapshot(2, 0);
            if (snapshot == new IntPtr(-1)) throw new InvalidOperationException("Cannot snapshot processes");
            try {
                var entry = new Entry { size = (uint)Marshal.SizeOf(typeof(Entry)) };
                if (Process32FirstW(snapshot, ref entry)) do { result[(int)entry.id] = (int)entry.parent; }
                while (Process32NextW(snapshot, ref entry));
            } finally { CloseHandle(snapshot); }
            return result;
        }
    }
}
'@
        }
        $method = 'Get-Process+Toolhelp'
        $parentIds = [MarkdownBench.ProcessTree]::Parents()
        $allProcesses = @(Get-Process | ForEach-Object {
            try {
                [pscustomobject]@{
                    ProcessId = $_.Id
                    ParentProcessId = $parentIds[$_.Id]
                    WorkingSetSize = $_.WorkingSet64
                    KernelModeTime = $_.PrivilegedProcessorTime.Ticks
                    UserModeTime = $_.UserProcessorTime.Ticks
                    CreationDate = $_.StartTime.ToUniversalTime().ToString('o')
                }
            } catch { } # A process can exit between enumeration and property access.
        })
    }

    $rootProcess = $allProcesses | Where-Object { [int]$_.ProcessId -eq $RootProcessId } | Select-Object -First 1
    if ($rootProcess) {
        $identity = Get-TreeProcessKey $rootProcess
        if ($null -eq $rootIdentity) { $rootIdentity = $identity }
        if ($identity -ne $rootIdentity) { break } # Never follow a reused root PID.
    }
    $selectedIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$selectedIds.Add($RootProcessId)
    do {
        $added = $false
        foreach ($entry in $allProcesses) {
            if ($selectedIds.Contains([int]$entry.ParentProcessId)) {
                if ($selectedIds.Add([int]$entry.ProcessId)) { $added = $true }
            }
        }
    } while ($added)

    $tree = @($allProcesses | Where-Object { $selectedIds.Contains([int]$_.ProcessId) })
    $rssBytes = [double]0
    foreach ($entry in $tree) {
        $rssBytes += [double]$entry.WorkingSetSize
        $key = Get-TreeProcessKey $entry
        $cpuMs = ([double]$entry.KernelModeTime + [double]$entry.UserModeTime) / 10000
        if (-not $firstSample) {
            if ($previousCpu.ContainsKey($key)) {
                $cpuElapsedMs += [Math]::Max(0, $cpuMs - $previousCpu[$key])
            } else {
                $cpuElapsedMs += $cpuMs
            }
        }
        $previousCpu[$key] = $cpuMs
    }
    $elapsedMs = $watch.Elapsed.TotalMilliseconds
    if ($firstSample) { $firstElapsedMs = $elapsedMs }
    $measurementElapsed = $elapsedMs - $firstElapsedMs
    $cpuPct = if ($measurementElapsed -gt 0) { 100 * $cpuElapsedMs / $measurementElapsed } else { 0 }
    [pscustomobject][ordered]@{
        timestamp_utc = [DateTime]::UtcNow.ToString('o')
        elapsed_ms = [Math]::Round($measurementElapsed, 3)
        root_process_id = $RootProcessId
        root_alive = [bool]$rootProcess
        process_count = $tree.Count
        rss_bytes = [long]$rssBytes
        cpu_elapsed_ms = [Math]::Round($cpuElapsedMs, 3)
        cpu_pct = [Math]::Round($cpuPct, 6)
        method = $method
    } | Export-Csv -LiteralPath $outputPath -NoTypeInformation -Encoding UTF8 -Append
    $firstSample = $false
    if (-not $rootProcess -or $measurementElapsed -ge $DurationSeconds * 1000) { break }
    Start-Sleep -Milliseconds $IntervalMs
} while ($true)
