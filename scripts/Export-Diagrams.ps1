#Requires -Version 7.0

<#
.SYNOPSIS
    Export draw.io diagrams to SVG with a baked-in background.

.DESCRIPTION
    Renders every *.drawio under -Path (default: docs/diagrams) to a sibling
    *.svg via the draw.io desktop CLI, then post-processes each SVG to bake in a
    solid background colour. The dashboard docs are dark-first (MkDocs Material
    slate theme); draw.io exports a transparent background and a
    "color-scheme: light dark" hint, so dark edge-label text would vanish on the
    dark page. Baking a white backing rect makes each diagram a theme-independent
    "card" that reads on both light and dark surfaces.

    This replaces the previous manual two-step (CLI export, then hand-edit the
    SVG header) with a single command.

    NOTE: rendering needs the draw.io desktop app (an Electron binary), which is
    a developer/local dependency — it is not present in typical CI runners, so
    this script is run locally and the committed SVGs are reviewed in the PR. The
    script's *logic* (SVG transform, executable resolution, argument building) is
    pure and fully Pester-covered, which is the CI gate per CLAUDE.md §Scripts.

    All decision logic lives in pure functions (Get-SvgDimensions,
    Set-SvgWhiteBackground, Get-DrawioExportArgument, Resolve-DrawioExecutable,
    Get-DrawioCandidatePath). The entry block only performs process/file side
    effects and is skipped under -AsLibrary so Pester can dot-source safely.

.PARAMETER Path
    A single .drawio file or a directory to search recursively. Defaults to
    docs/diagrams under the git repo root.

.PARAMETER DrawioPath
    Explicit path to the draw.io executable. When omitted, the script looks for
    'drawio' on PATH, then known per-platform install locations.

.PARAMETER Background
    Background colour baked into each SVG (default '#ffffff'). Pass 'transparent'
    to keep the raw draw.io export untouched.

.PARAMETER Border
    Padding (px) around the cropped content passed to draw.io (-b). Default 12.

.PARAMETER TimeoutSeconds
    Max seconds to wait for each SVG to be written (the Electron export can
    return before the file is flushed). Default 60.

.PARAMETER AsLibrary
    Define the functions without executing the entry block (for Pester).

.EXAMPLE
    ./scripts/Export-Diagrams.ps1
    Re-exports every diagram under docs/diagrams with a white background.

.EXAMPLE
    ./scripts/Export-Diagrams.ps1 -Path docs/diagrams/architecture-c4.drawio
    Re-exports a single diagram.
#>

[CmdletBinding()]
param(
    [string]$Path,
    [string]$DrawioPath,
    [string]$Background = '#ffffff',
    [int]$Border = 12,
    [int]$TimeoutSeconds = 60,
    [switch]$AsLibrary
)

# ------------------------------------------------------------------
# Pure functions (fully unit-tested)
# ------------------------------------------------------------------

function Get-SvgDimensions {
    <#
    .SYNOPSIS
        Extract the drawing rectangle from an SVG. Prefers viewBox
        ("minX minY width height"); falls back to the width/height attributes.
        Returns a parts object with string X/Y/Width/Height.
    #>
    param([Parameter(Mandatory)][string]$Content)

    if ($Content -match 'viewBox="\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*"') {
        return [pscustomobject]@{
            X      = $Matches[1]
            Y      = $Matches[2]
            Width  = $Matches[3]
            Height = $Matches[4]
        }
    }

    $w = if ($Content -match 'width="([\d.]+)(?:px)?"') { $Matches[1] } else { '100%' }
    $h = if ($Content -match 'height="([\d.]+)(?:px)?"') { $Matches[1] } else { '100%' }
    return [pscustomobject]@{ X = '0'; Y = '0'; Width = $w; Height = $h }
}

function Set-SvgWhiteBackground {
    <#
    .SYNOPSIS
        Bake a solid background into a draw.io-exported SVG. Pure string
        transform; idempotent (re-running adds no second backing rect).
        Returns the content unchanged when -Color is 'transparent'.
    #>
    param(
        [Parameter(Mandatory)][string]$Content,
        [string]$Color = '#ffffff'
    )

    if ($Color -eq 'transparent') { return $Content }

    $svg = $Content

    # 1) Neutralise the transparent canvas + the UA dark-mode hint on the root.
    $svg = $svg -replace 'color-scheme:\s*light dark;?', ''
    $svg = $svg -replace 'background-color:\s*transparent', "background-color:$Color"
    $svg = $svg -replace 'background:\s*transparent', "background:$Color"

    # 2) Paint a backing rect as the first child so the colour is baked into the
    #    rendered image (covers <img>/raster contexts, not just the CSS canvas).
    if ($svg -notmatch 'id="svg-bg"') {
        $dims = Get-SvgDimensions -Content $svg
        $rect = '<rect id="svg-bg" x="{0}" y="{1}" width="{2}" height="{3}" fill="{4}"/>' -f `
            $dims.X, $dims.Y, $dims.Width, $dims.Height, $Color
        $opening = [regex]'(<svg\b[^>]*>)'
        if ($opening.IsMatch($svg)) {
            $svg = $opening.Replace($svg, ('$1' + $rect), 1)
        }
    }

    return $svg
}

function Get-DrawioExportArgument {
    <#
    .SYNOPSIS
        Build the draw.io CLI argument array for a cropped SVG export.
        Kept pure so the exact invocation is verifiable without launching Electron.
    #>
    param(
        [Parameter(Mandatory)][string]$InputPath,
        [Parameter(Mandatory)][string]$OutputPath,
        [int]$Border = 12
    )
    return @('-x', '-f', 'svg', '--crop', '-b', "$Border", '-o', $OutputPath, $InputPath)
}

function Get-DrawioCandidatePath {
    <#
    .SYNOPSIS
        Per-platform default install locations for the draw.io desktop binary.
        Platform + env bases are parameters so the selection is unit-testable.
    #>
    param(
        [bool]$Windows = $IsWindows,
        [bool]$MacOS = $IsMacOS,
        [string]$ProgramFiles = $env:ProgramFiles,
        [string]$ProgramFilesX86 = ${env:ProgramFiles(x86)},
        [string]$LocalAppData = $env:LOCALAPPDATA
    )

    if ($Windows) {
        $paths = @()
        if ($ProgramFiles) { $paths += (Join-Path $ProgramFiles 'draw.io/draw.io.exe') }
        if ($ProgramFilesX86) { $paths += (Join-Path $ProgramFilesX86 'draw.io/draw.io.exe') }
        if ($LocalAppData) { $paths += (Join-Path $LocalAppData 'Programs/draw.io/draw.io.exe') }
        return $paths
    }

    if ($MacOS) {
        return @('/Applications/draw.io.app/Contents/MacOS/draw.io')
    }

    return @('/usr/bin/drawio', '/usr/local/bin/drawio', '/snap/bin/drawio', '/opt/drawio/drawio')
}

function Resolve-DrawioExecutable {
    <#
    .SYNOPSIS
        Resolve the draw.io executable. Precedence: explicit path > 'drawio' on
        PATH > known install locations. The filesystem + command lookups are
        injectable scriptblocks so the precedence logic is unit-testable.
    #>
    param(
        [string]$ExplicitPath,
        [string[]]$CandidatePath = (Get-DrawioCandidatePath),
        [scriptblock]$PathTester = { param($p) Test-Path -LiteralPath $p },
        [scriptblock]$CommandResolver = { param($n) (Get-Command $n -ErrorAction SilentlyContinue).Source }
    )

    if ($ExplicitPath) {
        if (& $PathTester $ExplicitPath) { return $ExplicitPath }
        throw "draw.io executable not found at -DrawioPath '$ExplicitPath'."
    }

    $onPath = & $CommandResolver 'drawio'
    if ($onPath) { return $onPath }

    foreach ($candidate in $CandidatePath) {
        if ($candidate -and (& $PathTester $candidate)) { return $candidate }
    }

    throw 'draw.io CLI not found. Install draw.io desktop or pass -DrawioPath. See https://github.com/jgraph/drawio-desktop/releases.'
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

    function Wait-ForStableFile {
        param([string]$LiteralPath, [int]$TimeoutSeconds)
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        $lastSize = -1
        while ((Get-Date) -lt $deadline) {
            if (Test-Path -LiteralPath $LiteralPath) {
                $size = (Get-Item -LiteralPath $LiteralPath).Length
                if ($size -gt 0 -and $size -eq $lastSize) { return $true }
                $lastSize = $size
            }
            Start-Sleep -Milliseconds 500
        }
        return (Test-Path -LiteralPath $LiteralPath)
    }

    # --- Resolve target path ----------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($Path)) {
        $repoRoot = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1)
        if (-not $repoRoot) { Write-Fail 'Not inside a git repository; pass -Path explicitly.' }
        $Path = Join-Path ([string]$repoRoot).Trim() 'docs/diagrams'
    }

    # --- Enumerate .drawio inputs ----------------------------------------------
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $inputs = @((Resolve-Path -LiteralPath $Path).Path)
    }
    elseif (Test-Path -LiteralPath $Path -PathType Container) {
        $inputs = @(Get-ChildItem -LiteralPath $Path -Filter *.drawio -Recurse -File |
                Select-Object -ExpandProperty FullName)
    }
    else {
        Write-Fail "Path not found: '$Path'."
    }
    if (-not $inputs -or $inputs.Count -eq 0) { Write-Fail "No .drawio files found under '$Path'." }

    # --- Resolve executable -----------------------------------------------------
    try { $exe = Resolve-DrawioExecutable -ExplicitPath $DrawioPath }
    catch { Write-Fail $_.Exception.Message }
    Write-Information "draw.io: $exe"

    # --- Export loop ------------------------------------------------------------
    $exported = 0
    foreach ($inputFile in $inputs) {
        $outputFile = [System.IO.Path]::ChangeExtension($inputFile, '.svg')
        if (Test-Path -LiteralPath $outputFile) { Remove-Item -LiteralPath $outputFile -Force }

        $exportArgs = Get-DrawioExportArgument -InputPath $inputFile -OutputPath $outputFile -Border $Border
        Write-Information "Exporting $inputFile -> $outputFile"
        & $exe @exportArgs 2>&1 | Out-String | Write-Verbose

        if (-not (Wait-ForStableFile -LiteralPath $outputFile -TimeoutSeconds $TimeoutSeconds)) {
            Write-Fail "Export produced no output for '$inputFile'. Is draw.io desktop installed and not already running?"
        }

        if ($Background -ne 'transparent') {
            $svg = Get-Content -LiteralPath $outputFile -Raw
            $svg = Set-SvgWhiteBackground -Content $svg -Color $Background
            Set-Content -LiteralPath $outputFile -Value $svg -NoNewline -Encoding utf8
        }
        $exported++
    }

    Write-Information "Done. Exported $exported diagram(s) with background '$Background'."
    exit 0
}
