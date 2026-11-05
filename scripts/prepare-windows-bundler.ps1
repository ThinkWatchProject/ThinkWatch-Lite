# Tauri CLI 2.12.1 pins NSIS 3.11 and nsis-tauri-utils 0.5.3. Prepare
# its normal cache before compiling: its built-in downloader does not retry
# HTTP 504s, otherwise a failed tool download wastes the complete build.
# SHA-256 pins were checked against the SHA-1 constants in the CLI source.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This script prepares the Windows NSIS toolchain' }

function Get-CheckedTool {
    param([string]$Url, [string]$Destination, [string]$Sha256)
    # Use the official release URL. The query prevents reuse of an expired
    # cached redirect; the pinned digest still authenticates the bytes.
    $downloadUrl = "${Url}?download=1&sha256=$Sha256"
    & curl.exe --fail --location --retry 5 --retry-all-errors --retry-delay 2 `
        --connect-timeout 15 --max-time 120 --output $Destination $downloadUrl
    if ($LASTEXITCODE -ne 0) { throw "Cannot download $Url" }
    $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) { throw "SHA-256 mismatch for $Url" }
}

$stage = Join-Path $env:RUNNER_TEMP ("tw-nsis-" + [guid]::NewGuid().ToString('N'))
$bundleToolsRoot = Join-Path $env:LOCALAPPDATA 'tauri'
$nsisRoot = Join-Path $bundleToolsRoot 'NSIS'
New-Item -ItemType Directory -Force $stage | Out-Null
try {
    $archive = Join-Path $stage 'nsis.zip'
    $plugin = Join-Path $stage 'nsis_tauri_utils.dll'
    Get-CheckedTool `
        -Url 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip' `
        -Destination $archive -Sha256 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1'
    Get-CheckedTool `
        -Url 'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll' `
        -Destination $plugin -Sha256 '5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709'
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    $prepared = Join-Path $stage 'nsis-3.11'
    $plugins = Join-Path $prepared 'Plugins/x86-unicode/additional'
    New-Item -ItemType Directory -Force $plugins | Out-Null
    Copy-Item -LiteralPath $plugin -Destination (Join-Path $plugins 'nsis_tauri_utils.dll')
    New-Item -ItemType Directory -Force $bundleToolsRoot | Out-Null
    if (Test-Path -LiteralPath $nsisRoot) { Remove-Item -LiteralPath $nsisRoot -Recurse -Force }
    Move-Item -LiteralPath $prepared -Destination $nsisRoot
    Write-Host "Verified NSIS 3.11 and nsis-tauri-utils 0.5.3 in $nsisRoot"
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
