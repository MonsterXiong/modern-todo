param(
  [string]$Repo,
  [string]$KeyPath = "$HOME\.modern-todo-updater.key",
  [string]$PasswordPath = "$HOME\.modern-todo-updater.password.txt",
  [switch]$ConfigureGitHub,
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

function Resolve-GitHubRepo {
  param([string]$ExplicitRepo)

  if ($ExplicitRepo) {
    return $ExplicitRepo
  }

  $remote = git remote get-url origin 2>$null
  if (-not $remote) {
    throw "Cannot resolve GitHub repository. Pass -Repo owner/name."
  }

  if ($remote -match "github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)(?:\.git)?$") {
    return "$($Matches.owner)/$($Matches.repo)"
  }

  throw "Cannot parse GitHub repository from origin remote: $remote. Pass -Repo owner/name."
}

function Resolve-GhCommand {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($gh) {
    return $gh.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles "GitHub CLI\gh.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\GitHub CLI\gh.exe")
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

$Repo = Resolve-GitHubRepo -ExplicitRepo $Repo
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
$privateKey = Read-Text -Path $KeyPath
$passwordValue = (Read-Text -Path $PasswordPath).Trim()

Write-Host ""
Write-Host "Updater secrets are ready for $Repo."
Write-Host ""
Write-Host "TAURI_UPDATER_PUBKEY:"
Write-Host $publicKey
Write-Host ""
Write-Host "TAURI_SIGNING_PRIVATE_KEY: use the full content of $KeyPath"
Write-Host "TAURI_SIGNING_PRIVATE_KEY_PASSWORD: use the full content of $PasswordPath"
Write-Host ""

if ($ConfigureGitHub) {
  $gh = Resolve-GhCommand
  if (-not $gh) {
    throw "GitHub CLI (gh) is not installed. Install it, run 'gh auth login', then rerun this script with -ConfigureGitHub."
  }

  & $gh auth status
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run 'gh auth login', then rerun this script with -ConfigureGitHub."
  }

  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "modern-todo-secrets-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Path $tempDir | Out-Null

  try {
    $pubFile = Join-Path $tempDir "TAURI_UPDATER_PUBKEY.txt"
    $privateFile = Join-Path $tempDir "TAURI_SIGNING_PRIVATE_KEY.txt"
    $passwordFile = Join-Path $tempDir "TAURI_SIGNING_PRIVATE_KEY_PASSWORD.txt"

    Write-Utf8NoBom -Path $pubFile -Value $publicKey
    Write-Utf8NoBom -Path $privateFile -Value $privateKey
    Write-Utf8NoBom -Path $passwordFile -Value $passwordValue

    & $gh secret set TAURI_UPDATER_PUBKEY --repo $Repo --body-file $pubFile
    if ($LASTEXITCODE -ne 0) { throw "Failed to set TAURI_UPDATER_PUBKEY." }

    & $gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $Repo --body-file $privateFile
    if ($LASTEXITCODE -ne 0) { throw "Failed to set TAURI_SIGNING_PRIVATE_KEY." }

    & $gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $Repo --body-file $passwordFile
    if ($LASTEXITCODE -ne 0) { throw "Failed to set TAURI_SIGNING_PRIVATE_KEY_PASSWORD." }

    Write-Host ""
    Write-Host "GitHub Actions secrets were configured for $Repo."
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "To upload these values with GitHub CLI after logging in:"
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts/setup-updater-secrets.ps1 -ConfigureGitHub"
}
