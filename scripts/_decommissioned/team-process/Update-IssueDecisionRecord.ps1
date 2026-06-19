#Requires -Version 7.0

<#
.SYNOPSIS
    Publish a team-process session's decision record to its owning GitHub issue as a single,
    idempotent MANAGED COMMENT (upsert by hidden marker — never clobbers the issue body, never
    spams duplicate comments).

    The session record (.team-process/sessions/<id>/session.json) is the SOURCE OF TRUTH; this
    comment is a published Markdown PROJECTION of its `acceptance`, `decisions`, and the
    aggregated `ledger[].deferred`. Decisions survive compaction in the session record; this
    publishes them to the durable issue at ship so requirements/decisions are not re-lost.

.DESCRIPTION
    Pure, unit-tested surface:
      - Get-DecisionMarker        the hidden HTML marker that tags the managed comment.
      - ConvertTo-DecisionMarkdown render a session record object into the comment body.
      - Find-ManagedCommentId     locate the existing managed comment by marker in a comments list.
    Thin gh I/O (entry block, not unit-tested — network): resolve repo, fetch comments, then
    POST (create) or PATCH (update) the managed comment via `gh api`.

    Confirm-first is enforced by the caller (the /ship activity renders with -DryRun, shows the
    user, and only invokes the live upsert on approval) — posting to an issue is outward-facing.

.PARAMETER Issue        Issue number. If omitted, taken from the session record's `issue` field.
.PARAMETER SessionFile  Path to session.json. If omitted, resolved from -Id under the repo root.
.PARAMETER Id           Session id (filename stem) — used to resolve SessionFile when not given.
.PARAMETER Repo         owner/repo. If omitted, resolved via `gh repo view`.
.PARAMETER DryRun       Render the comment body to stdout and exit — do NOT touch GitHub.
.PARAMETER AsLibrary    Define functions without executing the entry block (for Pester).
#>

[CmdletBinding()]
param(
    [string]$Issue,
    [string]$SessionFile,
    [string]$Id,
    [string]$Repo,
    [switch]$DryRun,
    [switch]$AsLibrary
)

# The hidden marker that identifies the single managed comment. Must never change — it is how a
# re-publish finds and updates the same comment instead of posting a new one.
function Get-DecisionMarker { return '<!-- team-process:decision-record -->' }

# Escape a value for a single Markdown table cell (pipes break the table; newlines collapse).
function Format-Cell {
    param([string]$Text)
    $t = [string]$Text
    $t = $t -replace '\r?\n', ' '
    $t = $t -replace '\|', '\|'
    return $t.Trim()
}

# Render a session record object into the managed-comment body (Markdown). Sections with no
# content are omitted; the decisions table is always present (it is the point of the record).
function ConvertTo-DecisionMarkdown {
    param($Record)
    $marker  = Get-DecisionMarker
    $issue   = if ($Record.issue)  { [string]$Record.issue }  else { '' }
    $branch  = if ($Record.branch) { [string]$Record.branch } else { '(unrecorded)' }
    $updated = if ($Record.updatedAt) { [string]$Record.updatedAt } else { '' }

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine($marker)
    $title = if ($issue) { "## 🔒 Decision record — $issue · branch ``$branch``" }
             else        { "## 🔒 Decision record — branch ``$branch``" }
    [void]$sb.AppendLine($title)
    $stamp = if ($updated) { " — last updated $updated" } else { '' }
    [void]$sb.AppendLine("_Maintained by team-process$stamp. The session record is the source of truth; this comment is a published projection._")
    [void]$sb.AppendLine('')

    # Acceptance criteria (locked)
    $acceptance = @($Record.acceptance | Where-Object { $_ })
    if ($acceptance.Count -gt 0) {
        [void]$sb.AppendLine('### Acceptance criteria (locked)')
        foreach ($a in $acceptance) { [void]$sb.AppendLine("- $([string]$a)") }
        [void]$sb.AppendLine('')
    }

    # Decisions (always present)
    [void]$sb.AppendLine('### Decisions')
    $decisions = @($Record.decisions | Where-Object { $_ })
    if ($decisions.Count -gt 0) {
        [void]$sb.AppendLine('| # | Decision | Why | Supersedes | Status |')
        [void]$sb.AppendLine('|---|---|---|---|---|')
        foreach ($d in $decisions) {
            $id  = if ($null -ne $d.id) { [string]$d.id } else { '' }
            $dec = Format-Cell -Text $d.decision
            $why = Format-Cell -Text $d.why
            $sup = Format-Cell -Text $d.supersedes
            $st  = if ($d.status) { Format-Cell -Text $d.status } else { 'locked' }
            [void]$sb.AppendLine("| $id | $dec | $why | $sup | $st |")
        }
    }
    else {
        [void]$sb.AppendLine('_No decisions recorded yet._')
    }
    [void]$sb.AppendLine('')

    # Deferred / follow-ups — aggregated from the per-wave ledger.
    $deferred = @($Record.ledger | Where-Object { $_ -and $_.deferred } | ForEach-Object {
            $w = if ($null -ne $_.wave) { "wave $($_.wave): " } else { '' }
            "$w$([string]$_.deferred)"
        })
    if ($deferred.Count -gt 0) {
        [void]$sb.AppendLine('### Deferred / follow-ups')
        foreach ($f in $deferred) { [void]$sb.AppendLine("- $f") }
        [void]$sb.AppendLine('')
    }

    # Artifacts (source of truth) — deduped union of all decision refs.
    $refs = @($Record.decisions | Where-Object { $_ -and $_.refs } | ForEach-Object { $_.refs } |
        ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique)
    if ($refs.Count -gt 0) {
        [void]$sb.AppendLine('### Artifacts (source of truth)')
        foreach ($r in $refs) { [void]$sb.AppendLine("- $r") }
        [void]$sb.AppendLine('')
    }

    return $sb.ToString().TrimEnd() + "`n"
}

# Find the REST id of the managed comment (the one carrying the marker) in a comments array,
# or $null if none exists yet. $Comments items expose .id (numeric) and .body.
function Find-ManagedCommentId {
    param($Comments, [string]$Marker)
    if (-not $Marker) { $Marker = Get-DecisionMarker }
    foreach ($c in @($Comments)) {
        if ($null -eq $c) { continue }
        if (([string]$c.body).Contains($Marker)) { return $c.id }
    }
    return $null
}

# Normalize an issue ref ('#351' / '351' / 'GH-351') to its bare number, or '' if none.
function Get-IssueNumber {
    param([string]$Ref)
    if ([string]::IsNullOrWhiteSpace($Ref)) { return '' }
    $m = [regex]::Match([string]$Ref, '\d+')
    return $(if ($m.Success) { $m.Value } else { '' })
}

if (-not $AsLibrary) {
    $ErrorActionPreference = 'Stop'

    $root = (& git rev-parse --show-toplevel 2>$null) | Select-Object -First 1
    if (-not $root) { $root = (Get-Location).Path }
    $root = ([string]$root).Trim()

    # Resolve the session file.
    if (-not $SessionFile) {
        if (-not $Id) { Write-Error 'Provide -SessionFile or -Id.'; exit 2 }
        $SessionFile = Join-Path $root '.team-process' 'sessions' $Id 'session.json'
    }
    if (-not (Test-Path -LiteralPath $SessionFile)) {
        Write-Error "Session record not found: $SessionFile"; exit 2
    }
    $record = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json -DateKind String

    # Resolve the issue number (param wins, else the record's issue field).
    $issueNum = Get-IssueNumber -Ref ($(if ($Issue) { $Issue } else { [string]$record.issue }))
    if (-not $issueNum) {
        Write-Error 'No issue number — pass -Issue, or set the session record''s "issue" field (this run is not in issue mode).'
        exit 2
    }

    $body = ConvertTo-DecisionMarkdown -Record $record

    if ($DryRun) { [Console]::Out.Write($body); exit 0 }

    # Resolve owner/repo for the REST endpoints.
    if (-not $Repo) {
        $Repo = (& gh repo view --json nameWithOwner --jq .nameWithOwner 2>$null) | Select-Object -First 1
        $Repo = ([string]$Repo).Trim()
    }
    if (-not $Repo) { Write-Error 'Could not resolve owner/repo — pass -Repo owner/name.'; exit 3 }

    # Fetch existing comments (REST → numeric ids usable by PATCH).
    $commentsJson = (& gh api "repos/$Repo/issues/$issueNum/comments" --paginate 2>$null) -join "`n"
    $comments = if ([string]::IsNullOrWhiteSpace($commentsJson)) { @() } else { $commentsJson | ConvertFrom-Json }
    $managedId = Find-ManagedCommentId -Comments $comments -Marker (Get-DecisionMarker)

    # Write the body via a temp file so `gh api -F body=@file` carries it verbatim (no shell quoting).
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        Set-Content -LiteralPath $tmp -Value $body -Encoding utf8NoBOM
        if ($managedId) {
            & gh api -X PATCH "repos/$Repo/issues/comments/$managedId" -F "body=@$tmp" | Out-Null
            [Console]::Out.WriteLine("Updated decision-record comment on #$issueNum (comment $managedId).")
        }
        else {
            & gh api -X POST "repos/$Repo/issues/$issueNum/comments" -F "body=@$tmp" | Out-Null
            [Console]::Out.WriteLine("Posted decision-record comment on #$issueNum.")
        }
    }
    finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }

    exit 0
}
