#!/usr/bin/env pwsh
# Self-contained single-file edit-md for one RID, client beside it. onboarding/install.ps1 points -Out at the user's ~/.claude/bin/edit-md.
param(
    [string]$Rid = [System.Runtime.InteropServices.RuntimeInformation]::RuntimeIdentifier,
    [string]$Out = (Join-Path $PSScriptRoot '..' 'dist' $Rid)
)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot '..' 'src' 'LalamoMado' 'LalamoMado.csproj'

# A running server (or a backgrounded `wait`) locks the binary: shut servers down gracefully, then the rest.
$target = Join-Path ([IO.Path]::GetFullPath($Out)) ($IsWindows ? 'edit-md.exe' : 'edit-md')
$running = @(Get-Process -Name 'edit-md' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target })
if ($running.Count -gt 0) {
    $stateRoots = @($env:EDIT_MD_HOME, (Join-Path ([IO.Path]::GetTempPath()) 'edit-md')) | Where-Object { $_ -and (Test-Path $_) }
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

dotnet publish $project -c Release -r $Rid --self-contained `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=None `
    -o $Out
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "edit-md ($Rid) published to $(Resolve-Path $Out)"
