param([string]$OpenFile, [string]$OpenFolder, [switch]$Test, [string]$Profile = 'code-oss')
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$source = Join-Path $repo 'artifacts\code-oss\upstream'
$code = Join-Path $source '.build\electron\Cyperus.exe'
if (-not (Test-Path -LiteralPath $code -PathType Leaf)) { $code = Join-Path $source '.build\electron\Markdown Reader Lab.exe' }
& (Join-Path $PSScriptRoot 'launch.ps1') -CodePath $code -SourceRoot $source -OpenFile $OpenFile -OpenFolder $OpenFolder -Test:$Test -Profile $Profile
exit $LASTEXITCODE
