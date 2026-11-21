# Builds the Tauri MSI for Tervixa Wiggle.
#
# Produces releases\<productName>_<version>_x64_en-US.msi containing the same
# runtime payload as the Setup.exe: the bundled Node runtime, the gateway, the
# built workbench UI and the catalogs.
#
# Requirements:
#   - Rust (x86_64-pc-windows-gnu or -msvc toolchain)
#   - a matching MinGW toolchain for the gnu target. On a gnu host, windres and
#     gcc must come from the SAME installation, otherwise windres fails with
#     "cannot execute 'cc1'". This script prepends W64DEVKIT so that holds.
#   - WiX toolset; the Tauri bundler downloads it automatically on first run.
#
# Sequence: stage the payload -> build the UI -> build the MSI.
# The beforeBuildCommand hook in tauri.conf.json is intentionally absent: Tauri
# runs hooks from the repository root, which makes crate-relative paths fragile.

param(
    [string]$Version = '1.0.0',
    [string]$W64Devkit = 'C:\Users\Remya\w64devkit'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$mingwBin = Join-Path $W64Devkit 'bin'
if (Test-Path (Join-Path $mingwBin 'windres.exe')) {
    $env:PATH = "$mingwBin;$env:PATH"
} else {
    Write-Host "warning: $mingwBin not found; relying on the MinGW already on PATH" -ForegroundColor Yellow
}

Write-Host '[1/3] Building the workbench UI'
npm run build

Write-Host '[2/3] Staging the runtime payload for the MSI'
if (-not (Test-Path 'packaging\stage\app')) {
    throw 'packaging/stage is missing. Run scripts/build-installer.ps1 first, or stage the payload manually.'
}
node scripts/stage-tauri.mjs

Write-Host '[3/3] Building the MSI'
Push-Location 'crates\wiggle-desktop'
try {
    # Tauri writes progress to stderr; with ErrorActionPreference=Stop that becomes a
    # terminating NativeCommandError even on success, so relax it for this call and
    # rely on the exit code instead.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & (Join-Path $repo 'node_modules\.bin\tauri.cmd') build 2>&1 | Tee-Object -FilePath (Join-Path $repo 'packaging\tauri-build.log')
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    if ($code -ne 0) { throw "tauri build failed with exit code $code" }
} finally {
    Pop-Location
}

$msi = Get-ChildItem 'target\release\bundle\msi' -Filter '*.msi' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msi) { throw 'The MSI was not produced.' }

New-Item -ItemType Directory -Force -Path 'releases' | Out-Null
Copy-Item $msi.FullName (Join-Path $repo 'releases') -Force
$out = Join-Path $repo ('releases\' + $msi.Name)
Write-Host ("Done: {0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
