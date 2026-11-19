# Native release-only resource evidence; never installs, forces GC, or edits normal settings.
[CmdletBinding()]
param([string]$RepoRoot = (Get-Location).Path, [ValidateRange(120, 3600)][int]$TimeoutSeconds = 1200)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$bench = (Resolve-Path -LiteralPath (Join-Path $repo 'benchmarks')).Path
$generated = (Resolve-Path -LiteralPath (Join-Path $repo 'fixtures/generated')).Path
foreach ($directory in @($repo, $bench, $generated)) {
    if ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Probe directories must not be links' }
}
$executable = (Resolve-Path -LiteralPath (Join-Path $repo 'src/host/target/release/md-preview.exe')).Path
$samplerScript = (Resolve-Path -LiteralPath (Join-Path $repo 'src/bench/sample-tree.ps1')).Path
$source = (Resolve-Path -LiteralPath (Join-Path $generated '1mb.md')).Path
$small = (Resolve-Path -LiteralPath (Join-Path $generated '100kb.md')).Path
if ((Get-Item -LiteralPath $source).Length -lt 1MB -or (Get-Item -LiteralPath $source).Length -gt 2MB) { throw 'Expected the generated 1 MB source fixture' }
if ((Get-Item -LiteralPath $small).Length -lt 100KB -or (Get-Item -LiteralPath $small).Length -gt 200KB) { throw 'Expected the generated 100 KB source fixture' }
$runId = [guid]::NewGuid().ToString('N')
$profile = [IO.Path]::GetFullPath((Join-Path $bench "m1-resources-$runId"))
$copies = [IO.Path]::GetFullPath((Join-Path $generated "m1-resources-$runId"))
if ([IO.Path]::GetDirectoryName($profile) -ne $bench -or [IO.Path]::GetDirectoryName($copies) -ne $generated -or (Test-Path -LiteralPath $profile) -or (Test-Path -LiteralPath $copies)) { throw 'Unsafe or existing probe paths' }
$ownedFiles = [Collections.Generic.List[string]]::new()
$ownedProcesses = [Collections.Generic.List[System.Diagnostics.Process]]::new()
$copiesCreated = $false
$result = [ordered]@{ date=[DateTime]::UtcNow.ToString('o'); profile=$profile; executableSha256=(Get-FileHash -LiteralPath $executable).Hash; complete=$false }

function Get-Median([double[]]$Values) {
    $sorted = @($Values | Sort-Object)
    if (-not $sorted.Count) { throw 'No samples for median' }
    $middle = [int][Math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2) { return $sorted[$middle] }
    return ($sorted[$middle - 1] + $sorted[$middle]) / 2
}

try {
    New-Item -ItemType Directory -Path $profile | Out-Null
    New-Item -ItemType Directory -Path $copies | Out-Null
    $copiesCreated = $true
    foreach ($index in 1..100) {
        $target = [IO.Path]::GetFullPath((Join-Path $copies ('tab-{0:D3}.md' -f $index)))
        if ([IO.Path]::GetDirectoryName($target) -ne $copies -or (Test-Path -LiteralPath $target)) { throw 'Unsafe fixture target' }
        # Track before copying so a partial copy is cleaned if an I/O error occurs.
        $ownedFiles.Add($target)
        [IO.File]::Copy($source, $target, $false)
    }
    $result.fixtures = @{ count=$ownedFiles.Count; bytesEach=(Get-Item -LiteralPath $source).Length; sourceSha256=(Get-FileHash -LiteralPath $source).Hash; generatedDirectory=$copies }
    $scenarioPath = Join-Path $profile 'scenario.json'
    $reportPath = Join-Path $profile 'report.json'
    $samplesPath = Join-Path $profile 'process-tree.csv'
    @{mode='resources'; files=@($ownedFiles); smallPath=$small} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $scenarioPath -Encoding utf8
    $app = Start-Process -FilePath $executable -ArgumentList ('"--m1-profile=' + $profile + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru
    $ownedProcesses.Add($app)
    $samplerArgs = @('-NoProfile','-File',('"'+$samplerScript+'"'),'-RootProcessId',$app.Id,'-DurationSeconds',$TimeoutSeconds,'-IntervalMs',100,'-OutFile',('"'+$samplesPath+'"'))
    $sampler = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList ($samplerArgs -join ' ') -WindowStyle Hidden -PassThru
    $ownedProcesses.Add($sampler)
    Write-Output "Resources PID=$($app.Id); isolated profile=$profile; process-tree sampling=100ms"
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $report = $null
    $lastStage = ''
    while ([DateTime]::UtcNow -lt $deadline) {
        $app.Refresh()
        if (Test-Path -LiteralPath $reportPath) {
            try { $report = Get-Content -Raw -LiteralPath $reportPath | ConvertFrom-Json } catch { $report = $null }
            if ($report -and $report.stage -ne $lastStage) {
                $lastStage = $report.stage
                Write-Output "Resources stage=$lastStage"
            }
            if ($report -and $report.complete) { break }
        }
        if ($app.HasExited) { break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $report -or -not $report.complete) { throw "Resource probe did not finish; inspect $profile" }
    $result.probe = $report
    if ($report.errors.Count -or -not $report.resourcesPassed) { throw "Native resource assertions failed: $($report.errors -join '; ')" }
    if (-not $app.WaitForExit(15000)) { throw 'Resource probe did not close normally' }
    if ($app.ExitCode -ne 0) { throw "Resource probe exited $($app.ExitCode)" }
    # The read-only sampler stops itself when its selected root exits.
    if (-not $sampler.WaitForExit(15000)) { throw 'Process sampler did not finish after app exit' }
    if ($sampler.ExitCode -ne 0) { throw "Process sampler exited $($sampler.ExitCode)" }
    $samples = @(Import-Csv -LiteralPath $samplesPath)
    if (-not $samples.Count) { throw 'No process-tree samples recorded' }
    $windows = @()
    foreach ($name in @('close-5','close-50','tabs-10','tabs-30','tabs-100')) {
        $checkpoint = @($report.checkpoints | Where-Object { $_.name -eq $name })
        if ($checkpoint.Count -ne 1 -or -not $checkpoint[0].endedAt) { throw "Incomplete checkpoint: $name" }
        $entry = $checkpoint[0]
        # ConvertFrom-Json in PowerShell 7 may already return UTC DateTime.
        # Parsing its culture-formatted string again loses Kind and shifts UTC by 8h.
        $start = ([DateTime]$entry.startedAt).ToUniversalTime()
        $end = ([DateTime]$entry.endedAt).ToUniversalTime()
        if (($end - $start).TotalSeconds -lt 4.9) { throw "Checkpoint was not quiet for five seconds: $name" }
        $windowStart = $end.AddSeconds(-2)
        $selected = @($samples | Where-Object {
            $time = [DateTime]::Parse($_.timestamp_utc).ToUniversalTime()
            $_.root_alive -eq 'True' -and $time -ge $windowStart -and $time -lt $end
        })
        if ($selected.Count -lt 3) { throw "Too few process-tree samples at $name" }
        $rss = @($selected | ForEach-Object { [double]$_.rss_bytes })
        $windows += [ordered]@{ name=$name; sampleCount=$selected.Count; startedAt=$windowStart.ToString('o'); endedAt=$end.ToString('o'); medianRssBytes=(Get-Median $rss); peakRssBytes=($rss | Measure-Object -Maximum).Maximum; cache=$entry.cache; tabCount=$entry.tabCount; cachedTabs=$entry.cachedTabs; evictedTabs=$entry.evictedTabs }
    }
    $fifth = ($windows | Where-Object { $_.name -eq 'close-5' }).medianRssBytes
    $fiftieth = ($windows | Where-Object { $_.name -eq 'close-50' }).medianRssBytes
    if ($fifth -le 0) { throw 'Invalid fifth-round RSS denominator' }
    $ratio = $fiftieth / $fifth
    $result.checkpoints = $windows
    $result.closeCycleRss = @{ fifthBytes=$fifth; fiftiethBytes=$fiftieth; ratio=$ratio; threshold=1.3; passed=($ratio -le 1.3) }
    $result.processTreePeakBytes = ($samples | Measure-Object -Property rss_bytes -Maximum).Maximum
    $result.notes = 'RSS is summed process-tree Working Set and may count shared pages repeatedly. 100ms is requested spacing, not guaranteed sampling resolution; short peaks may be missed. Checkpoint metric is median RSS in the final 2 seconds of a 5-second quiet window. No forced GC. 48MiB is retained HTML only, not total memory. Fixtures are deleted; isolated profile, reports and raw CSV remain.'
    $result.complete = $true
    $result | ConvertTo-Json -Depth 24 | Set-Content -LiteralPath (Join-Path $profile 'summary.json') -Encoding utf8
    Write-Output ($result | ConvertTo-Json -Depth 24)
    if ($ratio -gt 1.3) { throw "RSS gate failed: round50/round5=$ratio exceeds 1.3; evidence retained in $profile" }
} catch {
    $result.failure = $_.Exception.Message
    if (Test-Path -LiteralPath $profile -PathType Container) { $result | ConvertTo-Json -Depth 24 | Set-Content -LiteralPath (Join-Path $profile 'summary.json') -Encoding utf8 }
    throw
} finally {
    foreach ($process in $ownedProcesses) {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force; [void]$process.WaitForExit(5000) }
    }
    # Delete only this run's known copies. No wildcard or recursive deletion.
    if ($copiesCreated -and (Test-Path -LiteralPath $copies)) {
        $resolvedCopies = (Resolve-Path -LiteralPath $copies).Path
        if ($resolvedCopies -ne $copies -or [IO.Path]::GetDirectoryName($resolvedCopies) -ne $generated -or (Get-Item -LiteralPath $copies).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing unsafe fixture cleanup' }
        foreach ($target in $ownedFiles) {
            if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($target)) -ne $resolvedCopies) { throw 'Owned file escaped fixture directory' }
            if (Test-Path -LiteralPath $target) {
                if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked fixture cleanup' }
                Remove-Item -LiteralPath $target -Force
            }
        }
        if (@(Get-ChildItem -LiteralPath $resolvedCopies -Force).Count) { throw 'Unexpected files remain; preserving fixture directory' }
        Remove-Item -LiteralPath $resolvedCopies
    }
}
