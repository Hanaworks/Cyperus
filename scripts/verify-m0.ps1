# Native release verification. Only owns and closes the process started here.
[CmdletBinding()]
param([string]$RepoRoot = (Get-Location).Path, [double]$IdleSeconds = 60, [string]$ReportName = 'native-m0.json', [switch]$VerifyReader)
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path -LiteralPath $RepoRoot).Path
$benchmarkPath = (Resolve-Path -LiteralPath (Join-Path $repoPath 'benchmarks')).Path
if (-not [string]::Equals($benchmarkPath, [System.IO.Path]::GetFullPath((Join-Path $repoPath 'benchmarks')), [StringComparison]::OrdinalIgnoreCase) -or
    ((Get-Item -LiteralPath $benchmarkPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    throw 'Benchmark outputs must stay inside the repository benchmarks directory'
}
if ($ReportName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$') { throw 'Invalid benchmark report name' }
$reportPath = [System.IO.Path]::GetFullPath((Join-Path $benchmarkPath $ReportName))
$treePath = [System.IO.Path]::GetFullPath((Join-Path $benchmarkPath 'native-tree.csv'))
$temporaryTreePath = [System.IO.Path]::GetFullPath((Join-Path $benchmarkPath "native-tree-$([guid]::NewGuid().ToString('N')).local.csv"))
$summaryPath = [System.IO.Path]::GetFullPath((Join-Path $benchmarkPath 'native-summary.json'))
foreach ($outputPath in @($reportPath, $treePath, $temporaryTreePath, $summaryPath)) {
    if (-not [string]::Equals([System.IO.Path]::GetDirectoryName($outputPath), $benchmarkPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Benchmark output path escaped its directory'
    }
}
$executable = Join-Path $repoPath 'src\host\target\release\md-preview.exe'
$livePath = $null
$replacementPath = $null
if ($VerifyReader) {
    $generatedPath = (Resolve-Path -LiteralPath (Join-Path $repoPath 'fixtures/generated')).Path
    if ((Get-Item -LiteralPath $generatedPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Generated directory cannot be a link' }
    $livePath = [System.IO.Path]::GetFullPath((Join-Path $generatedPath 'reader-live.md'))
    $replacementPath = [System.IO.Path]::GetFullPath((Join-Path $generatedPath 'reader-live-replacement.local.md'))
    foreach ($candidate in @($livePath, $replacementPath)) {
        if ([System.IO.Path]::GetDirectoryName($candidate) -ne $generatedPath -or (Test-Path -LiteralPath $candidate)) { throw 'Live probe target already exists or escaped its directory' }
    }
    Set-Content -LiteralPath $livePath -Value '# READER-LIVE-INITIAL' -Encoding utf8
}
$started = [DateTime]::UtcNow
$nativeProcess = $null
try {
    $nativeProcess = Start-Process -FilePath $executable -ArgumentList "--m0-report=$reportPath" -WindowStyle Hidden -PassThru
    Write-Output "Native release PID=$($nativeProcess.Id)"
    $deadline = (Get-Date).AddSeconds(60)
    $report = $null
    $handledStages = @{}
    do {
        Start-Sleep -Milliseconds 250
        $nativeProcess.Refresh()
        if ((Test-Path -LiteralPath $reportPath) -and (Get-Item -LiteralPath $reportPath).LastWriteTimeUtc -ge $started) {
            # The app rewrites this report at each stage. Retry a partial read.
            try { $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json }
            catch { continue }
            if ($VerifyReader -and $report.stage -and -not $handledStages.ContainsKey($report.stage)) {
                $handledStages[$report.stage] = $true
                switch ($report.stage) {
                    'reader-live-ready' { Set-Content -LiteralPath $livePath -Value '# READER-LIVE-UPDATED' -Encoding utf8 }
                    'reader-live-updated' {
                        Set-Content -LiteralPath $replacementPath -Value '# READER-LIVE-REPLACED' -Encoding utf8
                        Move-Item -LiteralPath $replacementPath -Destination $livePath -Force
                    }
                    'reader-live-replaced' { Remove-Item -LiteralPath $livePath -Force }
                    'reader-live-gone' { Set-Content -LiteralPath $livePath -Value '# READER-LIVE-RESTORED' -Encoding utf8 }
                }
            }
            if ($report.complete) { break }
        }
    } while ((Get-Date) -lt $deadline -and -not $nativeProcess.HasExited)
    if (-not $report -or -not $report.complete) { throw 'Native probe did not complete' }
    if ($report.errors.Count) { throw ('Native verification errors: ' + ($report.errors -join '; ')) }
    if ($report.ipc.Count -ne 4 -or @($report.ipc | Where-Object { -not $_.ok }).Count) {
        throw 'Native IPC verification failed'
    }
    $extended = $report.fixtures | Where-Object { $_.name -eq 'extended.md' }
    $basic = $report.fixtures | Where-Object { $_.name -eq 'basic.md' }
    $theme = $report.fixtures | Where-Object { $_.name -eq 'theme.md' }
    $links = $report.fixtures | Where-Object { $_.name -eq 'links.md' }
    if ($report.fixtures.Count -ne 7 -or @($report.fixtures | Where-Object { $_.headings -le 0 -or -not $_.themeDidNotParse }).Count) {
        throw 'Native fixture or theme verification failed'
    }
    if (-not $extended.hasMath -or -not $extended.hasShiki -or $extended.mermaidDone -lt 4 -or $extended.mermaidErrors -ne 1 -or $extended.imagesLoaded -lt 4) {
        throw 'Native extended rendering or images failed'
    }
    if ($basic.imagesLoaded -lt 2 -or $theme.imagesLoaded -lt 1 -or $theme.mermaidDone -lt 1 -or $links.imagesLoaded -lt 1) {
        throw 'Native basic, theme or links images/rendering failed'
    }
    if (-not $report.workbench.cacheDidNotParse -or -not $report.workbench.deduplicated -or
        -not $report.workbench.outsideRejected -or $report.workbench.searchCount -le 0 -or $report.workbench.tabs -ne 2) {
        throw 'Native workbench verification failed'
    }
    if ($VerifyReader -and (-not $report.workbench.readerHost.links -or -not $report.workbench.readerHost.persistence -or
        $report.workbench.readerHost.liveRefresh -ne $true -or -not $report.workbench.readerHost.deletionRetained)) { throw 'Native reader integration failed' }
    Write-Output 'IPC and seven fixtures passed; waiting five seconds before idle sampling'
    Start-Sleep -Seconds 5
    if ($IdleSeconds -gt 0) {
        $sampler = [scriptblock]::Create((Get-Content -Raw -LiteralPath (Join-Path $repoPath 'src\bench\sample-tree.ps1')))
        & $sampler -RootProcessId $nativeProcess.Id -DurationSeconds $IdleSeconds -IntervalMs 500 -OutFile $temporaryTreePath
        $samples = @(Import-Csv -LiteralPath $temporaryTreePath)
        $last = $samples[-1]
        if ($last.root_alive -ne 'True' -or [double]$last.elapsed_ms -lt $IdleSeconds * 1000 - 1000) { throw 'Incomplete native sampling' }
        # Publish only a validated capture; a failed rerun preserves the old CSV.
        Move-Item -LiteralPath $temporaryTreePath -Destination $treePath -Force
        $peak = ($samples | ForEach-Object { [double]$_.rss_bytes } | Measure-Object -Maximum).Maximum
        [ordered]@{
            date = [DateTime]::UtcNow.ToString('o')
            scope = 'native release after IPC and seven fixtures, last active tabs/a.md; no forced GC'
            duration_ms = [double]$last.elapsed_ms
            samples = $samples.Count
            rss_peak_mib = [Math]::Round($peak / 1MB, 3)
            rss_stable_mib = [Math]::Round([double]$last.rss_bytes / 1MB, 3)
            idle_cpu_ms = [double]$last.cpu_elapsed_ms
            idle_cpu_pct = [double]$last.cpu_pct
            method = $last.method
            executable_sha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
        } | ConvertTo-Json | Set-Content -LiteralPath $summaryPath -Encoding utf8
        Get-Content -Raw -LiteralPath $summaryPath
    }
} finally {
    try {
        if ($nativeProcess) {
            $nativeProcess.Refresh()
            if (-not $nativeProcess.HasExited) { Stop-Process -Id $nativeProcess.Id -Force }
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryTreePath) { Remove-Item -LiteralPath $temporaryTreePath -Force }
        foreach ($probePath in @($livePath, $replacementPath)) {
            if ($probePath -and (Test-Path -LiteralPath $probePath)) { Remove-Item -LiteralPath $probePath -Force }
        }
    }
}
