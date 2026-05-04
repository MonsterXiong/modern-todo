param(
  [string]$KeyPath = "$HOME\.modern-todo-updater.key",
  [string]$PasswordPath = "$HOME\.modern-todo-updater.password.txt",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }

  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Read-Text {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function New-SecretPassword {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return [Convert]::ToBase64String($bytes)
}

$publicKeyPath = "$KeyPath.pub"

if ($Force -or -not (Test-Path -LiteralPath $KeyPath)) {
  $password = New-SecretPassword
  Write-Utf8NoBom -Path $PasswordPath -Value $password

  $signerArgs = @(
    "tauri",
    "signer",
    "generate",
    "--ci",
    "--password",
    $password,
    "--write-keys",
    $KeyPath
  )

  if ($Force) {
    $signerArgs += "--force"
  }

  & npx @signerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri signer failed with exit code $LASTEXITCODE."
  }
} elseif (-not (Test-Path -LiteralPath $PasswordPath)) {
  throw "Private key already exists at $KeyPath, but password file is missing at $PasswordPath."
}

if (-not (Test-Path -LiteralPath $publicKeyPath)) {
  throw "Public key file was not found: $publicKeyPath"
}

$publicKey = (Read-Text -Path $publicKeyPath).Trim()

Write-Host ""
Write-Host "Updater secrets are ready."
Write-Host ""
Write-Host "TAURI_UPDATER_PUBKEY:"
Write-Host $publicKey
Write-Host ""
Write-Host "TAURI_SIGNING_PRIVATE_KEY: use the full content of $KeyPath"
Write-Host "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: use the full content of $PasswordPath"
Write-Host ""
