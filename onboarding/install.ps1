#!/usr/bin/env pwsh
# Installs edit-md for the current user, in two places under the Claude config dir:
#   <claude home>/skills/edit-md/SKILL.md   text only — skills/ is what a git-synced harness tracks
#   <claude home>/bin/edit-md/              the binary + browser page (~55 MB) — kept out of skills/
# The skill only — no rules, settings or hooks — and nothing is committed anywhere.
param(
    [string]$ClaudeHome = ($env:CLAUDE_CONFIG_DIR ? $env:CLAUDE_CONFIG_DIR : (Join-Path $HOME '.claude')),
    [string]$ToolHome = '',
    [string]$Rid = [System.Runtime.InteropServices.RuntimeInformation]::RuntimeIdentifier
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$skillSource = Join-Path $PSScriptRoot 'skills' 'edit-md' 'SKILL.md'
$skillsRoot = Join-Path $ClaudeHome 'skills'
$skillTarget = Join-Path $skillsRoot 'edit-md'
if (-not $ToolHome) { $ToolHome = Join-Path $ClaudeHome 'bin' 'edit-md' }

$sdks = @(& dotnet --list-sdks 2>$null)
if (-not ($sdks -match '^10\.')) { throw ".NET 10 SDK required to build edit-md (found: $($sdks -join '; '))" }

# Earlier installs put bin/ inside the skill dir; stop anything running from there and remove it.
$legacyBin = Join-Path $skillTarget 'bin'
if (Test-Path $legacyBin) {
    $legacyRoot = [IO.Path]::GetFullPath($legacyBin)
    Get-Process -Name 'edit-md' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($legacyRoot, [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force
    Start-Sleep -Milliseconds 500
    Remove-Item $legacyBin -Recurse -Force
}

& (Join-Path $repo 'scripts' 'publish.ps1') -Rid $Rid -Out $ToolHome
if ($LASTEXITCODE) { exit $LASTEXITCODE }

# A skills root created now is not watched by an already running session.
$needsReloadSkills = -not (Test-Path $skillsRoot)
New-Item -ItemType Directory -Force $skillTarget | Out-Null
$skillText = Get-Content $skillSource -Raw
$pathInSkill = '$HOME/.claude/bin/edit-md'
if ([IO.Path]::GetFullPath($ToolHome) -ne [IO.Path]::GetFullPath((Join-Path $HOME '.claude' 'bin' 'edit-md'))) {
    $skillText = $skillText.Replace($pathInSkill, [IO.Path]::GetFullPath($ToolHome).Replace('\', '/'))
}
Set-Content -Path (Join-Path $skillTarget 'SKILL.md') -Value $skillText -NoNewline -Encoding utf8NoBOM

$exe = Join-Path $ToolHome ($IsWindows ? 'edit-md.exe' : 'edit-md')

# If the config dir is a git repo, the binary must be ignored there; warn, never edit the user's .gitignore.
$binaryIgnoredByGit = $null
if (Test-Path (Join-Path $ClaudeHome '.git')) {
    & git -C $ClaudeHome check-ignore -q $exe 2>$null
    $binaryIgnoredByGit = $LASTEXITCODE -eq 0
    if (-not $binaryIgnoredByGit) {
        Write-Warning "$ClaudeHome is a git repo that does not ignore $exe — ask the user to ignore it, or reinstall with -ToolHome outside the repo."
    }
}

[pscustomobject]@{
    skill              = $skillTarget
    skillFiles         = @(Get-ChildItem $skillTarget -Recurse -File | ForEach-Object { $_.FullName.Substring($skillTarget.Length + 1) })
    binary             = $exe
    selfCheck          = (& $exe help | Select-Object -First 1)
    binaryIgnoredByGit = $binaryIgnoredByGit
    needsReloadSkills  = $needsReloadSkills
} | ConvertTo-Json
