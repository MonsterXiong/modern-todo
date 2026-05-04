param(
  [ValidateSet("debug", "release")]
  [string]$BuildProfile = "release",
  [switch]$SkipInstall,
  [switch]$CleanInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$rustRoot = "D:\development\rust"
$cargoHome = Join-Path $rustRoot "cargo"
$rustupHome = Join-Path $rustRoot "rustup"

if (!(Test-Path (Join-Path $cargoHome "bin\cargo.exe"))) {
  throw "Cargo not found at $cargoHome. Install Rust with CARGO_HOME=$cargoHome and RUSTUP_HOME=$rustupHome."
}

$env:CARGO_HOME = $cargoHome
$env:RUSTUP_HOME = $rustupHome
$env:Path = (Join-Path $cargoHome "bin") + ";" + $env:Path

Get-Process -Name "modern-todo-desktop" -ErrorAction SilentlyContinue | ForEach-Object {
  if (!$_.CloseMainWindow()) {
    $_ | Stop-Process -Force
  }
}
Start-Sleep -Milliseconds 500
Get-Process -Name "modern-todo-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

if (!$SkipInstall) {
  if ($CleanInstall) {
    Invoke-Checked npm ci
  } else {
    Invoke-Checked npm install
  }
}

Invoke-Checked npm test
Invoke-Checked npm run build

if ($BuildProfile -eq "debug") {
  Invoke-Checked npm run tauri "--" build "--debug"
  $bundleRoot = Join-Path $repoRoot "src-tauri\target\debug\bundle"
} else {
  Invoke-Checked npm run tauri "--" build
  $bundleRoot = Join-Path $repoRoot "src-tauri\target\release\bundle"
}

Write-Host ""
Write-Host "Package complete." -ForegroundColor Green
Write-Host "Bundles:"
$nsisRoot = Join-Path $bundleRoot "nsis"
$artifacts = Get-ChildItem $nsisRoot -File -Filter "*.exe"

$packageJson = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$releaseDir = Join-Path $repoRoot ("release\v" + $packageJson.version + "\" + $BuildProfile)
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$checksums = @()
foreach ($artifact in $artifacts) {
  $destination = Join-Path $releaseDir $artifact.Name
  Copy-Item -LiteralPath $artifact.FullName -Destination $destination -Force
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $destination
  $checksums += "$($hash.Hash.ToLowerInvariant())  $($artifact.Name)"
}

$checksums | Set-Content -Encoding UTF8 (Join-Path $releaseDir "SHA256SUMS.txt")
$artifacts | Select-Object FullName, Length

Write-Host ""
Write-Host "Release folder:"
Write-Host $releaseDir
