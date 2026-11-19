param([Parameter(Mandatory)][string]$PackageRoot, [string]$Profile = 'portable-qa-20261111', [switch]$LegacyAgentsFlag, [ValidateSet('en', 'zh-cn')][string]$DisplayLanguage)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^portable-[a-zA-Z0-9_-]+$') { throw 'Portable QA needs a dedicated profile.' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$package = [IO.Path]::GetFullPath($PackageRoot)
$appRoot = Join-Path $package 'resources\app'
$code = Join-Path $package 'Cyperus.exe'
if (-not (Test-Path -LiteralPath $code -PathType Leaf)) { throw 'Candidate executable is missing.' }
$qaRoot = Join-Path $repo "artifacts\code-oss\qa\$Profile"
$profileRoot = Join-Path $repo "artifacts\code-oss\profiles\$Profile"
$userData = Join-Path $profileRoot 'user-data'
New-Item -ItemType Directory -Force -Path $qaRoot, (Join-Path $userData 'User'), (Join-Path $profileRoot 'extensions') | Out-Null
Copy-Item -LiteralPath (Join-Path $package 'data\user-data\User\settings.json') -Destination (Join-Path $userData 'User\settings.json')
if ($DisplayLanguage) {
  @{ locale = $DisplayLanguage } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $profileRoot 'argv.json')
}
$start = [Diagnostics.ProcessStartInfo]::new($code)
$start.UseShellExecute = $false
$start.WorkingDirectory = $package
foreach ($key in @($start.Environment.Keys)) {
  if ($key -like 'VSCODE_*' -or $key -like 'MD_READER_*' -or $key -in @('ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','NODE_ENV')) { $start.Environment.Remove($key) | Out-Null }
}
$start.Environment['MD_READER_TEST_ROOT'] = $qaRoot
$start.Environment['MD_READER_EXPECT_APP_ROOT'] = $appRoot
$start.Environment['VSCODE_PORTABLE'] = $profileRoot
if ($DisplayLanguage) { $start.Environment['MD_READER_EXPECT_LANGUAGE'] = $DisplayLanguage }
$startupFile = Join-Path $qaRoot 'startup.md'
Set-Content -LiteralPath $startupFile -Value '# Portable startup preview'
$start.Environment['MD_READER_EXPECT_START_FILE'] = $startupFile
# Portable data takes precedence over CLI data paths. Override it explicitly
# for QA so the distributable's pristine data directory remains untouched.
foreach ($argument in @('--new-window', "--user-data-dir=$userData", "--extensions-dir=$(Join-Path $profileRoot 'extensions')", "--shared-data-dir=$(Join-Path $profileRoot 'shared-data')", "--extensionDevelopmentPath=$(Join-Path $appRoot 'extensions\md-reader')", "--extensionTestsPath=$(Join-Path $PSScriptRoot 'integration.cjs')", '--skip-welcome', '--skip-release-notes', $qaRoot, $startupFile)) { $start.ArgumentList.Add($argument) }
if ($LegacyAgentsFlag) { $start.ArgumentList.Add('--agents') }
$process = [Diagnostics.Process]::Start($start)
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "Candidate integration failed: $($process.ExitCode)" }
$report = Get-Content -LiteralPath (Join-Path $qaRoot 'result.json') -Raw | ConvertFrom-Json
if (-not $report.passed) { throw $report.error }
$runtimeErrors = Get-ChildItem -LiteralPath (Join-Path $userData 'logs') -Filter '*.log' -Recurse | Select-String -Pattern '\[error\]'
if ($runtimeErrors) { throw "Candidate runtime errors: $($runtimeErrors.Line -join ' | ')" }
"Candidate integration passed: $($report.checks.Count) checks."
