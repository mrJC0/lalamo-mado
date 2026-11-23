#!/usr/bin/env pwsh
# Self-contained single-file edit-md for one RID, client beside it. onboarding/install.ps1 points -Out at the user's ~/.claude/bin/edit-md,
# scripts/deploy-dev.ps1 at ~/.claude/bin/edit-md-dev with -Channel dev (plan 19).
param(
    [string]$Rid = [System.Runtime.InteropServices.RuntimeInformation]::RuntimeIdentifier,
    [string]$Out = (Join-Path $PSScriptRoot '..' 'dist' $Rid),
    [ValidateSet('release', 'dev')][string]$Channel = 'release'
)
$ErrorActionPreference = 'Stop'
$repo = Join-Path $PSScriptRoot '..'
$project = Join-Path $repo 'src' 'LalamoMado' 'LalamoMado.csproj'
$homeName = $Channel -eq 'dev' ? 'edit-md-dev' : 'edit-md'

# A running server (or a backgrounded `wait`) locks the binary: shut servers down gracefully, then the rest.
$target = Join-Path ([IO.Path]::GetFullPath($Out)) ($IsWindows ? 'edit-md.exe' : 'edit-md')
$running = @(Get-Process -Name 'edit-md' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target })
if ($running.Count -gt 0) {
    $stateRoots = @($env:EDIT_MD_HOME, (Join-Path ([IO.Path]::GetTempPath()) $homeName)) | Where-Object { $_ -and (Test-Path $_) }
    $states = $stateRoots | ForEach-Object { Get-ChildItem $_ -Recurse -Filter 'server.json' -ErrorAction SilentlyContinue } |
        ForEach-Object { try { Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { } }
    foreach ($state in $states | Where-Object { $_.pid -in $running.Id }) {
        try { Invoke-RestMethod -Method Post -Uri "$($state.url)/api/shutdown" -TimeoutSec 3 | Out-Null } catch { }
    }
    foreach ($process in $running) {
        if (-not $process.WaitForExit(5000)) { Stop-Process -Id $process.Id -Force }
    }
    Write-Host "Stopped $($running.Count) running edit-md process(es) so the binary can be replaced."
}

$commit = (& git -C $repo describe --always --dirty --abbrev=7 --exclude '*' 2>$null)
if ($LASTEXITCODE) { $commit = '' }

dotnet publish $project -c Release -r $Rid --self-contained `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=None `
    -p:EditMdChannel=$Channel `
    -p:EditMdCommit=$commit `
    -o $Out
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "edit-md ($Rid, $Channel, $($commit ? $commit : 'no commit')) published to $(Resolve-Path $Out)"
