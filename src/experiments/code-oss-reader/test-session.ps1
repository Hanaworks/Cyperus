param([string]$Profile = 'continuity-live-qa', [string]$PackageRoot)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^continuity-[a-zA-Z0-9_-]+$') { throw 'Session QA requires a dedicated continuity profile.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$qaRoot = Join-Path $repo "artifacts\code-oss\qa\$Profile"
$driverRoot = Join-Path $repo "artifacts\code-oss\profiles\$Profile\extensions\reader-session-driver"
New-Item -ItemType Directory -Force -Path $qaRoot, $driverRoot | Out-Null
$profileRoot = Join-Path $repo "artifacts\code-oss\profiles\$Profile"
if ($PackageRoot) {
  $package = [IO.Path]::GetFullPath($PackageRoot)
  $packageExe = Join-Path $package 'Cyperus.exe'
  if (-not (Test-Path -LiteralPath $packageExe -PathType Leaf)) { $packageExe = Join-Path $package 'Markdown Reader Lab.exe' }
  if (-not (Test-Path -LiteralPath $packageExe -PathType Leaf)) { throw 'Candidate executable missing.' }
  New-Item -ItemType Directory -Force -Path (Join-Path $profileRoot 'user-data\User') | Out-Null
  Copy-Item -LiteralPath (Join-Path $package 'data\user-data\User\settings.json') -Destination (Join-Path $profileRoot 'user-data\User\settings.json')
}
# Extension-test mode deliberately uses in-memory storage. A local test driver
# in this isolated profile exercises normal persistence and orderly shutdown.
$manifest = @{ name='reader-session-driver'; publisher='local-md-reader'; version='0.0.1'; engines=@{vscode='^1.100.0'}; main='./extension.cjs'; activationEvents=@('onStartupFinished'); capabilities=@{untrustedWorkspaces=@{supported=$true}} }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $driverRoot 'package.json')
$testPath = Join-Path $PSScriptRoot 'session-integration.cjs'
$driver = "const vscode = require('vscode'); exports.activate = async () => { try { await require(" + (ConvertTo-Json -InputObject $testPath -Compress) + ").run(); } catch (error) { console.error(error); } finally { await vscode.commands.executeCommand('workbench.action.quit'); } };"
Set-Content -LiteralPath (Join-Path $driverRoot 'extension.cjs') -Value $driver
$env:MD_READER_TEST_ROOT = $qaRoot
foreach ($phase in @('prepare', 'restore')) {
  $env:MD_READER_SESSION_PHASE = $phase
  $started = [DateTime]::UtcNow
  $launchArguments = @{ Profile = $Profile }
  if ($phase -eq 'prepare') { $launchArguments.OpenFolder = $qaRoot }
  if ($PackageRoot) {
    $start = [Diagnostics.ProcessStartInfo]::new($packageExe)
    $start.UseShellExecute = $false
    $start.WorkingDirectory = $package
    foreach ($key in @($start.Environment.Keys)) {
      if ($key -like 'VSCODE_*' -or $key -like 'MD_READER_*' -or $key -in @('ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','NODE_ENV')) { $start.Environment.Remove($key) | Out-Null }
    }
    $start.Environment['VSCODE_PORTABLE'] = $profileRoot
    $start.Environment['MD_READER_TEST_ROOT'] = $qaRoot
    $start.Environment['MD_READER_SESSION_PHASE'] = $phase
    foreach ($argument in @('--skip-welcome', '--skip-release-notes', "--shared-data-dir=$(Join-Path $profileRoot 'shared-data')")) { $start.ArgumentList.Add($argument) }
    if ($phase -eq 'prepare') { $start.ArgumentList.Add('--new-window'); $start.ArgumentList.Add($qaRoot) }
    $packageProcess = [Diagnostics.Process]::Start($start)
    $launchOutput = "Reader candidate launched: PID=$($packageProcess.Id)"
  } else { $launchOutput = & (Join-Path $PSScriptRoot 'launch-code-oss.ps1') @launchArguments }
  $taskProcessId = [int]([regex]::Match(($launchOutput -join "`n"), 'PID=(\d+)').Groups[1].Value)
  if ($taskProcessId -le 0) { throw 'Reader process was not launched.' }
  if (Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue) { Wait-Process -Id $taskProcessId -Timeout 60 }
  $resultFile = Join-Path $qaRoot "session-$phase.json"
  $result = Get-Item -LiteralPath $resultFile
  if ($result.LastWriteTimeUtc -lt $started) { throw 'Session result was not refreshed.' }
  $report = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
  if (-not $report.passed) { throw $report.error }
  if ($phase -eq 'prepare') {
    Copy-Item -LiteralPath (Join-Path $repo "artifacts\code-oss\profiles\$Profile\user-data\User\globalStorage\storage.json") -Destination (Join-Path $qaRoot 'native-startup-state.json')
  }
  "Session $phase passed."
}
