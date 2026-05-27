# migrate-engineering-team-to-ginee.ps1
#
# One-shot rename migration for adopters upgrading past the engineering-team
# -> ginee rebrand. Rewrites textual 'engineering-team' references
# in adopter-owned local/* files. Install-dir rename + CLAUDE.md pointer-block
# refresh are handled by install.ps1 / install.sh -UpdateOnly — this script
# only handles the local/* surface the installer cannot touch by design.
#
# Idempotent: re-running on a clean tree is a no-op.
#
# Usage:
#   .\.agents\ginee\core\scripts\migrate-engineering-team-to-ginee.ps1 [-DryRun]
#
# Run from anywhere — script auto-resolves local/ relative to its own location.

[CmdletBinding()]
param(
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

$localPath = Join-Path $scriptDir '..\..\local'
if (-not (Test-Path $localPath)) {
  Write-Error "local/ not found at $localPath. Run after the installer's -UpdateOnly pass (or pre-rebrand: from inside .agents\engineering-team\)."
  exit 1
}
$localDir = (Resolve-Path $localPath).Path

Write-Host "ginee rename migration"
Write-Host "  Scanning : $localDir"
if ($DryRun) {
  Write-Host "  Mode     : dry-run (no writes)"
} else {
  Write-Host "  Mode     : in-place rewrite"
}
Write-Host ""

$totalFiles = 0
$totalHits = 0

Get-ChildItem -Path $localDir -Recurse -File | ForEach-Object {
  $file = $_.FullName
  $content = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
  if ($null -eq $content -or $content.Length -eq 0) { return }
  # Defensive: skip binaries (NUL byte heuristic)
  if ($content.IndexOf([char]0) -ge 0) {
    Write-Host "  SKIP (binary): $file"
    return
  }
  $hits = ([regex]::Matches($content, 'engineering-team')).Count
  if ($hits -eq 0) { return }
  $script:totalFiles++
  $script:totalHits += $hits
  $rel = $file.Substring($localDir.Length).TrimStart('\','/')
  ('  {0,3} hit(s)  {1}' -f $hits, $rel) | Write-Host
  if (-not $DryRun) {
    $rewritten = $content -replace 'engineering-team', 'ginee'
    Set-Content -LiteralPath $file -Value $rewritten -NoNewline
  }
}

Write-Host ""
if ($totalFiles -eq 0) {
  Write-Host "No stale 'engineering-team' references found. local/ is clean."
  exit 0
}
if ($DryRun) {
  Write-Host "Summary: $totalHits hit(s) across $totalFiles file(s) (dry-run; nothing written)"
} else {
  Write-Host "Summary: $totalHits hit(s) across $totalFiles file(s) rewritten"
}
Write-Host ""
Write-Host "GitHub-side prerequisites (adopter-owned — not handled here):"
Write-Host "  - Confirm the renamed framework repo + labels:"
Write-Host "      gh repo view kostiantyn-matsebora/ginee"
Write-Host "      gh label list -R kostiantyn-matsebora/ginee | Where-Object { `$_ -match '^ginee:' }"
Write-Host "  - On your primary repo, mirror the label rename if you use the same scheme:"
Write-Host "      gh label edit engineering-team:ready -n ginee:ready -R <owner>/<repo>"
Write-Host "      gh label edit engineering-team:in-progress -n ginee:in-progress -R <owner>/<repo>"
Write-Host "      gh label edit engineering-team:blocked -n ginee:blocked -R <owner>/<repo>"
Write-Host ""
Write-Host "Done."
