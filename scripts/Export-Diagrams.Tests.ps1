#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Export-Diagrams.ps1')).Path
    . $script:ScriptPath -AsLibrary

    # A minimal stand-in for a draw.io SVG export header.
    $script:SampleSvg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ' +
    'style="background: transparent; background-color: transparent; color-scheme: light dark;" ' +
    'version="1.1" width="701px" height="954px" viewBox="0 0 701 954"><defs/><g><rect/></g></svg>'
}

# ============================================================
Describe 'Get-SvgDimensions' {

    It 'parses the viewBox rectangle' {
        $d = Get-SvgDimensions -Content '<svg viewBox="0 0 701 954">'
        $d.X | Should -Be '0'
        $d.Y | Should -Be '0'
        $d.Width | Should -Be '701'
        $d.Height | Should -Be '954'
    }

    It 'parses a non-zero viewBox origin' {
        $d = Get-SvgDimensions -Content '<svg viewBox="-10 -20 300 400">'
        $d.X | Should -Be '-10'
        $d.Y | Should -Be '-20'
        $d.Width | Should -Be '300'
        $d.Height | Should -Be '400'
    }

    It 'falls back to width/height attributes (stripping px) when no viewBox' {
        $d = Get-SvgDimensions -Content '<svg width="640px" height="480px">'
        $d.X | Should -Be '0'
        $d.Y | Should -Be '0'
        $d.Width | Should -Be '640'
        $d.Height | Should -Be '480'
    }

    It 'falls back to 100% when neither viewBox nor dimensions are present' {
        $d = Get-SvgDimensions -Content '<svg foo="bar">'
        $d.Width | Should -Be '100%'
        $d.Height | Should -Be '100%'
    }
}

# ============================================================
Describe 'Set-SvgWhiteBackground' {

    It 'returns the content unchanged when color is transparent' {
        Set-SvgWhiteBackground -Content $SampleSvg -Color 'transparent' | Should -Be $SampleSvg
    }

    It 'replaces the transparent background with the colour' {
        $out = Set-SvgWhiteBackground -Content $SampleSvg -Color '#ffffff'
        $out | Should -Match 'background:#ffffff'
        $out | Should -Match 'background-color:#ffffff'
        $out | Should -Not -Match 'transparent'
    }

    It 'removes the color-scheme dark hint' {
        $out = Set-SvgWhiteBackground -Content $SampleSvg
        $out | Should -Not -Match 'color-scheme'
    }

    It 'inserts a backing rect as the first child of <svg>' {
        $out = Set-SvgWhiteBackground -Content $SampleSvg -Color '#ffffff'
        $out | Should -Match '<rect id="svg-bg" x="0" y="0" width="701" height="954" fill="#ffffff"/>'
        # The rect must come before the original content group.
        $out.IndexOf('id="svg-bg"') | Should -BeLessThan $out.IndexOf('<g>')
    }

    It 'honours a custom colour' {
        $out = Set-SvgWhiteBackground -Content $SampleSvg -Color '#101014'
        $out | Should -Match 'fill="#101014"'
        $out | Should -Match 'background:#101014'
    }

    It 'is idempotent — running twice adds only one backing rect' {
        $once = Set-SvgWhiteBackground -Content $SampleSvg
        $twice = Set-SvgWhiteBackground -Content $once
        ([regex]::Matches($twice, 'id="svg-bg"')).Count | Should -Be 1
    }
}

# ============================================================
Describe 'Get-DrawioExportArgument' {

    It 'builds the cropped SVG export argument array in order' {
        $a = Get-DrawioExportArgument -InputPath 'in.drawio' -OutputPath 'out.svg' -Border 12
        $a | Should -Be @('-x', '-f', 'svg', '--crop', '--embed-svg-images', '-b', '12', '-o', 'out.svg', 'in.drawio')
    }

    It 'always embeds shape-library images (else built-in icons render broken)' {
        $a = Get-DrawioExportArgument -InputPath 'i' -OutputPath 'o'
        $a | Should -Contain '--embed-svg-images'
    }

    It 'threads a custom border through as a string' {
        $a = Get-DrawioExportArgument -InputPath 'i' -OutputPath 'o' -Border 0
        $a[($a.IndexOf('-b') + 1)] | Should -Be '0'
    }
}

# ============================================================
Describe 'Get-DrawioCandidatePath' {

    It 'returns Windows install locations including Program Files' {
        $paths = Get-DrawioCandidatePath -Windows $true -MacOS $false `
            -ProgramFiles 'C:\Program Files' -ProgramFilesX86 'C:\Program Files (x86)' -LocalAppData 'C:\Users\x\AppData\Local'
        $paths.Count | Should -Be 3
        ($paths | Where-Object { $_ -like '*Program Files*draw.io*draw.io.exe' }).Count | Should -BeGreaterThan 0
    }

    It 'skips null env bases on Windows' {
        $paths = Get-DrawioCandidatePath -Windows $true -MacOS $false `
            -ProgramFiles 'C:\Program Files' -ProgramFilesX86 '' -LocalAppData ''
        $paths.Count | Should -Be 1
    }

    It 'returns the .app bundle path on macOS' {
        $paths = Get-DrawioCandidatePath -Windows $false -MacOS $true
        $paths | Should -Contain '/Applications/draw.io.app/Contents/MacOS/draw.io'
    }

    It 'returns drawio binary paths on Linux' {
        $paths = Get-DrawioCandidatePath -Windows $false -MacOS $false
        $paths | Should -Contain '/usr/bin/drawio'
    }
}

# ============================================================
Describe 'Resolve-DrawioExecutable' {

    It 'returns the explicit path when it exists' {
        $exe = Resolve-DrawioExecutable -ExplicitPath '/opt/drawio' `
            -PathTester { param($p) $true } -CommandResolver { param($n) $null }
        $exe | Should -Be '/opt/drawio'
    }

    It 'throws when the explicit path is missing' {
        { Resolve-DrawioExecutable -ExplicitPath '/nope' `
                -PathTester { param($p) $false } -CommandResolver { param($n) $null } } |
            Should -Throw '*not found at -DrawioPath*'
    }

    It 'prefers a drawio binary found on PATH' {
        $exe = Resolve-DrawioExecutable `
            -CandidatePath @('/never/used') `
            -PathTester { param($p) $true } `
            -CommandResolver { param($n) '/usr/local/bin/drawio' }
        $exe | Should -Be '/usr/local/bin/drawio'
    }

    It 'falls back to the first existing candidate when PATH lookup fails' {
        $exe = Resolve-DrawioExecutable `
            -CandidatePath @('/missing/one', '/present/two') `
            -PathTester { param($p) $p -eq '/present/two' } `
            -CommandResolver { param($n) $null }
        $exe | Should -Be '/present/two'
    }

    It 'throws a helpful message when nothing is found' {
        { Resolve-DrawioExecutable `
                -CandidatePath @('/missing') `
                -PathTester { param($p) $false } `
                -CommandResolver { param($n) $null } } |
            Should -Throw '*draw.io CLI not found*'
    }
}
