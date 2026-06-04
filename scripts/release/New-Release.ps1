#Requires -Version 7.0

<#
.SYNOPSIS
    Prepare a release: bump the CHANGELOG and open a release PR.

.DESCRIPTION
    Computes the next version (explicit -Version, or -Bump against the highest
    existing git tag), rewrites CHANGELOG.md (renames the [Unreleased] section to
    the new version + date and inserts a fresh empty [Unreleased] above it),
    then creates a release/vX.Y.Z branch, commits, pushes, and opens a PR.

    This script does NOT create the git tag. After the PR merges, the maintainer
    tags manually on main and pushes the tag, which triggers the release workflow:

        git checkout main && git pull
        git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z

    Pushing the tag triggers .github/workflows/release.yml to build + publish the
    six service images and draft the GitHub Release.

    All decision logic lives in pure functions (Test-SemVer, Get-CurrentVersion,
    Get-NextVersion, Update-Changelog). The entry block only performs git/gh/file
    side effects and is skipped under -AsLibrary so Pester can dot-source safely.

.PARAMETER Version
    Explicit target version WITHOUT a leading 'v' (e.g. 1.2.3 or 1.0.0-rc.1).
    Mutually exclusive with -Bump; exactly one of the two is required.

.PARAMETER Bump
    Semantic bump applied to the highest existing tag: major | minor | patch.
    Mutually exclusive with -Version.

.PARAMETER DryRun
    Compute the version and preview the CHANGELOG change + planned commands, but
    perform NO git/gh/file mutations. Because it mutates nothing, the clean-tree
    and on-main guards are relaxed to warnings, so a preview works from any branch
    or a dirty working tree.

.PARAMETER AsLibrary
    Define the functions without executing the entry block (for Pester).

.EXAMPLE
    ./New-Release.ps1 -Bump minor
    Bumps the minor component of the highest existing tag and opens a release PR.

.EXAMPLE
    ./New-Release.ps1 -Version 1.0.0-rc.1 -DryRun
    Previews the release for an explicit pre-release version without mutating anything.
#>

[CmdletBinding()]
param(
    [string]$Version,
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Bump,
    [switch]$DryRun,
    [switch]$AsLibrary
)

# ------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ------------------------------------------------------------------

function Test-SemVer {
    <#
    .SYNOPSIS
        True for a SemVer string X.Y.Z or X.Y.Z-prerelease (no leading 'v').
    #>
    param([string]$Version)
    if ([string]::IsNullOrWhiteSpace($Version)) { return $false }
    return ($Version -match '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$')
}

function ConvertTo-SemVerParts {
    <#
    .SYNOPSIS
        Parse a validated SemVer string into a comparable parts object.
    #>
    param([string]$Version)
    $core, $pre = $Version -split '-', 2
    $nums = $core -split '\.'
    return [pscustomobject]@{
        Major      = [int]$nums[0]
        Minor      = [int]$nums[1]
        Patch      = [int]$nums[2]
        PreRelease = $pre
    }
}

function Compare-SemVer {
    <#
    .SYNOPSIS
        Compare two SemVer strings. Returns -1, 0, or 1 (a vs b).
        A pre-release sorts lower than its associated release.
    #>
    param([string]$A, [string]$B)
    $pa = ConvertTo-SemVerParts -Version $A
    $pb = ConvertTo-SemVerParts -Version $B
    foreach ($field in 'Major', 'Minor', 'Patch') {
        if ($pa.$field -lt $pb.$field) { return -1 }
        if ($pa.$field -gt $pb.$field) { return 1 }
    }
    # Core equal: a present pre-release is lower than no pre-release.
    if ($pa.PreRelease -and -not $pb.PreRelease) { return -1 }
    if (-not $pa.PreRelease -and $pb.PreRelease) { return 1 }
    return [string]::Compare($pa.PreRelease, $pb.PreRelease, [System.StringComparison]::Ordinal)
}

function Get-CurrentVersion {
    <#
    .SYNOPSIS
        Highest SemVer (without 'v') among the given tags, or 0.0.0 if none.
    #>
    param([string[]]$Tags)
    $best = $null
    foreach ($tag in $Tags) {
        if ($null -eq $tag) { continue }
        $candidate = ([string]$tag).Trim()
        if ($candidate -match '^v') { $candidate = $candidate.Substring(1) }
        if (-not (Test-SemVer -Version $candidate)) { continue }
        if ($null -eq $best -or (Compare-SemVer -A $candidate -B $best) -gt 0) {
            $best = $candidate
        }
    }
    if ($null -eq $best) { return '0.0.0' }
    return $best
}

function Get-NextVersion {
    <#
    .SYNOPSIS
        Bump a SemVer string by major|minor|patch, resetting lower parts.
    #>
    param([string]$Current, [string]$Bump)
    if (-not (Test-SemVer -Version $Current)) {
        throw "Invalid current version: '$Current'."
    }
    $p = ConvertTo-SemVerParts -Version $Current
    switch ($Bump) {
        'major' { return "$($p.Major + 1).0.0" }
        'minor' { return "$($p.Major).$($p.Minor + 1).0" }
        'patch' { return "$($p.Major).$($p.Minor).$($p.Patch + 1)" }
        default { throw "Invalid bump: '$Bump'. Expected major, minor, or patch." }
    }
}

function Update-Changelog {
    <#
    .SYNOPSIS
        Rename the [Unreleased] header to [<Version>] - <Date> and insert a
        fresh empty [Unreleased] section above it. Pure string transform.
    #>
    param([string]$Content, [string]$Version, [string]$Date)

    $newline = if ($Content -match "`r`n") { "`r`n" } else { "`n" }
    $lines = $Content -split '\r?\n'

    $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^##\s*\[Unreleased\]\s*$') { $idx = $i; break }
    }
    if ($idx -lt 0) {
        throw 'CHANGELOG has no "## [Unreleased]" section to release.'
    }

    $fresh = @(
        '## [Unreleased]'
        ''
        ''
    )
    $renamed = "## [$Version] - $Date"

    $before = if ($idx -gt 0) { $lines[0..($idx - 1)] } else { @() }
    $after = if ($idx -lt ($lines.Count - 1)) { $lines[($idx + 1)..($lines.Count - 1)] } else { @() }

    $result = @()
    $result += $before
    $result += $fresh
    $result += $renamed
    $result += $after

    return ($result -join $newline)
}

function Update-DocVersionExamples {
    <#
    .SYNOPSIS
        Rewrite the release pin-version EXAMPLES in adopter docs to <Version>.

    .DESCRIPTION
        Pure string transform. Bumps the "pin to a published release" examples so
        the guide always demonstrates the latest tag instead of drifting behind it.
        Each rule is anchored to its surrounding prose, so only the pin examples
        move — the "first release (v0.1.0) is cut" historical note, the demo seed
        versions in the mockup, and any other SemVer stay untouched. Idempotent.

        Covered examples (any SemVer -> <Version>):
          - DASHBOARD_VERSION=<semver>                     (.env / inline)
          - published release (e.g. `<semver>`)            (configuration table)
          - the git tag `v<semver>` publishes images as `<semver>`
          - .../v<semver>/compose/...                      (pin-a-release URL)
          - compose-demo:<semver>                          (OCI demo artifact)
    #>
    param([string]$Content, [string]$Version)

    $sv = '\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?'   # SemVer, no leading 'v'
    $bt = [char]0x60                            # backtick (markdown code span)

    # 1. DASHBOARD_VERSION=<semver>
    $Content = $Content -replace "DASHBOARD_VERSION=$sv", "DASHBOARD_VERSION=$Version"

    # 2. published release (e.g. `<semver>`)
    $Content = $Content -replace "(published release \(e\.g\. $bt)$sv($bt\))", ('${1}' + $Version + '${2}')

    # 3. the git tag `v<semver>` publishes images as `<semver>`
    $Content = $Content -replace "(the git tag ${bt}v)$sv($bt publishes images as $bt)$sv($bt)", ('${1}' + $Version + '${2}' + $Version + '${3}')

    # 4. .../v<semver>/compose/...
    $Content = $Content -replace "/v$sv/compose/", "/v$Version/compose/"

    # 5. compose-demo:<semver>
    $Content = $Content -replace "compose-demo:$sv", "compose-demo:$Version"

    return $Content
}

# ------------------------------------------------------------------
# Entry block (integration only — not unit-tested)
# ------------------------------------------------------------------

if (-not $AsLibrary) {
    $ErrorActionPreference = 'Stop'
    $InformationPreference = 'Continue'

    function Write-Fail {
        param([string]$Message)
        Write-Error $Message
        exit 1
    }

    $repoRoot = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1)
    if (-not $repoRoot) { Write-Fail 'Not inside a git repository.' }
    $repoRoot = ([string]$repoRoot).Trim()

    # --- Resolve target version -------------------------------------------------
    $hasVersion = -not [string]::IsNullOrWhiteSpace($Version)
    $hasBump = -not [string]::IsNullOrWhiteSpace($Bump)
    if ($hasVersion -eq $hasBump) {
        Write-Fail 'Provide exactly one of -Version or -Bump.'
    }

    if ($hasVersion) {
        if (-not (Test-SemVer -Version $Version)) {
            Write-Fail "Invalid -Version '$Version'. Expected X.Y.Z or X.Y.Z-prerelease (no leading 'v')."
        }
        $target = $Version
    }
    else {
        $tags = @(& git tag --list 'v*')
        $current = Get-CurrentVersion -Tags $tags
        $target = Get-NextVersion -Current $current -Bump $Bump
        Write-Information "Current version: $current  ->  next ($Bump): $target"
    }

    $tagName = "v$target"
    $branchName = "release/$tagName"

    # --- Guards -----------------------------------------------------------------
    # Under -DryRun nothing is mutated, so the clean-tree / on-main preconditions
    # (which gate the real branch+commit+push) are relaxed to warnings — a preview
    # must work from any branch or a dirty tree.
    $existingTag = @(& git tag --list $tagName)
    if ($existingTag.Count -gt 0) {
        if ($DryRun) { Write-Warning "Tag '$tagName' already exists." }
        else { Write-Fail "Tag '$tagName' already exists." }
    }

    if (-not $DryRun) {
        $porcelain = @(& git status --porcelain)
        if ($porcelain.Count -gt 0) {
            Write-Fail 'Working tree is not clean. Commit or stash changes before releasing.'
        }

        $branch = (& git rev-parse --abbrev-ref HEAD | Select-Object -First 1)
        $branch = ([string]$branch).Trim()
        if ($branch -ne 'main') {
            Write-Fail "Releases must be cut from 'main' (current branch: '$branch')."
        }
    }

    # --- CHANGELOG transform ----------------------------------------------------
    $changelogPath = Join-Path $repoRoot 'CHANGELOG.md'
    if (-not (Test-Path $changelogPath)) {
        Write-Fail "CHANGELOG.md not found at '$changelogPath'."
    }
    $original = Get-Content -Path $changelogPath -Raw
    $today = Get-Date -Format 'yyyy-MM-dd'
    $updated = Update-Changelog -Content $original -Version $target -Date $today

    # --- Doc pin-version examples ----------------------------------------------
    # Keep the adopter guide's "pin to a published release" examples on the latest
    # tag so they don't drift behind the release. Only files that actually change
    # are staged + committed.
    $docRelPaths = @(
        'docs/guide/install.md'
        'docs/guide/configuration.md'
        'docs/guide/quickstart.md'
    )
    $docUpdates = @()
    foreach ($rel in $docRelPaths) {
        $docPath = Join-Path $repoRoot $rel
        if (-not (Test-Path $docPath)) {
            Write-Warning "Doc not found, skipping pin-version bump: $rel"
            continue
        }
        $docOriginal = Get-Content -Path $docPath -Raw
        $docUpdated = Update-DocVersionExamples -Content $docOriginal -Version $target
        if ($docUpdated -ne $docOriginal) {
            $docUpdates += [pscustomobject]@{ Rel = $rel; Path = $docPath; Content = $docUpdated }
        }
    }

    $postMerge = @(
        'git checkout main && git pull'
        "git tag -a $tagName -m `"$tagName`" && git push origin $tagName"
    )

    $prBody = @"
Release **$tagName**.

This PR bumps the CHANGELOG for ``$tagName``. It does NOT create the git tag.

After merging this PR, run on main:

    $($postMerge -join "`n    ")

Pushing the tag triggers ``.github/workflows/release.yml`` to build + publish the
six service images and draft the GitHub Release.
"@

    if ($DryRun) {
        Write-Information ''
        Write-Information "[DryRun] Target version : $target"
        Write-Information "[DryRun] Tag (post-merge): $tagName"
        Write-Information "[DryRun] Release branch  : $branchName"
        Write-Information ''
        Write-Information '[DryRun] CHANGELOG.md preview:'
        Write-Information '------------------------------------------------------------'
        Write-Information $updated
        Write-Information '------------------------------------------------------------'
        Write-Information ''
        if ($docUpdates.Count -gt 0) {
            Write-Information "[DryRun] Doc pin-version examples bumped to $target in:"
            foreach ($d in $docUpdates) { Write-Information "  $($d.Rel)" }
        }
        else {
            Write-Information "[DryRun] No doc pin-version examples needed updating (already $target)."
        }
        Write-Information ''
        Write-Information '[DryRun] Would run:'
        Write-Information "  git checkout -b $branchName"
        Write-Information '  (write CHANGELOG.md'
        if ($docUpdates.Count -gt 0) { Write-Information '   + the doc files listed above)' }
        else { Write-Information '   )' }
        Write-Information "  git add CHANGELOG.md$(if ($docUpdates.Count -gt 0) { ' ' + (($docUpdates | ForEach-Object { $_.Rel }) -join ' ') })"
        Write-Information "  git commit -m `"chore(release): $tagName`""
        Write-Information "  git push -u origin $branchName"
        Write-Information "  gh pr create --title `"chore(release): $tagName`" --body <post-merge instructions>"
        Write-Information ''
        Write-Information '[DryRun] No changes made.'
        exit 0
    }

    Set-Content -Path $changelogPath -Value $updated -NoNewline
    foreach ($d in $docUpdates) {
        Set-Content -Path $d.Path -Value $d.Content -NoNewline
        Write-Information "Bumped pin-version examples to $target in $($d.Rel)."
    }
    & git checkout -b $branchName
    if ($LASTEXITCODE -ne 0) { Write-Fail "git checkout -b $branchName failed." }
    & git add $changelogPath
    if ($LASTEXITCODE -ne 0) { Write-Fail 'git add CHANGELOG.md failed.' }
    foreach ($d in $docUpdates) {
        & git add $d.Path
        if ($LASTEXITCODE -ne 0) { Write-Fail "git add $($d.Rel) failed." }
    }
    & git commit -m "chore(release): $tagName"
    if ($LASTEXITCODE -ne 0) { Write-Fail 'git commit failed.' }
    & git push -u origin $branchName
    if ($LASTEXITCODE -ne 0) { Write-Fail "git push failed for $branchName." }
    & gh pr create --title "chore(release): $tagName" --body $prBody
    if ($LASTEXITCODE -ne 0) { Write-Fail 'gh pr create failed.' }

    Write-Information ''
    Write-Information "Release PR opened for $tagName."
    Write-Information 'After the PR merges, run on main:'
    Write-Information ''
    foreach ($cmd in $postMerge) { Write-Information "    $cmd" }
    Write-Information ''
    Write-Information "Pushing the tag triggers .github/workflows/release.yml to build + publish"
    Write-Information 'the six service images and draft the GitHub Release.'
    exit 0
}
