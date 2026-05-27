#!/usr/bin/env pwsh
<#
.SYNOPSIS
  ginee compliance — PreToolUse hook on Edit / Write / MultiEdit.
.DESCRIPTION
  Reads PreToolUse JSON from stdin; blocks (exit 2 + stderr) on a hard-gate violation.
  Violation classes (5 per playbook #135 T2) + opt-out + tests: adapters/claude/install.md § Compliance hooks.
.PARAMETER TestInput  Test-only: pass JSON instead of reading stdin.
.PARAMETER RepoRoot   Test-only: override repo root detection.
#>
[CmdletBinding()]
param(
  [string]$TestInput,
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:SKIP_GINEE_COMPLIANCE -eq '1') { exit 0 }

function Read-Payload {
  param([string]$TestInput)
  if ($TestInput) { return $TestInput }
  try { return [Console]::In.ReadToEnd() } catch { return '' }
}

function Get-RepoRoot {
  param([string]$Override)
  if ($Override) { return $Override }
  $root = & git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $root) { return $null }
  return $root.Trim()
}

function Test-OptOut {
  param([string]$Root, [string]$TacticId)
  $config = Join-Path $Root 'local/framework.config.yaml'
  if (-not (Test-Path -LiteralPath $config)) { return $false }
  $body = Get-Content -Raw -LiteralPath $config
  if (-not $body) { return $false }
  # A line `  - <tactic-id>` is only valid in `compliance.disabled`'s list.
  # Require both a `compliance:` key and the tactic listed as a bullet.
  if ($body -notmatch '(?m)^compliance:\s*$') { return $false }
  $pattern = "(?m)^\s+-\s+$([regex]::Escape($TacticId))\s*$"
  return ($body -match $pattern)
}

function Test-IsHotSpecPath {
  param([string]$RelPath)
  if (-not $RelPath) { return $false }
  $n = $RelPath -replace '\\','/'
  return ($n -eq 'core/process.md' -or
          $n -match '^core/process/[^/]+\.md$' -or
          $n -match '^core/protocols/[^/]+\.md$' -or
          $n -match '^core/roles/[^/]+\.md$' -or
          $n -match '^core/roles/[^/]+\.details\.md$')
}

function Test-FrontmatterPresent {
  param([string]$Content)
  return ($Content -match '(?s)^---\s*\r?\n.*?\r?\n---\s*\r?\n')
}

function Get-CapBytesFromFrontmatter {
  param([string]$Content)
  if ($Content -match '(?m)^cap-bytes:\s*(\d+)\s*$') {
    return [int]$matches[1]
  }
  return 0
}

function Test-LoadAlwaysFrontmatter {
  param([string]$Content)
  return ($Content -match '(?m)^load:\s*always\s*$')
}

function Test-OptimizedByTrailerOnBranch {
  param([string]$Root, [string]$BaseRef = 'origin/main')
  Push-Location $Root
  try {
    $log = & git log --format='%B%n--END--' "$BaseRef..HEAD" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $log) { return $false }
    return ($log -match '(?m)^Optimized-By:\s*ai-engineer\s*$')
  } finally {
    Pop-Location
  }
}

function Get-DTokenIntroduction {
  param([string]$OldContent, [string]$NewContent)
  # Treat bare D<N> tokens (D1..D999) as forbidden. Surrounding word
  # boundaries; skip obvious URL fragments / hex contexts by anchoring on
  # word edges.
  $rx = '(?<![\w-])D\d{1,3}(?![\w-])'
  $oldHits = @([regex]::Matches([string]$OldContent, $rx) | ForEach-Object { $_.Value })
  $newHits = @([regex]::Matches([string]$NewContent, $rx) | ForEach-Object { $_.Value })
  return @($newHits | Where-Object { $_ -notin $oldHits })
}

function Test-RFC2119Modifier {
  param([string]$AddedLines)
  # Pattern: `always` / `never` / `binding` / `mandatory` used as a rule
  # modifier — typically `is always`, `must always`, `never X`, `binding —`,
  # `mandatory.` etc. Word-boundary match; case-insensitive. Conservative:
  # require the keyword as a standalone word on an added line.
  return ($AddedLines -match '(?im)\b(always|never|binding|mandatory)\b')
}

function Write-Block {
  param([string]$Rule, [string]$Detail, [string]$Remediation)
  [Console]::Error.WriteLine("[ginee:gate] $Rule — $Detail")
  [Console]::Error.WriteLine("  Remediation: $Remediation")
  [Console]::Error.WriteLine("  Bypass (emergency): SKIP_GINEE_COMPLIANCE=1")
  [Console]::Error.WriteLine("  Opt out repo-wide: local/framework.config.yaml § compliance.disabled: [pretooluse-edit-hook]")
  exit 2
}

# --- Main ---
# Wrap the entire main block in try/catch — any uncaught error fails open
# (returns exit 0). The hook MUST NOT block a legitimate edit because of a
# bug in the hook itself; per parent #135's anti-patterns, hooks blocking
# forgivable infractions are explicitly out of bounds.

try {

$raw = Read-Payload -TestInput $TestInput
if (-not $raw) { exit 0 }

try {
  $payload = $raw | ConvertFrom-Json -ErrorAction Stop
} catch {
  # Malformed payload — fail open (don't block on parser bugs).
  exit 0
}

$toolName = $payload.tool_name
if ($toolName -notin @('Edit','Write','MultiEdit')) { exit 0 }

$root = Get-RepoRoot -Override $RepoRoot
if (-not $root) { exit 0 }

if (Test-OptOut -Root $root -TacticId 'pretooluse-edit-hook') { exit 0 }

$ti = $payload.tool_input
if (-not $ti) { exit 0 }
$filePath = $ti.file_path
if (-not $filePath) { exit 0 }

# Resolve absolute → repo-relative
$relPath = $filePath
if ([System.IO.Path]::IsPathRooted($filePath)) {
  try {
    $resolved = (Resolve-Path -LiteralPath $filePath -ErrorAction Stop).Path
    $rootResolved = (Resolve-Path -LiteralPath $root -ErrorAction Stop).Path
    if ($resolved.StartsWith($rootResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
      $relPath = $resolved.Substring($rootResolved.Length).TrimStart('\','/')
    }
  } catch {
    # Resolve fails when the file doesn't exist yet (typical for Write of a new
    # path) — fall through and treat $filePath as already-relative.
    $null = $_
  }
}
$relPath = $relPath -replace '\\','/'

# Compose proposed post-edit content
$oldContent = ''
$newContent = ''
if ($toolName -eq 'Write') {
  $newContent = if ($ti.PSObject.Properties.Name -contains 'content') { [string]$ti.content } else { '' }
  if (Test-Path -LiteralPath $filePath) {
    $oldContent = Get-Content -Raw -LiteralPath $filePath
  }
} elseif ($toolName -eq 'Edit') {
  $oldStr = [string]$ti.old_string
  $newStr = [string]$ti.new_string
  if (Test-Path -LiteralPath $filePath) {
    $oldContent = Get-Content -Raw -LiteralPath $filePath
    $newContent = $oldContent.Replace($oldStr, $newStr)
  } else {
    $newContent = $newStr
  }
} elseif ($toolName -eq 'MultiEdit') {
  if (Test-Path -LiteralPath $filePath) {
    $oldContent = Get-Content -Raw -LiteralPath $filePath
    $newContent = $oldContent
  }
  foreach ($e in $ti.edits) {
    $newContent = $newContent.Replace([string]$e.old_string, [string]$e.new_string)
  }
}

# --- Violation 1: hot-spec edit lacking frontmatter post-edit (D47) ---
if (Test-IsHotSpecPath -RelPath $relPath) {
  if (-not (Test-FrontmatterPresent -Content $newContent)) {
    Write-Block `
      -Rule 'hot-spec frontmatter required (D47)' `
      -Detail "$relPath is a hot-spec path; post-edit content is missing the required YAML frontmatter block." `
      -Remediation 'Add a 5-key frontmatter block per core/protocols/hot-spec-format.md before saving.'
  }
}

# --- Violation 3: D<N> token introduced on core/** (D42) ---
if ($relPath -like 'core/*') {
  $introduced = @(Get-DTokenIntroduction -OldContent $oldContent -NewContent $newContent)
  if ($introduced.Length -gt 0) {
    $sample = ($introduced | Select-Object -First 3) -join ', '
    Write-Block `
      -Rule 'D<N> token introduction blocked (D42)' `
      -Detail "$relPath would introduce bare D-token(s): $sample. Runtime surface (core/**) MUST stay D-free." `
      -Remediation 'Cite the rule by location (file § section), not by D-number. New decisions log to PLAN.md only.'
  }
}

# --- Violation 4: RFC 2119 modifier on added content (D48) ---
$addedBody = ''
if ($oldContent -and $newContent) {
  $oldLines = @($oldContent -split "`r?`n")
  $newLines = @($newContent -split "`r?`n")
  $addedBody = (@($newLines | Where-Object { $_ -and ($_ -notin $oldLines) })) -join "`n"
} elseif ($newContent) {
  $addedBody = $newContent
}
# Strip YAML frontmatter from added body so `load: always` isn't a false hit.
$addedBody = $addedBody -replace '(?ms)^---\s*\r?\n.*?\r?\n---\s*\r?\n', ''
if ($addedBody -and (Test-RFC2119Modifier -AddedLines $addedBody)) {
  Write-Block `
    -Rule 'RFC 2119 keyword convention (D48)' `
    -Detail "$relPath introduces 'always' / 'never' / 'binding' / 'mandatory' as a rule modifier. Use MUST / MUST NOT / SHOULD / SHALL etc." `
    -Remediation 'Restate the rule with RFC 2119 keywords per core/protocols/rfc2119-keywords.md.'
}

# --- Violation 2: file size > cap-bytes without Optimized-By trailer ---
$capBytes = Get-CapBytesFromFrontmatter -Content $newContent
if ($capBytes -gt 0) {
  $size = [System.Text.Encoding]::UTF8.GetByteCount($newContent)
  if ($size -gt $capBytes) {
    if (-not (Test-OptimizedByTrailerOnBranch -Root $root)) {
      Write-Block `
        -Rule 'cap-bytes exceeded without Optimized-By trailer (D44+D47)' `
        -Detail "$relPath post-edit size $size > cap-bytes $capBytes; no commit on this branch carries Optimized-By: ai-engineer." `
        -Remediation 'Dispatch ai-engineer for a lossless optimization pass; commit with Optimized-By: ai-engineer trailer.'
    }
  }
}

# --- Violation 5: always-loaded surface line-count bloat without trailer ---
if ((Test-LoadAlwaysFrontmatter -Content $newContent) -and $oldContent) {
  $oldLineCount = ($oldContent -split "`r?`n").Count
  $newLineCount = ($newContent -split "`r?`n").Count
  $delta = $newLineCount - $oldLineCount
  if ($delta -gt 50) {
    if (-not (Test-OptimizedByTrailerOnBranch -Root $root)) {
      Write-Block `
        -Rule 'always-loaded surface bloat without trailer (D21)' `
        -Detail "$relPath grows by $delta lines and is always-loaded; no commit on this branch carries Optimized-By: ai-engineer." `
        -Remediation 'Trim to keep the always-loaded surface lean, OR dispatch ai-engineer + commit with Optimized-By: ai-engineer.'
    }
  }
}

exit 0

} catch {
  # Fail open on any uncaught error inside the main block.
  $null = $_
  exit 0
}
