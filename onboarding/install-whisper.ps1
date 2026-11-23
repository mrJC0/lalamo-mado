#!/usr/bin/env pwsh
# Opt-in local dictation (plan 09): Whisper models, and NVIDIA's CUDA 12 runtime DLLs where an NVIDIA GPU is present, into <ToolHome>/whisper/.
# Run only after the user said yes during onboarding; install.ps1 never runs it. Every download is SHA-256 checked; a file already there and matching is kept.
param(
    [string]$ToolHome = (Join-Path ($env:CLAUDE_CONFIG_DIR ? $env:CLAUDE_CONFIG_DIR : (Join-Path $HOME '.claude')) 'bin' 'edit-md'),
    [switch]$LargeV3,
    [switch]$CpuOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$whisper = Join-Path $ToolHome 'whisper'
$models = Join-Path $whisper 'models'
$cuda = Join-Path $whisper 'cuda12'
$downloads = Join-Path ([IO.Path]::GetTempPath()) 'edit-md-whisper'
New-Item -ItemType Directory -Force $models, $downloads | Out-Null

function Get-Verified([string]$Url, [string]$Path, [string]$Sha256) {
    if ((Test-Path $Path) -and (Get-FileHash $Path -Algorithm SHA256).Hash -eq $Sha256) { return 'kept' }
    Invoke-WebRequest $Url -OutFile "$Path.part"
    if ((Get-FileHash "$Path.part" -Algorithm SHA256).Hash -ne $Sha256) {
        Remove-Item "$Path.part"
        throw "SHA-256 mismatch for $Url"
    }
    Move-Item -Force "$Path.part" $Path
    return 'downloaded'
}

$hf = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
$wanted = @(@{ File = 'ggml-large-v3-turbo-q8_0.bin'; Sha256 = '317EB69C11673C9DE1E1F0D459B253999804EC71AC4C23C17ECF5FBE24E259A1' })
if ($LargeV3) { $wanted += @{ File = 'ggml-large-v3-q5_0.bin'; Sha256 = 'D75795ECFF3F83B5FAA89D1900604AD8C780ABD5739FAE406DE19F23ECD98AD1' } }
$modelResults = foreach ($model in $wanted) {
    [pscustomobject]@{ model = $model.File; result = Get-Verified "$hf/$($model.File)" (Join-Path $models $model.File) $model.Sha256 }
}

$gpu = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object Name -match 'NVIDIA' | ForEach-Object Name) | Select-Object -First 1
$cudaResult = 'skipped: no NVIDIA GPU, Local runs on the CPU (slow)'
if ($CpuOnly) { $cudaResult = 'skipped: -CpuOnly' }
elseif ($gpu) {
    # CUDA 12.9 needs an NVIDIA driver of 576 or newer; an older one makes Local fall back to the CPU.
    $nvidia = 'https://developer.download.nvidia.com/compute/cuda/redist'
    $archives = @(
        @{ Url = "$nvidia/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-12.9.79-archive.zip"; Sha256 = '179E9C43B0735FFE67207B3DA556EB5A0C50F3047961882B7657D3B822D34EF8'; Dlls = @('cudart64_12.dll') }
        @{ Url = "$nvidia/libcublas/windows-x86_64/libcublas-windows-x86_64-12.9.1.4-archive.zip"; Sha256 = 'D534D98B0B453A98914DBF3ADF47D7E84B55037ABF02F87466439E1DCEF581ED'; Dlls = @('cublas64_12.dll', 'cublasLt64_12.dll') }
    )
    New-Item -ItemType Directory -Force $cuda | Out-Null
    foreach ($archive in $archives) {
        $zip = Join-Path $downloads (Split-Path $archive.Url -Leaf)
        if ($archive.Dlls | Where-Object { -not (Test-Path (Join-Path $cuda $_)) }) {
            Get-Verified $archive.Url $zip $archive.Sha256 | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $opened = [IO.Compression.ZipFile]::OpenRead($zip)
            try {
                foreach ($entry in $opened.Entries | Where-Object { $_.Name -in $archive.Dlls -or $_.Name -eq 'LICENSE' }) {
                    $target = Join-Path $cuda ($entry.Name -eq 'LICENSE' ? "LICENSE-$((Split-Path $archive.Url -Leaf).Split('-')[0]).txt" : $entry.Name)
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
                }
            }
            finally { $opened.Dispose() }
        }
    }
    $cudaResult = "installed for $gpu"
}
Remove-Item $downloads -Recurse -Force -ErrorAction SilentlyContinue

[pscustomobject]@{
    whisper = $whisper
    models  = @($modelResults)
    cuda    = $cudaResult
    next    = 'Reload the review page: a Chrome / Local badge appears beside CZ/EN, and the settings (gear) hold the engine and the model.'
} | ConvertTo-Json -Depth 3
