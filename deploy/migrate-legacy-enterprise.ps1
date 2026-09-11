[CmdletBinding()]
param(
  [string]$LegacyDirectory,
  [string]$Version = 'v0.2.33'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($LegacyDirectory)) {
  $LegacyDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '..\veriqorn-install'
}

function Read-EnvFile([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
      $values[$matches[1]] = $matches[2]
    }
  }
  return $values
}

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $Path)
  $pattern = "^\s*$([regex]::Escape($Name))\s*="
  $replacement = "$Name=$Value"
  $updated = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match $pattern) {
      $lines[$index] = $replacement
      $updated = $true
      break
    }
  }
  if (-not $updated) { $lines.Add($replacement) }
  [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

$legacyDirectory = (Resolve-Path -LiteralPath $LegacyDirectory).Path
$legacyEnv = Join-Path $legacyDirectory '.env'
$legacyEnterpriseEnv = Join-Path $legacyDirectory '.env.enterprise'
$targetEnv = Join-Path $PSScriptRoot '.env'
$targetEnterpriseEnv = Join-Path $PSScriptRoot '.env.enterprise'

foreach ($path in @($legacyEnv, $legacyEnterpriseEnv)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required legacy configuration file is missing: $path"
  }
}

if (Test-Path -LiteralPath $targetEnv -PathType Container) {
  $contents = @(Get-ChildItem -LiteralPath $targetEnv -Force)
  if ($contents.Count -gt 0) {
    throw "Refusing to replace non-empty directory: $targetEnv"
  }
  Remove-Item -LiteralPath $targetEnv -Force
}
if ((Test-Path -LiteralPath $targetEnv -PathType Leaf) -or (Test-Path -LiteralPath $targetEnterpriseEnv -PathType Leaf)) {
  throw 'Target env files already exist. Preserve or remove them explicitly before migration.'
}

$legacyValues = Read-EnvFile $legacyEnv
$projectName = if ($legacyValues.ContainsKey('COMPOSE_PROJECT_NAME')) { $legacyValues['COMPOSE_PROJECT_NAME'] } else { 'veriqorn' }
$backendId = (& docker ps --filter "name=$projectName-backend-1" --format '{{.ID}}').Trim()
if ([string]::IsNullOrWhiteSpace($backendId)) {
  throw "Active backend for Compose project '$projectName' was not found."
}
$mounts = (& docker inspect $backendId --format '{{json .Mounts}}' | ConvertFrom-Json)
$licenseMount = $mounts | Where-Object { $_.Destination -eq '/run/veriqorn/license/license.json' } | Select-Object -First 1
if (-not $licenseMount -or [string]::IsNullOrWhiteSpace($licenseMount.Source)) {
  throw 'Active Enterprise license mount was not found.'
}

Copy-Item -LiteralPath $legacyEnv -Destination $targetEnv
Copy-Item -LiteralPath $legacyEnterpriseEnv -Destination $targetEnterpriseEnv

Set-EnvValue $targetEnv 'PLATFORM_VERSION' $Version
Set-EnvValue $targetEnterpriseEnv 'PLATFORM_VERSION' $Version
Set-EnvValue $targetEnterpriseEnv 'ENTERPRISE_BACKEND_IMAGE' "ghcr.io/veriqorn/veriqorn-enterprise-backend:$Version"
Set-EnvValue $targetEnterpriseEnv 'ENTERPRISE_FRONTEND_IMAGE' "ghcr.io/veriqorn/veriqorn-enterprise-frontend:$Version"
Set-EnvValue $targetEnterpriseEnv 'ENTERPRISE_UPDATE_RELEASES_URL' 'https://raw.githubusercontent.com/Veriqorn/veriqorn/main/docs/releases/enterprise/latest.json'
Set-EnvValue $targetEnterpriseEnv 'VERIQORN_LICENSE_FILE' $licenseMount.Source

Write-Output "Migrated Enterprise configuration for Compose project '$projectName' to $Version."
