# T09 verification script (run after adding 360 trust directories)
#
# Purpose: verify S1 (production build) + S3 (window launch) in one shot.
# Why a script: the check spans multiple steps (build -> check artifact ->
# launch -> probe window -> cleanup). Doing it by hand is easy to get wrong,
# and injecting the cargo PATH is easy to forget.
#
# Usage (from repo root, PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-t09.ps1
#
# NOTE: This script is non-destructive. It only reads files and starts/stops
# its own child process.
#
# IMPORTANT: Keep this file ASCII-only. Windows PowerShell 5.1 misparses
# full-width CJK parentheses and quotes inside string literals (it treats them
# as quote boundaries), which produces bogus syntax errors. The expected window
# title is built from char codes below for the same reason.

$ErrorActionPreference = 'Stop'

# Expected window title, built without literal CJK to stay ASCII-safe.
# U+004D.. = "Markdown" + space + U+9884 U+89C8 (Yu Lan = preview)
$expectedTitle = 'Markdown ' + [char]0x9884 + [char]0x89C8

# ---- 0. Inject cargo into PATH ----
# rustup writes to the *user* PATH, which the current process may not have
# loaded yet. Injecting here makes cargo/tauri visible to child processes.
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) {
    $env:Path = "$cargoBin;$env:Path"
} else {
    Write-Error "cargo not found at $cargoBin -- is Rust installed?"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    # ---- 1. Preflight ----
    Write-Host '===== Preflight =====' -ForegroundColor Cyan

    $rustcOut = (& cmd /c "rustc --version 2>&1") -join ''
    Write-Host "  rustc: $rustcOut"
    if ($rustcOut -notmatch 'rustc \d+\.\d+') {
        Write-Error 'rustc not usable'
    }

    $distIndex = Join-Path $repoRoot 'src\ui\dist\index.html'
    if (-not (Test-Path $distIndex)) {
        Write-Host '  frontend dist missing, building it first' -ForegroundColor Yellow
        & cmd /c "pnpm ui:build"
        if ($LASTEXITCODE -ne 0) { Write-Error 'frontend build failed' }
    }
    Write-Host '  frontend dist: present'

    # ---- 2. S1: production build ----
    Write-Host ''
    Write-Host '===== S1: pnpm tauri build --no-bundle =====' -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & cmd /c "pnpm tauri build --no-bundle"
    $buildExit = $LASTEXITCODE
    $sw.Stop()

    $elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    Write-Host "  exit code: $buildExit   elapsed: ${elapsed}s"

    if ($buildExit -ne 0) {
        Write-Host 'S1 FAIL: build failed' -ForegroundColor Red
        Write-Host 'If the error mentions "os error 5" or "Access is denied",' -ForegroundColor Yellow
        Write-Host '360 Total Security is still blocking. See:' -ForegroundColor Yellow
        Write-Host '  docs/dev/environment-360-blocking.md' -ForegroundColor Yellow
        exit 1
    }

    $exe = Join-Path $repoRoot 'src\host\target\release\md-preview.exe'
    if (-not (Test-Path $exe)) {
        Write-Host "S1 FAIL: artifact missing at $exe" -ForegroundColor Red
        exit 1
    }
    $exeSize = [math]::Round((Get-Item $exe).Length / 1MB, 2)
    Write-Host "  S1 PASS: artifact present (${exeSize} MB)" -ForegroundColor Green

    # ---- 3. S3: launch and probe the window ----
    Write-Host ''
    Write-Host '===== S3: launch and probe window =====' -ForegroundColor Cyan

    $proc = Start-Process -FilePath $exe -PassThru
    Write-Host "  launched PID=$($proc.Id), polling for window title..."

    # Poll instead of a fixed sleep: more reliable on cold starts.
    $title = ''
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $proc.Refresh()
        if ($proc.HasExited) { break }
        if ($proc.MainWindowTitle) {
            $title = $proc.MainWindowTitle
            break
        }
    }

    $proc.Refresh()
    $alive = -not $proc.HasExited

    Write-Host "  process alive: $alive"
    Write-Host "  window title : [$title]"

    # Cleanup runs regardless of outcome.
    if ($alive) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Write-Host "  closed PID=$($proc.Id)"
    }

    # ---- 4. Verdict ----
    Write-Host ''
    Write-Host '===== Verdict =====' -ForegroundColor Cyan

    $s3Pass = $alive -and ($title -eq $expectedTitle)
    if ($s3Pass) {
        Write-Host '  S1 PASS  S3 PASS' -ForegroundColor Green
        Write-Host '  T09 fully verified.' -ForegroundColor Green
        exit 0
    }

    Write-Host '  S1 PASS  S3 FAIL' -ForegroundColor Red
    if (-not $alive) {
        Write-Host '  Process exited early. Use a debug build to see stderr:' -ForegroundColor Yellow
        Write-Host '    cargo build --manifest-path src/host/Cargo.toml' -ForegroundColor Yellow
        Write-Host '    .\src\host\target\debug\md-preview.exe' -ForegroundColor Yellow
    } else {
        Write-Host "  Title mismatch: expected [$expectedTitle], got [$title]" -ForegroundColor Yellow
        Write-Host '  Check app.windows[0].title in src/host/tauri.conf.json' -ForegroundColor Yellow
    }
    exit 1
} finally {
    Pop-Location
}
