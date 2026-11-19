# Sequential, isolated comparison of the existing Tauri release and Code OSS source-run host.
[CmdletBinding()]
param(
  [ValidateRange(1, 5)][int]$Rounds = 3,
  [ValidateSet('100kb.md', '1mb.md', '10mb.md', '50mb.md')][string[]]$Files = @('100kb.md', '1mb.md', '10mb.md'),
  [ValidateRange(0, 60)][int]$IdleSeconds = 20
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = Join-Path $repo "artifacts/code-oss/performance/$runId"
$tauri = Join-Path $repo 'src/host/target/release/md-preview.exe'
$source = Join-Path $repo 'artifacts/code-oss/upstream'
$electron = Join-Path $source '.build/electron/Cyperus.exe'
if (-not (Test-Path -LiteralPath $electron -PathType Leaf)) { $electron = Join-Path $source '.build/electron/Markdown Reader Lab.exe' }
$samplerPath = Join-Path $repo 'src/bench/sample-tree.ps1'
$shellPath = (Get-Process -Id $PID).Path
New-Item -ItemType Directory -Path $runRoot | Out-Null
$rows = [Collections.Generic.List[object]]::new()
$runs = [Collections.Generic.List[object]]::new()
$environment = [ordered]@{
  time = [DateTime]::UtcNow.ToString('o')
  cpu = @(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors)
  os = @(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,TotalVisibleMemorySize,FreePhysicalMemory)
  tauriSha256 = (Get-FileHash -LiteralPath $tauri).Hash
  codeOssSha256 = (Get-FileHash -LiteralPath $electron).Hash
  codeOssRevision = (& git -C $source rev-parse HEAD)
  fixtures = @($Files | ForEach-Object { $file = Join-Path $repo "fixtures/generated/$_"; @{ name = $_; bytes = (Get-Item -LiteralPath $file).Length; sha256 = (Get-FileHash -LiteralPath $file).Hash } })
  notes = 'Tauri release vs Code OSS source-run development build. Fresh isolated profiles; sequential runs; OS file cache not flushed; no forced GC. RSS sums process-tree working sets (shared pages may repeat). Active peak is sampled. Idle follows cold/warm traversal and reopening 100 KB. scroll-to-rAF is a scripted rendering metric, not real input latency.'
}
$environment | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runRoot 'environment.json') -Encoding utf8

function Median([double[]]$Values) {
  $sorted = @($Values | Sort-Object)
  if (-not $sorted.Count) { throw 'No samples to summarize' }
  $middle = [int][math]::Floor($sorted.Count / 2)
  if ($sorted.Count % 2) { return $sorted[$middle] }
  return ($sorted[$middle - 1] + $sorted[$middle]) / 2
}

function Measure-Host([string]$Kind, [string]$File, [int]$Round) {
  $label = "$Kind-$($File.Replace('.md',''))-$Round"
  $measurementRoot = Join-Path $runRoot $label
  New-Item -ItemType Directory -Path $measurementRoot | Out-Null
  $fixture = Join-Path $repo "fixtures/generated/$File"
  $app = $null
  $sampler = $null
  $savedProbe = $env:MD_READER_PERF_CONFIG
  try {
    if ($Kind -eq 'tauri') {
      $profile = Join-Path $repo "benchmarks/m1-compare-$runId-$label"
      if (Test-Path -LiteralPath $profile) { throw 'Refusing to reuse profile' }
      New-Item -ItemType Directory -Path $profile | Out-Null
      @{ mode = 'performance'; files = @($fixture) } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $profile 'scenario.json') -Encoding utf8
      $reportPath = Join-Path $profile 'report.json'
      $app = Start-Process -FilePath $tauri -ArgumentList ('"--m1-profile=' + $profile + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    } else {
      $profileName = "perf-$runId-$label"
      $profile = Join-Path $repo "artifacts/code-oss/profiles/$profileName"
      if (Test-Path -LiteralPath $profile) { throw 'Refusing to reuse profile' }
      $globalStorage = Join-Path $profile 'user-data/User/globalStorage'
      New-Item -ItemType Directory -Path $globalStorage | Out-Null
      # Match Tauri's 1100x800 outer window; content viewports are recorded separately.
      @{ windowsState = @{ lastPluginDevelopmentHostWindow = @{ uiState = @{ mode = 1; x = 80; y = 80; width = 1100; height = 800 } }; openedWindows = @() } } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $globalStorage 'storage.json') -Encoding utf8
      $configPath = Join-Path $measurementRoot 'scenario.json'
      @{ file = $fixture } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
      $reportPath = Join-Path $measurementRoot 'report.json'
      $env:MD_READER_PERF_CONFIG = $configPath
      $launchOutput = & (Join-Path $repo 'src/experiments/code-oss-reader/launch.ps1') -CodePath $electron -SourceRoot $source -Profile $profileName
      $pidMatch = [regex]::Match(($launchOutput -join "`n"), 'PID=(\d+)')
      if (-not $pidMatch.Success) { throw 'Launch did not return a process ID' }
      $app = Get-Process -Id ([int]$pidMatch.Groups[1].Value)
    }
    $processStarted = $app.StartTime.ToUniversalTime()
    $samplesPath = Join-Path $measurementRoot 'process-tree.csv'
    $samplerArgs = @('-NoProfile', '-File', ('"' + $samplerPath + '"'), '-RootProcessId', $app.Id, '-DurationSeconds', 300, '-IntervalMs', 200, '-OutFile', ('"' + $samplesPath + '"'))
    $sampler = Start-Process -FilePath $shellPath -ArgumentList ($samplerArgs -join ' ') -WindowStyle Hidden -PassThru
    Write-Output "Running $label; PID=$($app.Id)"
    $deadline = [DateTime]::UtcNow.AddSeconds(240)
    $report = $null
    do {
      Start-Sleep -Milliseconds 200
      if (Test-Path -LiteralPath $reportPath) {
        try { $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json } catch { continue }
        if ($report.complete) { break }
      }
      $app.Refresh()
      if ($app.HasExited) { throw "$label exited before reporting" }
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $report.complete -or $report.errors.Count -or $report.measurements.Count -ne 2) { throw "Incomplete/failed probe: $reportPath" }
    $activeEnd = [DateTime]::UtcNow
    Start-Sleep -Seconds 5
    $idleStart = [DateTime]::UtcNow
    if ($File -eq '100kb.md' -and $IdleSeconds -gt 0) { Start-Sleep -Seconds $IdleSeconds }
    $idleEnd = [DateTime]::UtcNow
    $sampler.Refresh()
    if (-not $sampler.HasExited) { Stop-Process -Id $sampler.Id -Force; $sampler.WaitForExit() }
    $samples = @(Import-Csv -LiteralPath $samplesPath | Where-Object { $_.root_alive -eq 'True' })
    $active = @($samples | Where-Object { ([DateTime]$_.timestamp_utc).ToUniversalTime() -le $activeEnd })
    if (-not $active.Count) { throw 'No active resource samples' }
    $peak = [double](($active | Measure-Object -Property rss_bytes -Maximum).Maximum) / 1MB
    $idle = @($samples | Where-Object { $t = ([DateTime]$_.timestamp_utc).ToUniversalTime(); $t -ge $idleStart -and $t -le $idleEnd })
    $idleSummary = $null
    if ($File -eq '100kb.md' -and $IdleSeconds -gt 0) {
      if ($idle.Count -lt 2) { throw 'No idle resource samples' }
      $durationMs = [double]$idle[-1].elapsed_ms - [double]$idle[0].elapsed_ms
      if ($durationMs -lt ($IdleSeconds - 2) * 1000) { throw 'Idle sample window too short' }
      $cpuMs = [double]$idle[-1].cpu_elapsed_ms - [double]$idle[0].cpu_elapsed_ms
      $idleSummary = @{ durationMs = $durationMs; cpuMs = $cpuMs; oneCoreCpuPct = 100 * $cpuMs / $durationMs; rssMedianMiB = (Median @($idle | ForEach-Object { [double]$_.rss_bytes })) / 1MB; processCount = $idle[-1].process_count }
    }
    $startup = (([DateTime]$report.firstReadableAt).ToUniversalTime() - $processStarted).TotalMilliseconds
    $summary = @{ hostKind = $Kind; file = $File; round = $Round; profile = $profile; processStartedAt = $processStarted.ToString('o'); processToFirstReadableMs = $startup; activePeakMiB = $peak; idle = $idleSummary; probe = $report }
    $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $measurementRoot 'summary.json') -Encoding utf8
    $runs.Add($summary)
    foreach ($entry in $report.measurements) {
      $rows.Add([pscustomobject]@{ hostKind = $Kind; file = $File; round = $Round; temperature = $entry.temperature; startupMs = $startup; firstReadableMs = $entry.firstReadableMs; parseMs = $entry.parseMs; fullRenderMs = $entry.fullRenderMs; scrollRafP95Ms = $entry.scrollRafP95Ms; activePeakMiB = $peak; idleRssMiB = $idleSummary.rssMedianMiB; idleCpuPct = $idleSummary.oneCoreCpuPct })
    }
    $rows | Export-Csv -LiteralPath (Join-Path $runRoot 'results.csv') -NoTypeInformation -Encoding utf8
    $runs | ConvertTo-Json -Depth 22 | Set-Content -LiteralPath (Join-Path $runRoot 'runs.json') -Encoding utf8
    Write-Output ("Completed {0}: startup={1:N0}ms peak={2:N1}MiB" -f $label, $startup, $peak)
  } finally {
    $env:MD_READER_PERF_CONFIG = $savedProbe
    if ($sampler) { $sampler.Refresh(); if (-not $sampler.HasExited) { Stop-Process -Id $sampler.Id -Force } }
    if ($app) {
      $app.Refresh()
      # Only the process tree created by this measurement is terminated.
      if (-not $app.HasExited) { & taskkill.exe /PID $app.Id /T /F | Out-Null }
    }
  }
}

Write-Output "Comparison artifacts: $runRoot"
foreach ($round in 1..$Rounds) {
  foreach ($file in $Files) {
    $hostOrder = if ($round % 2) { @('tauri', 'code-oss') } else { @('code-oss', 'tauri') }
    foreach ($kind in $hostOrder) { Measure-Host $kind $file $round }
  }
}
@{ complete = $true; rounds = $Rounds; files = $Files; runs = $runs.Count; directory = $runRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'complete.json') -Encoding utf8
Write-Output "Comparison complete: $runRoot"
