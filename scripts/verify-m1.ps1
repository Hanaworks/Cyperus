# Isolated native lifecycle verification. Does not install or register file associations.
[CmdletBinding()]
param([string]$RepoRoot = (Get-Location).Path, [switch]$Measure, [switch]$PerformanceOnly,
    [ValidateSet('all','100kb.md','1mb.md','10mb.md','50mb.md')][string]$PerformanceFile = 'all',
    [switch]$Maximized, [int]$IdleSeconds = 60, [string]$ExecutablePath = '')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$bench = (Resolve-Path -LiteralPath (Join-Path $repo 'benchmarks')).Path
$fixtures = (Resolve-Path -LiteralPath (Join-Path $repo 'fixtures')).Path
$generated = (Resolve-Path -LiteralPath (Join-Path $fixtures 'generated')).Path
foreach ($folder in @($bench, $generated)) {
    if ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Probe directory must not be a link' }
}
$profile = [IO.Path]::GetFullPath((Join-Path $bench "m1-$([guid]::NewGuid().ToString('N'))"))
if ([IO.Path]::GetDirectoryName($profile) -ne $bench) { throw 'Probe profile escaped benchmarks' }
New-Item -ItemType Directory -Path $profile | Out-Null
$scenarioPath = Join-Path $profile 'scenario.json'
$reportPath = Join-Path $profile 'report.json'
$executable = if ($ExecutablePath) { (Resolve-Path -LiteralPath $ExecutablePath).Path } else { Join-Path $repo 'src/host/target/release/md-preview.exe' }
$launchDirectory = if ($ExecutablePath) { [IO.Path]::GetDirectoryName($executable) } else { $repo }
$live = [IO.Path]::GetFullPath((Join-Path $generated "m1-live-$([guid]::NewGuid().ToString('N')).md"))
$replacement = $live + '.replacement'
foreach ($candidate in @($live, $replacement)) {
    if ([IO.Path]::GetDirectoryName($candidate) -ne $generated -or (Test-Path -LiteralPath $candidate)) { throw 'Unsafe live probe path' }
}
$owned = [Collections.Generic.List[System.Diagnostics.Process]]::new()
$encodingPaths = @()
$result = [ordered]@{ date = [DateTime]::UtcNow.ToString('o'); profile = $profile; executable_sha256 = (Get-FileHash -LiteralPath $executable).Hash }

function Start-Probe([string[]]$Paths = @()) {
    $arguments = @('"--m1-profile=' + $profile + '"') + @($Paths | ForEach-Object { '"' + $_ + '"' })
    $process = Start-Process -FilePath $executable -ArgumentList ($arguments -join ' ') -WorkingDirectory $launchDirectory -WindowStyle Hidden -PassThru
    $owned.Add($process)
    return $process
}
function Wait-Probe($Process, [datetime]$Started, [bool]$Forward = $false) {
    $deadline = (Get-Date).AddSeconds(300)
    $handled = @{}
    $report = $null
    do {
        Start-Sleep -Milliseconds 200
        $Process.Refresh()
        if ((Test-Path -LiteralPath $reportPath) -and (Get-Item -LiteralPath $reportPath).LastWriteTimeUtc -ge $Started) {
            try { $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json } catch { continue }
            if ($report.stage -and -not $handled.ContainsKey($report.stage)) {
                $handled[$report.stage] = $true
                if ($report.stage -eq 'awaiting-forward' -and $Forward) {
                    $secondary = Start-Probe @((Join-Path $fixtures 'tabs/a.md'))
                    if (-not $secondary.WaitForExit(15000)) { throw 'Second instance did not hand off and exit' }
                    if ($secondary.ExitCode -ne 0) { throw "Second instance exited $($secondary.ExitCode)" }
                }
                if ($report.stage -eq 'awaiting-saves') {
                    foreach ($index in 1..20) {
                        if ($index % 2 -eq 0) {
                            Set-Content -LiteralPath $replacement -Value "# M1-FINAL-$index" -Encoding utf8
                            Move-Item -LiteralPath $replacement -Destination $live -Force
                        } else { Set-Content -LiteralPath $live -Value "# M1-FINAL-$index" -Encoding utf8 }
                        Start-Sleep -Milliseconds 15
                    }
                }
            }
            if ($report.complete) {
                if ($report.errors.Count) { throw ($report.errors -join '; ') }
                return $report
            }
        }
    } while ((Get-Date) -lt $deadline -and -not $Process.HasExited)
    throw "Native probe incomplete. Profile: $profile; last report: $($report | ConvertTo-Json -Depth 8 -Compress)"
}

try {
    Set-Content -LiteralPath $live -Value '# M1-INITIAL' -Encoding utf8
    if (-not $PerformanceOnly) {
    $encodings = @()
    foreach ($entry in @(@{label='utf-16le';codec=[Text.Encoding]::Unicode}, @{label='utf-16be';codec=[Text.Encoding]::BigEndianUnicode}, @{label='gb18030';codec=[Text.Encoding]::GetEncoding(54936)})) {
        $encodingPath = [IO.Path]::GetFullPath((Join-Path $generated "M1-中文-$($entry.label)-$([guid]::NewGuid().ToString('N')).md"))
        if ([IO.Path]::GetDirectoryName($encodingPath) -ne $generated -or (Test-Path -LiteralPath $encodingPath)) { throw 'Unsafe encoding fixture path' }
        $encodingPaths += $encodingPath
        [IO.File]::WriteAllBytes($encodingPath, [byte[]]($entry.codec.GetPreamble() + $entry.codec.GetBytes('# 编码验证：中文段落')))
        $encodings += @{path=$encodingPath;label=$entry.label;heading='编码验证：中文段落'}
    }
    $files = @((Join-Path $fixtures 'basic.md'), (Join-Path $fixtures 'theme.md'))
    @{mode='seed';files=$files;encodings=$encodings;maximized=[bool]$Maximized;forwardPath=(Join-Path $fixtures 'tabs/a.md')} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $scenarioPath -Encoding utf8
    $started = [DateTime]::UtcNow
    $first = Start-Probe $files
    Write-Output "Seed PID=$($first.Id); isolated profile=$profile"
    $seed = Wait-Probe $first $started $true
    if (-not $first.WaitForExit(15000)) { throw 'First instance did not close normally' }
    if ($first.ExitCode -ne 0) { throw "First instance exited $($first.ExitCode) during close" }
    $seed | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $profile 'seed.json') -Encoding utf8
    $result.seed = $seed
    @{mode='restore';workspace=$seed.workspace;window=$seed.desktop.current;livePath=$live} | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $scenarioPath -Encoding utf8
    $started = [DateTime]::UtcNow
    $second = Start-Probe
    Write-Output "Restore PID=$($second.Id)"
    $restored = Wait-Probe $second $started
    if (-not $second.WaitForExit(15000)) { throw 'Restored instance did not close normally' }
    if ($second.ExitCode -ne 0) { throw "Restored instance exited $($second.ExitCode) during close" }
    $restored | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $profile 'restored.json') -Encoding utf8
    $result.restored = $restored
    }
    if ($Measure -or $PerformanceOnly) {
        if (-not $PerformanceOnly) {
            # Lifecycle leaves tabs in workspace.json. A separate profile keeps
            # cold launch from restoring/reading unrelated documents first.
            $result.lifecycleProfile = $profile
            $profile = [IO.Path]::GetFullPath((Join-Path $bench "m1-$([guid]::NewGuid().ToString('N'))"))
            if ([IO.Path]::GetDirectoryName($profile) -ne $bench) { throw 'Performance profile escaped benchmarks' }
            New-Item -ItemType Directory -Path $profile | Out-Null
            $scenarioPath = Join-Path $profile 'scenario.json'
            $reportPath = Join-Path $profile 'report.json'
            $result.profile = $profile
        }
        $performanceFiles = if ($PerformanceFile -eq 'all') { @('100kb.md','1mb.md','10mb.md','50mb.md') } else { @($PerformanceFile) }
        @{mode='performance';files=@($performanceFiles | ForEach-Object { Join-Path $generated $_ })} | ConvertTo-Json | Set-Content -LiteralPath $scenarioPath -Encoding utf8
        $started = [DateTime]::UtcNow
        $perf = Start-Probe
        Write-Output "Performance PID=$($perf.Id)"
        $activeSamplesPath = Join-Path $profile 'active.csv'
        $samplerScript = Join-Path $repo 'src/bench/sample-tree.ps1'
        $samplerArgs = @('-NoProfile','-File',('"'+$samplerScript+'"'),'-RootProcessId',$perf.Id,'-DurationSeconds',300,'-IntervalMs',200,'-OutFile',('"'+$activeSamplesPath+'"'))
        $sampler = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList ($samplerArgs -join ' ') -WindowStyle Hidden -PassThru
        $owned.Add($sampler)
        $measured = Wait-Probe $perf $started
        $sampler.Refresh()
        if (-not $sampler.HasExited) { Stop-Process -Id $sampler.Id -Force; $sampler.WaitForExit() }
        $activeSamples = @(Import-Csv -LiteralPath $activeSamplesPath)
        if (-not $activeSamples.Count) { throw 'Missing active process-tree samples' }
        $result.coldProcessToFirstReadableMs = (([datetime]$measured.firstReadableAt).ToUniversalTime() - $started).TotalMilliseconds
        $result.processTreePeakMiB = [double](($activeSamples | Measure-Object -Property rss_bytes -Maximum).Maximum) / 1MB
        $result.performanceNotes = 'cold/warm denote first open/reopen per fixture; only first fixture has cold Worker. New profile, no forced GC. RSS=sum working sets, sampled after process launch; may miss early/short peaks. Full render traverses segments, not simultaneous DOM residency.'
        $result.performance = $measured
        if ($IdleSeconds -gt 0) {
            Write-Output "Performance completed; sampling $IdleSeconds seconds of idle resource use"
            Start-Sleep -Seconds 5
            $samplesPath = Join-Path $profile 'idle.csv'
            & (Join-Path $repo 'src/bench/sample-tree.ps1') -RootProcessId $perf.Id -DurationSeconds $IdleSeconds -IntervalMs 500 -OutFile $samplesPath
            $samples = @(Import-Csv -LiteralPath $samplesPath)
            $last = $samples[-1]
            if (-not $samples.Count -or $last.root_alive -ne 'True' -or [double]$last.elapsed_ms -lt $IdleSeconds * 1000) { throw 'Incomplete idle measurement: root exited or requested duration not observed' }
            $result.idle = @{ samples=$samples.Count; durationMs=[double]$last.elapsed_ms; cpuMs=[double]$last.cpu_elapsed_ms; rssMiB=([double]$last.rss_bytes / 1MB); rootAlive=$last.root_alive }
        }
    }
    $result.complete = $true
    $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $profile 'summary.json') -Encoding utf8
    Write-Output ($result | ConvertTo-Json -Depth 20)
} finally {
    foreach ($process in $owned) {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    }
    foreach ($candidate in (@($live, $replacement) + $encodingPaths)) {
        if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force }
    }
}
