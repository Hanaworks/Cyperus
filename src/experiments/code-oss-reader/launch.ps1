param(
  [string]$CodePath = 'D:\Microsoft VS Code\Code.exe',
  [string]$OpenFile,
  [string]$OpenFolder,
  [switch]$Test,
  [string]$Profile = 'interactive',
  [int]$DebugPort = 0,
  [string]$SourceRoot
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Profile must be a simple name' }
if (-not (Test-Path -LiteralPath $CodePath -PathType Leaf)) { throw "Code executable not found: $CodePath" }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\webview\main.js'))) { throw 'Run node src/experiments/code-oss-reader/build.mjs first' }
$profileRoot = Join-Path $repo "artifacts\code-oss\profiles\$Profile"
$userDir = Join-Path $profileRoot 'user-data'
$extensionDir = Join-Path $profileRoot 'extensions'
$sharedDir = Join-Path $profileRoot 'shared-data'
New-Item -ItemType Directory -Force -Path (Join-Path $userDir 'User'), $extensionDir | Out-Null
$settingsFile = Join-Path $userDir 'User\settings.json'
& node (Join-Path $PSScriptRoot 'profile.cjs') $settingsFile
if ($LASTEXITCODE -ne 0) { throw 'Reader profile migration failed' }
$restoreArgument = $null
if (-not $OpenFile -and -not $OpenFolder -and -not $Test -and -not $env:MD_READER_PERF_CONFIG) {
  # Cold source-run startup does not take the extension-host relaunch path.
  # Reuse the native saved workspace so its tab and Webview state can restore.
  $nativeStateFile = Join-Path $userDir 'User\globalStorage\storage.json'
  if (Test-Path -LiteralPath $nativeStateFile -PathType Leaf) {
    try {
      $nativeState = Get-Content -LiteralPath $nativeStateFile -Raw | ConvertFrom-Json
      $lastWindow = $nativeState.windowsState.lastPluginDevelopmentHostWindow
      $savedUriText = if ($lastWindow.workspaceIdentifier) { $lastWindow.workspaceIdentifier.configURIPath } else { $lastWindow.folder }
      if ($savedUriText) {
        $savedUri = [uri]$savedUriText
        # VS Code encodes the drive colon (file:///d%3A/...). .NET keeps an
        # extra leading slash for that form, which is not a valid drive path.
        $savedLocalPath = $savedUri.LocalPath
        if ($savedLocalPath -match '^/[a-zA-Z]:[/\\]') { $savedLocalPath = $savedLocalPath.Substring(1) }
        if ($savedUri.IsFile -and -not $savedUri.IsUnc -and (Test-Path -LiteralPath $savedLocalPath)) { $restoreArgument = $savedLocalPath }
      }
    } catch { Write-Warning '上次窗口记录无法读取，将打开空窗口。' }
  }
}
if ($Test) {
  $OpenFolder = Join-Path $repo "artifacts\code-oss\qa\$Profile"
  New-Item -ItemType Directory -Force -Path $OpenFolder | Out-Null
} elseif (-not $OpenFolder -and $OpenFile) { $OpenFolder = Split-Path -Parent ([IO.Path]::GetFullPath($OpenFile)) }
if ($OpenFolder -and -not (Test-Path -LiteralPath $OpenFolder -PathType Container)) { throw 'Workspace folder does not exist' }
$start = [Diagnostics.ProcessStartInfo]::new($CodePath)
$start.UseShellExecute = $false
$start.WorkingDirectory = Split-Path -Parent $CodePath
# These inherited overrides take precedence over explicit CLI profile paths.
foreach ($variable in @('VSCODE_APPDATA', 'VSCODE_PORTABLE', 'VSCODE_EXTENSIONS')) {
  $start.Environment.Remove($variable) | Out-Null
}
if ($SourceRoot) {
  $sourcePath = [IO.Path]::GetFullPath($SourceRoot)
  if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'out\main.js'))) { throw 'Code OSS client has not been built.' }
  $start.ArgumentList.Add($sourcePath)
  $start.Environment['VSCODE_DEV'] = '1'
  $start.Environment['NODE_ENV'] = 'development'
  $start.Environment['MD_READER_EXPECT_APP_ROOT'] = $sourcePath
  $start.WorkingDirectory = $sourcePath
  # The source-run trial builds the client, not the language/debug/test extensions.
  # Preserve declarative themes and grammars; load only our reader's runtime code.
  foreach ($builtin in (Get-ChildItem -LiteralPath (Join-Path $sourcePath 'extensions') -Directory)) {
    $manifestFile = Join-Path $builtin.FullName 'package.json'
    if (-not (Test-Path -LiteralPath $manifestFile)) { continue }
    $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    if ($manifest.main -or $manifest.browser) {
      $start.ArgumentList.Add("--disable-extension=$($manifest.publisher).$($manifest.name)")
    }
  }
}
if ($OpenFile -or $OpenFolder -or $Test -or $env:MD_READER_PERF_CONFIG) { $start.ArgumentList.Add('--new-window') }
foreach ($argument in @("--user-data-dir=$userDir", "--extensions-dir=$extensionDir", "--shared-data-dir=$sharedDir", "--extensionDevelopmentPath=$PSScriptRoot", '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-extension=vscode.git', '--disable-extension=vscode.github-authentication', '--disable-extension=vscode.microsoft-authentication', '--disable-extension=github.copilot', '--disable-extension=github.copilot-chat')) { $start.ArgumentList.Add($argument) }
$start.Environment.Remove('ELECTRON_RUN_AS_NODE') | Out-Null
$start.Environment.Remove('MD_READER_OPEN_FILE') | Out-Null
$start.Environment.Remove('MD_READER_STARTUP_ID') | Out-Null
$start.Environment.Remove('MD_READER_EXPECT_START_FILE') | Out-Null
if ($OpenFolder) { $start.ArgumentList.Add([IO.Path]::GetFullPath($OpenFolder)) }
if ($OpenFile) { $start.ArgumentList.Add([IO.Path]::GetFullPath($OpenFile)) }
if ($restoreArgument) { $start.ArgumentList.Add($restoreArgument) }
if ($Test) {
  $start.ArgumentList.Add("--extensionTestsPath=$(Join-Path $PSScriptRoot 'integration.cjs')")
  $start.Environment['MD_READER_TEST_ROOT'] = Join-Path $repo "artifacts\code-oss\qa\$Profile"
  if ($OpenFile) { $start.Environment['MD_READER_EXPECT_START_FILE'] = [IO.Path]::GetFullPath($OpenFile) }
  $start.Environment.Remove('MD_READER_OPEN_FILE') | Out-Null
}
if ($DebugPort -gt 0) { $start.ArgumentList.Add("--remote-debugging-port=$DebugPort") }
$process = [Diagnostics.Process]::Start($start)
if ($Test) { $process.WaitForExit(); exit $process.ExitCode }
"Reader experiment launched: PID=$($process.Id), profile=$profileRoot"
