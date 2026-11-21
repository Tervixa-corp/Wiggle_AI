# Builds the self-contained Tervixa Wiggle Windows installer.
#
# Produces releases\Tervixa-Wiggle-<version>-Setup.exe containing:
#   - the bundled Node runtime (no Node needed on the target machine)
#   - the full agent gateway (server/)
#   - the built workbench UI
#   - the provider, plugin and connector catalogs
#   - a native WebView2 desktop window (C# launcher, no browser involved)
#
# Requirements: Node 20+, the .NET Framework csc compiler (present on Windows),
# NSIS (makensis) and network access the first time to fetch the WebView2 SDK.

param(
    [string]$Version = '1.0.0'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$stage = Join-Path $repo 'packaging\stage'
$webview = Join-Path $repo 'packaging\webview2'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

Write-Host '[1/6] Building the workbench UI'
npm run build

Write-Host '[2/6] Staging the runtime payload'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$stage\app\apps\desktop-ui", "$stage\node" | Out-Null
Copy-Item 'server' "$stage\app\server" -Recurse -Force
Copy-Item 'apps\desktop-ui\dist' "$stage\app\apps\desktop-ui\dist" -Recurse -Force
Copy-Item 'catalog' "$stage\app\catalog" -Recurse -Force
Copy-Item 'bundled-skills' "$stage\app\bundled-skills" -Recurse -Force
Copy-Item 'LICENSE' "$stage\app\LICENSE" -Force
Copy-Item 'README.md' "$stage\app\README.md" -Force
Copy-Item 'crates\wiggle-desktop\icons\icon.ico' "$stage\icon.ico" -Force

$nodeExe = (Get-Command node).Source
Copy-Item $nodeExe "$stage\node\node.exe" -Force
$nodeLicense = Join-Path (Split-Path -Parent $nodeExe) 'LICENSE'
if (Test-Path $nodeLicense) { Copy-Item $nodeLicense "$stage\node\LICENSE" -Force }

@'
{
  "name": "tervixa-wiggle",
  "version": "1.0.0",
  "private": true,
  "description": "Tervixa Wiggle runtime bundle",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.32.2"
  }
}
'@ | Set-Content "$stage\app\package.json" -Encoding UTF8

Write-Host '[3/6] Installing production dependencies'
Push-Location "$stage\app"
try {
    npm install --omit=dev --ignore-scripts --no-audit --no-fund | Out-Null
} finally {
    Pop-Location
}

Write-Host '[4/6] Fetching the WebView2 SDK'
if (-not (Test-Path (Join-Path $webview 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    $index = Invoke-RestMethod 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json'
    $stable = $index.versions | Where-Object { $_ -notmatch '-' }
    $ver = $stable[-1]
    $pkg = Join-Path $repo 'packaging\webview2.nupkg'
    $zip = Join-Path $repo 'packaging\webview2.zip'
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$ver/microsoft.web.webview2.$ver.nupkg" -OutFile $pkg
    Copy-Item $pkg $zip -Force
    Expand-Archive -Path $zip -DestinationPath $webview -Force
}

Write-Host '[5/6] Compiling the native launcher'
$ref = Join-Path $webview 'lib\net462'
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    "/out:$stage\Tervixa Wiggle.exe" `
    "/win32icon:$stage\icon.ico" `
    "/reference:$ref\Microsoft.Web.WebView2.Core.dll" `
    "/reference:$ref\Microsoft.Web.WebView2.WinForms.dll" `
    /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    'packaging\launcher\Launcher.cs'
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

Copy-Item "$ref\Microsoft.Web.WebView2.Core.dll" "$stage\" -Force
Copy-Item "$ref\Microsoft.Web.WebView2.WinForms.dll" "$stage\" -Force
Copy-Item (Join-Path $webview 'runtimes\win-x64\native\WebView2Loader.dll') "$stage\" -Force

Write-Host '[6/6] Building the installer'
$makensis = (Get-Command makensis -ErrorAction SilentlyContinue).Source
if (-not $makensis) { throw 'makensis was not found on PATH. Install NSIS or add its bin directory to PATH.' }

Push-Location (Join-Path $repo 'packaging')
try {
    & $makensis "/DAPP_VERSION=$Version" 'wiggle.nsi'
    if ($LASTEXITCODE -ne 0) { throw "makensis failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$out = Join-Path $repo "releases\Tervixa-Wiggle-$Version-Setup.exe"
if (-not (Test-Path $out)) { throw 'The installer was not produced.' }
Write-Host ("Done: {0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
