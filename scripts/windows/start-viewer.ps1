param(
    [ValidateSet('5.1', '6.0')]
    [string]$IsaacVersion = '6.0',
    [switch]$Minimal,
    [string]$IsaacRoot = $env:ISAAC_ROOT,
    [string]$PublicIp = $(if ($env:ISAAC_HOST) { $env:ISAAC_HOST } else { '127.0.0.1' }),
    [int]$ActiveGpu = $(if ($env:ACTIVE_GPU) { [int]$env:ACTIVE_GPU } else { 0 }),
    [int]$SignalPort = 49100,
    [int]$StreamPort = 47998
)

$ErrorActionPreference = 'Stop'

if ($IsaacVersion -eq '5.1' -and $Minimal) {
    throw 'The minimal experience is available only for Isaac Sim 6.0.x.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $IsaacRoot) {
    $candidates = if ($IsaacVersion -eq '5.1') {
        @('C:\Nvidia\isaac-sim-standalone-5.1.0-windows-x86_64')
    }
    else {
        @(
            'C:\Nvidia\isaac-sim-standalone-6.0.2-windows-x86_64',
            'C:\Nvidia\isaac-sim-standalone-6.0.1-windows-x86_64',
            'C:\Nvidia\isaac-sim-standalone-6.0.0-windows-x86_64'
        )
    }
    $IsaacRoot = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'kit\kit.exe') } | Select-Object -First 1
}

if (-not $IsaacRoot -or -not (Test-Path -LiteralPath (Join-Path $IsaacRoot 'kit\kit.exe'))) {
    throw 'Isaac Sim Kit was not found. Pass -IsaacRoot or set the ISAAC_ROOT environment variable.'
}

$experienceName = if ($IsaacVersion -eq '5.1') {
    'ov.web.viewer.5.1.kit'
}
elseif ($Minimal) {
    'ov.web.viewer.6.0.minimal.kit'
}
else {
    'ov.web.viewer.6.0.kit'
}

$experience = Join-Path $projectRoot "kit\apps\$experienceName"
$extensionFolder = Join-Path $projectRoot 'kit\exts'

# Overwolf may install Vulkan overlay layers system-wide. Disable them only for this Kit process.
$env:DISABLE_VULKAN_OW_OVERLAY_LAYER = '1'
$env:DISABLE_VULKAN_OW_OBS_CAPTURE = '1'

$displayState = & nvidia-smi --id=$ActiveGpu --query-gpu=display_attached,display_active --format=csv,noheader
if ($LASTEXITCODE -ne 0) {
    throw "Unable to query NVIDIA GPU $ActiveGpu."
}
if ($displayState -notmatch 'Yes, Enabled') {
    throw "GPU $ActiveGpu must have an attached, active display or dummy plug. Current state: $displayState"
}

$arguments = @($experience, '--no-window', '--ext-folder', $extensionFolder)
foreach ($folder in @('apps', 'exts', 'extscache', 'extsUser', 'extsDeprecated')) {
    $path = Join-Path $IsaacRoot $folder
    if (Test-Path -LiteralPath $path) {
        $arguments += @('--ext-folder', $path)
    }
}
$arguments += "--/renderer/activeGpu=$ActiveGpu"
$arguments += '--/log/flushStandardStreamOutput=1'

if ($IsaacVersion -eq '5.1') {
    $arguments += "--/app/livestream/port=$SignalPort"
}
else {
    $arguments += "--/exts/omni.kit.livestream.app/primaryStream/publicIp=$PublicIp"
    $arguments += "--/exts/omni.kit.livestream.app/primaryStream/signalPort=$SignalPort"
    $arguments += "--/exts/omni.kit.livestream.app/primaryStream/streamPort=$StreamPort"
}

Write-Host "Starting $experienceName"
Write-Host "  Isaac root: $IsaacRoot"
Write-Host "  GPU:        $ActiveGpu"
Write-Host "  Host/IP:    $PublicIp"

& (Join-Path $IsaacRoot 'kit\kit.exe') @arguments @args
exit $LASTEXITCODE
