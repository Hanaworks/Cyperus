param(
  [ValidateSet('Check', 'Install', 'Build', 'Electron')][string]$Stage = 'Check',
  [ValidateSet('Preview', 'Default')][string]$Toolchain = 'Preview'
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$trial = Join-Path $repo 'artifacts\code-oss'
$upstream = Join-Path $trial 'upstream'
$nodeRoot = Join-Path $trial 'tools\node-v24.22.1-win-x64'
$nodeExe = Join-Path $nodeRoot 'node.exe'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$visualStudio = & $vswhere -latest -products '*' -property installationPath
if (-not $visualStudio) { throw 'No Visual Studio toolchain was found. System installation requires separate user approval.' }
$msvcRoot = Join-Path $visualStudio 'VC\Tools\MSVC'
$versionFile = if ($Toolchain -eq 'Preview') { 'Microsoft.VCToolsVersion.Preview.txt' } else { 'Microsoft.VCToolsVersion.default.txt' }
$selectedVersion = (Get-Content -LiteralPath (Join-Path $visualStudio "VC\Auxiliary\Build\$versionFile") -Raw).Trim()
$msvc = Get-Item -LiteralPath (Join-Path $msvcRoot $selectedVersion)
if (-not $msvc) { throw 'C++ toolchain missing.' }
$missing = @('lib\spectre\x64', 'atlmfc\lib\spectre\x64') | Where-Object { -not (Test-Path -LiteralPath (Join-Path $msvc.FullName $_)) }
if ($missing.Count) { throw "C++ Spectre / ATL / MFC libraries missing under $($msvc.FullName). No system components are installed by this script." }
if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Project-local Node 24.22.1 is missing.' }
$upstreamHead = & git -C $upstream rev-parse HEAD
if ($upstreamHead -ne '6bab64e2d12b04d04c0d99c27ff166023efd1dda') { throw "Unexpected upstream revision: $upstreamHead" }
$runtimeVersion = & $nodeExe --version
if ($runtimeVersion -ne 'v24.22.1') { throw "Unexpected build Node: $runtimeVersion" }
if ($Stage -eq 'Check') { "Toolchain ready: Code OSS 1.145.1; Node $runtimeVersion; MSVC $($msvc.Name) ($Toolchain)"; exit 0 }

# Environment changes are restricted to this build process and its children.
$env:PATH = "$nodeRoot;$env:PATH"
$env:vs2026_install = $visualStudio
$env:VCToolsVersion = $selectedVersion
$env:npm_config_python = 'C:\Users\Mana\AppData\Local\Python\pythoncore-3.14-64\python.exe'
$env:npm_config_cache = Join-Path $trial 'cache\npm'
$env:npm_config_devdir = Join-Path $trial 'cache\local\node-gyp\Cache'
$env:LOCALAPPDATA = Join-Path $trial 'cache\local'
$env:APPDATA = Join-Path $trial 'cache\roaming'
$env:ELECTRON_CACHE = Join-Path $trial 'cache\electron'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $trial 'cache\playwright'
$sdkRoot = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction SilentlyContinue).KitsRoot10
if ($sdkRoot) { $env:MD_READER_WINDOWS_SDK_BIN = (Join-Path $sdkRoot 'bin') + [IO.Path]::DirectorySeparatorChar }
$env:NODE_OPTIONS = '--dns-result-order=ipv4first'
# Node downloaders do not automatically inherit the Windows proxy. Reuse it only
# for this build process; explicit proxy environment variables take precedence.
if (-not $env:HTTPS_PROXY) {
  $proxyProbe = [uri]'https://api.github.com'
  $systemProxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($proxyProbe)
  if ($systemProxy -and $systemProxy.AbsoluteUri -ne $proxyProbe.AbsoluteUri) {
    $env:HTTPS_PROXY = $systemProxy.AbsoluteUri
    if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = $systemProxy.AbsoluteUri }
  }
}
if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) { $env:NODE_OPTIONS += ' --use-env-proxy' }
Push-Location $upstream
try {
  if ($Stage -eq 'Install') {
    & (Join-Path $nodeRoot 'npm.cmd') ci --no-audit --no-fund --foreground-scripts
  } elseif ($Stage -eq 'Electron') {
    & (Join-Path $nodeRoot 'npm.cmd') run electron
  } else {
    & (Join-Path $nodeRoot 'npm.cmd') run build-fast -- --client-only
  }
  if ($LASTEXITCODE -ne 0) { throw "Code OSS $Stage failed ($LASTEXITCODE)." }
} finally { Pop-Location }
