#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Package-Extension.ps1')).Path
    . $script:ScriptPath -AsLibrary
}

# ============================================================
Describe 'Get-BrowserTargets' {

    It 'returns the default set when no targets are requested' {
        $targets = Get-BrowserTargets -Requested @()
        $targets | Should -Be @('chrome', 'edge', 'firefox')
    }

    It 'returns the default set when Requested is null' {
        $targets = Get-BrowserTargets -Requested $null
        $targets | Should -Be @('chrome', 'edge', 'firefox')
    }

    It 'returns the explicit list unchanged when provided' {
        $targets = Get-BrowserTargets -Requested @('chrome', 'edge')
        $targets | Should -Be @('chrome', 'edge')
    }

    It 'returns a single target when only one is requested' {
        $targets = Get-BrowserTargets -Requested @('firefox')
        $targets | Should -Be @('firefox')
    }

    It 'honours a custom default set' {
        $targets = Get-BrowserTargets -Requested @() -Default @('opera', 'brave')
        $targets | Should -Be @('opera', 'brave')
    }
}

# ============================================================
Describe 'Get-ExtensionZipName' {

    It 'returns <browser>.zip for chrome' {
        Get-ExtensionZipName -Browser 'chrome' | Should -Be 'chrome.zip'
    }

    It 'returns <browser>.zip for edge' {
        Get-ExtensionZipName -Browser 'edge' | Should -Be 'edge.zip'
    }

    It 'returns <browser>.zip for firefox' {
        Get-ExtensionZipName -Browser 'firefox' | Should -Be 'firefox.zip'
    }

    It 'returns <browser>.zip for any arbitrary browser name' {
        Get-ExtensionZipName -Browser 'opera' | Should -Be 'opera.zip'
    }
}

# ============================================================
Describe 'New-ExtensionZip' {

    It 'calls the compress function with the dist source and the expected destination path' {
        $calls = [System.Collections.Generic.List[hashtable]]::new()
        $mockCompress = {
            param($source, $dest)
            $calls.Add(@{ Source = $source; Dest = $dest })
        }

        New-ExtensionZip -DistPath '/dist' -OutputDir '/out' -Browser 'chrome' `
            -CompressFunction $mockCompress | Out-Null

        $calls.Count | Should -Be 1
        $calls[0].Source | Should -Be '/dist'
        $calls[0].Dest   | Should -Be (Join-Path '/out' 'chrome.zip')
    }

    It 'returns the absolute path of the created zip' {
        $mockCompress = { param($source, $dest) }

        $result = New-ExtensionZip -DistPath '/dist' -OutputDir '/out' -Browser 'firefox' `
            -CompressFunction $mockCompress

        $result | Should -Be (Join-Path '/out' 'firefox.zip')
    }

    It 'constructs the zip name via Get-ExtensionZipName (consistent with browser name)' {
        $capturedDest = $null
        $mockCompress = { param($source, $dest) $script:capturedDest = $dest }

        New-ExtensionZip -DistPath 'src' -OutputDir 'out' -Browser 'edge' `
            -CompressFunction $mockCompress | Out-Null

        $script:capturedDest | Should -BeLike '*edge.zip'
    }

    It 'passes the exact DistPath to the compress function unchanged' {
        $capturedSource = $null
        $mockCompress = { param($source, $dest) $script:capturedSource = $source }

        New-ExtensionZip -DistPath '/my/dist/dir' -OutputDir 'out' -Browser 'chrome' `
            -CompressFunction $mockCompress | Out-Null

        $script:capturedSource | Should -Be '/my/dist/dir'
    }
}
