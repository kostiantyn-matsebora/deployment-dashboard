#Requires -Version 7.0

<#
.SYNOPSIS
    Package a built browser extension into per-browser zip archives.

.DESCRIPTION
    Takes the Vite-built dist directory from frontend/extension and packages it
    into one zip per browser target under an output directory. The resulting zips
    are ready for upload to each browser's extension store or for use as CI
    artifacts.

    The Chrome/Edge zip is identical (Manifest V3 is supported by both). Firefox
    may need a separate zip if polyfills or manifest keys differ; by default the
    same dist is zipped for all three targets.

    All decision logic lives in pure functions (Get-BrowserTargets,
    New-ExtensionZip, Get-ExtensionZipName). The entry block only performs
    filesystem side-effects and is skipped under -AsLibrary so Pester can
    dot-source safely.

.PARAMETER DistPath
    Path to the built extension dist directory. Defaults to
    frontend/extension/dist under the git repo root.

.PARAMETER OutputDir
    Directory to write the zip files into. Created if it does not exist.
    Defaults to frontend/extension/dist-zips under the git repo root.

.PARAMETER Browsers
    Array of browser targets to package. Defaults to @('chrome', 'edge', 'firefox').

.PARAMETER AsLibrary
    Define the functions without executing the entry block (for Pester).

.EXAMPLE
    ./scripts/Package-Extension.ps1
    Packages the default dist into dist-zips/chrome.zip, dist-zips/edge.zip,
    dist-zips/firefox.zip.

.EXAMPLE
    ./scripts/Package-Extension.ps1 -DistPath frontend/extension/dist -OutputDir out -Browsers chrome,edge
    Packages only Chrome and Edge zips into ./out/.
#>

[CmdletBinding()]
param(
    [string]$DistPath,
    [string]$OutputDir,
    [string[]]$Browsers,
    [switch]$AsLibrary
)

# ------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ------------------------------------------------------------------

function Get-BrowserTargets {
    <#
    .SYNOPSIS
        Return the canonical set of browser targets for a browser extension package.
        When an explicit list is provided it is returned as-is; otherwise the default
        set is used. Pure: no filesystem access, injectable for testing.
    #>
    param(
        [string[]]$Requested,
        [string[]]$Default = @('chrome', 'edge', 'firefox')
    )

    if ($Requested -and $Requested.Count -gt 0) { return $Requested }
    return $Default
}

function Get-ExtensionZipName {
    <#
    .SYNOPSIS
        Return the output zip filename for a given browser target.
        Pure: deterministic, no side effects.
    #>
    param([Parameter(Mandatory)][string]$Browser)
    return "$Browser.zip"
}

function New-ExtensionZip {
    <#
    .SYNOPSIS
        Create a zip archive of all files in a dist directory for one browser target.
        Returns the absolute path of the created zip.

        The compress function is injectable so the filesystem side-effect is
        replaceable in tests (pass a -CompressFunction scriptblock that records
        its arguments instead of writing a real file).

    .NOTES
        OutputDir must exist before calling this function. The entry block
        guarantees creation; callers outside the entry block are responsible.
    #>
    param(
        [Parameter(Mandatory)][string]$DistPath,
        [Parameter(Mandatory)][string]$OutputDir,
        [Parameter(Mandatory)][string]$Browser,
        [scriptblock]$CompressFunction = {
            param($source, $dest)
            Compress-Archive -Path "$source/*" -DestinationPath $dest -Force
        }
    )

    $zipName = Get-ExtensionZipName -Browser $Browser
    $destPath = Join-Path $OutputDir $zipName
    & $CompressFunction $DistPath $destPath
    return $destPath
}

# ------------------------------------------------------------------
# Entry block (integration only — not unit-tested)
# ------------------------------------------------------------------

if (-not $AsLibrary) {
    $ErrorActionPreference = 'Stop'
    $InformationPreference = 'Continue'

    # --- Resolve repo root & defaults -------------------------------------------
    $repoRoot = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1)
    if (-not $repoRoot) {
        Write-Error 'Not inside a git repository; pass -DistPath and -OutputDir explicitly.'
        exit 1
    }
    $repoRoot = ([string]$repoRoot).Trim()

    if ([string]::IsNullOrWhiteSpace($DistPath)) {
        $DistPath = Join-Path $repoRoot 'frontend/extension/dist'
    }

    if ([string]::IsNullOrWhiteSpace($OutputDir)) {
        $OutputDir = Join-Path $repoRoot 'frontend/extension/dist-zips'
    }

    # --- Validate dist dir ------------------------------------------------------
    if (-not (Test-Path -LiteralPath $DistPath -PathType Container)) {
        Write-Error "Dist directory not found: '$DistPath'. Run 'npm run build' first."
        exit 1
    }

    # --- Resolve targets --------------------------------------------------------
    $targets = Get-BrowserTargets -Requested $Browsers

    # --- Ensure output directory exists -----------------------------------------
    if (-not (Test-Path -LiteralPath $OutputDir)) {
        New-Item -ItemType Directory -Path $OutputDir | Out-Null
    }

    # --- Package loop -----------------------------------------------------------
    $packed = 0
    foreach ($browser in $targets) {
        $zipPath = New-ExtensionZip -DistPath $DistPath -OutputDir $OutputDir -Browser $browser
        Write-Information "Packaged $browser -> $zipPath"
        $packed++
    }

    Write-Information "Done. Packaged $packed browser extension(s) to '$OutputDir'."
    exit 0
}
