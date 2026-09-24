param(
  [string]$Repo = "quijanopomae-crypto/nuevo-amanecer-pos",
  [string]$Branch = "feature/v1.3-mobile-cloud"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function New-HexSecret([int]$Bytes = 32) {
  $raw = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)
  return [Convert]::ToHexString($raw).ToLowerInvariant()
}

function Invoke-GhJson([string[]]$GhArgs) {
  $output = & gh @GhArgs
  if ($LASTEXITCODE -ne 0) { throw "gh failed: gh $($GhArgs -join ' ')" }
  if (-not $output) { return $null }

  # GitHub CLI can emit multi-line JSON. Join stdout into one JSON document
  # before parsing so Windows PowerShell 5.1 does not parse line-by-line.
  $json = ($output -join [Environment]::NewLine).Trim()
  if (-not $json) { return $null }
  return ($json | ConvertFrom-Json)
}

function Wait-LatestWorkflow([string]$Workflow, [string]$ExpectedHead) {
  Start-Sleep -Seconds 3
  $runs = Invoke-GhJson @(
    "run","list",
    "--repo",$Repo,
    "--workflow",$Workflow,
    "--branch",$Branch,
    "--event","workflow_dispatch",
    "--limit","5",
    "--json","databaseId,status,conclusion,headSha,createdAt"
  )
  $run = @($runs) | Where-Object { $_.headSha -eq $ExpectedHead } | Select-Object -First 1
  if (-not $run) { throw "No workflow_dispatch run found for $Workflow at HEAD $ExpectedHead" }
  & gh run watch $run.databaseId --repo $Repo --exit-status
  if ($LASTEXITCODE -ne 0) { throw "Workflow failed: $Workflow (run $($run.databaseId))" }
  return $run.databaseId
}

Require-Command gh
& gh auth status
if ($LASTEXITCODE -ne 0) { throw "GitHub CLI is not authenticated." }

$repoInfo = Invoke-GhJson @("repo","view",$Repo,"--json","defaultBranchRef,nameWithOwner")
if ($repoInfo.nameWithOwner -ne $Repo) { throw "Unexpected repository returned by gh." }
if ($repoInfo.defaultBranchRef.name -ne $Branch) {
  throw "Default branch mismatch. Expected $Branch, got $($repoInfo.defaultBranchRef.name)"
}

$head = (& gh api "repos/$Repo/commits/$([uri]::EscapeDataString($Branch))" --jq ".sha").Trim()
if ($LASTEXITCODE -ne 0 -or -not $head) { throw "Could not resolve current branch HEAD." }
Write-Host "Finalizing repository at HEAD $head"

$labImportSecret = New-HexSecret 32
$activationSecure = Read-Host "Create the one-time POS activation secret you will enter once on each new browser" -AsSecureString
$activationBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($activationSecure)
$activationSecret = $null

try {
  $activationSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($activationBstr)
  if ([string]::IsNullOrWhiteSpace($activationSecret) -or $activationSecret.Length -lt 12) {
    throw "POS activation secret must be at least 12 characters."
  }

  $labImportSecret | & gh secret set LAB_IMPORT_HMAC_SECRET --repo $Repo
  if ($LASTEXITCODE -ne 0) { throw "Failed to set LAB_IMPORT_HMAC_SECRET" }

  $activationSecret | & gh secret set POS_ACTIVATION_SECRET --repo $Repo
  if ($LASTEXITCODE -ne 0) { throw "Failed to set POS_ACTIVATION_SECRET" }
}
finally {
  $labImportSecret = $null
  $activationSecret = $null
  if ($activationBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($activationBstr)
  }
  $activationSecure = $null
}

$protection = @{
  required_status_checks = $null
  enforce_admins = $true
  required_pull_request_reviews = @{
    dismiss_stale_reviews = $false
    require_code_owner_reviews = $false
    require_last_push_approval = $false
    required_approving_review_count = 0
  }
  restrictions = $null
  required_linear_history = $false
  allow_force_pushes = $false
  allow_deletions = $false
  block_creations = $false
  required_conversation_resolution = $true
  lock_branch = $false
  allow_fork_syncing = $true
} | ConvertTo-Json -Depth 8 -Compress

$encodedBranch = [uri]::EscapeDataString($Branch)
$protection | & gh api -X PUT -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$Repo/branches/$encodedBranch/protection" --input -
if ($LASTEXITCODE -ne 0) { throw "Failed to configure branch protection." }

Write-Host "Branch protection configured."

& gh workflow run deploy-lab-cloud.yml --repo $Repo --ref $Branch
if ($LASTEXITCODE -ne 0) { throw "Could not dispatch deploy-lab-cloud.yml" }
$deployRun = Wait-LatestWorkflow "deploy-lab-cloud.yml" $head

& gh workflow run owner-backup-recovery-drill.yml --repo $Repo --ref $Branch
if ($LASTEXITCODE -ne 0) { throw "Could not dispatch owner-backup-recovery-drill.yml" }
$drillRun = Wait-LatestWorkflow "owner-backup-recovery-drill.yml" $head

$protectionCheck = Invoke-GhJson @(
  "api",
  "-H","Accept: application/vnd.github+json",
  "-H","X-GitHub-Api-Version: 2022-11-28",
  "repos/$Repo/branches/$encodedBranch/protection"
)

if (-not $protectionCheck.required_pull_request_reviews) {
  throw "Branch protection verification failed: PR requirement missing."
}
if ($protectionCheck.allow_force_pushes.enabled -eq $true) {
  throw "Branch protection verification failed: force pushes are enabled."
}
if ($protectionCheck.allow_deletions.enabled -eq $true) {
  throw "Branch protection verification failed: branch deletion is enabled."
}

Write-Host ""
Write-Host "OWNER FINALIZATION PASS"
Write-Host "HEAD: $head"
Write-Host "LAB deploy run: $deployRun"
Write-Host "Backup/recovery drill run: $drillRun"
Write-Host "Branch protection: PASS"
