#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Format-ProtocolForm.ps1')).Path
    . $script:ScriptPath -AsLibrary
}

# ============================================================
Describe 'ConvertTo-FormFields' {

    It 'parses a single field with a same-line value' {
        $fields = ConvertTo-FormFields -Text "RESULT`nrole: backend"
        $fields.Count | Should -Be 1
        $fields[0].Name | Should -Be 'role'
        $fields[0].Items[0] | Should -Be 'backend'
    }

    It 'parses a field with multiple indented items' {
        $text = "RESULT`nchanged:`n  PollLoop.cs`n  ControlStream.cs"
        $fields = ConvertTo-FormFields -Text $text
        $fields.Count | Should -Be 1
        $fields[0].Items.Count | Should -Be 2
        $fields[0].Items[0] | Should -Be 'PollLoop.cs'
        $fields[0].Items[1] | Should -Be 'ControlStream.cs'
    }

    It 'strips leading bullet characters from items' {
        $text = "RESULT`ngate:`n  • build ok`n  • 12/12 tests"
        $fields = ConvertTo-FormFields -Text $text
        $fields[0].Items[0] | Should -Be 'build ok'
        $fields[0].Items[1] | Should -Be '12/12 tests'
    }

    It 'parses multiple fields in order' {
        $text = "RESULT`nrole: backend`nchanged: PollLoop.cs`ngate: build ok"
        $fields = ConvertTo-FormFields -Text $text
        $fields.Count | Should -Be 3
        $fields[0].Name | Should -Be 'role'
        $fields[1].Name | Should -Be 'changed'
        $fields[2].Name | Should -Be 'gate'
    }

    It 'skips the tag line and blank lines' {
        $text = "RESULT`n`nrole: backend`n`ngate: build ok"
        $fields = ConvertTo-FormFields -Text $text
        $fields.Count | Should -Be 2
    }
}

# ============================================================
Describe 'Format-ProtocolForm — output structure' {

    BeforeAll {
        $script:SimpleResult = @'
RESULT
role: backend
changed:
  PollLoop.cs
  ControlStream.cs
gate: build ok
'@
        $script:Output = Format-ProtocolForm -Text $script:SimpleResult
        $script:OutputLines = $script:Output -split "`r?`n"
    }

    It 'first line is the form tag' {
        $script:OutputLines[0] | Should -Be 'RESULT'
    }

    It 'field name appears only on the first row of that field' {
        $roleLines = $script:OutputLines | Where-Object { $_ -match '^\| role' }
        $roleLines.Count | Should -Be 1
    }

    It 'continuation rows have a blank field cell' {
        # changed has 2 items — second row should have blank first cell
        $blankFieldRows = $script:OutputLines | Where-Object { $_ -match '^\|\s+\|' }
        $blankFieldRows.Count | Should -BeGreaterOrEqual 1
    }

    It 'every table row starts with a pipe and contains exactly 3 pipes' {
        $tableRows = $script:OutputLines | Where-Object { $_ -match '^\|' }
        foreach ($row in $tableRows) {
            ($row.ToCharArray() | Where-Object { $_ -eq '|' }).Count | Should -Be 3
        }
    }

    It 'emits a dash rule after each field block' {
        $dashRules = $script:OutputLines | Where-Object { $_ -match '^-+$' }
        # 3 fields → 3 dash rules
        $dashRules.Count | Should -Be 3
    }

    It 'all dash rules have the same width as the table rows' {
        $tableRows = $script:OutputLines | Where-Object { $_ -match '^\|' }
        $rowWidth  = $tableRows[0].Length
        $dashRules = $script:OutputLines | Where-Object { $_ -match '^-+$' }
        foreach ($rule in $dashRules) {
            $rule.Length | Should -Be $rowWidth
        }
    }

    It 'all table rows have equal length (columns aligned)' {
        $tableRows = $script:OutputLines | Where-Object { $_ -match '^\|' }
        $widths    = $tableRows | ForEach-Object { $_.Length } | Sort-Object -Unique
        $widths.Count | Should -Be 1
    }

    It 'every item cell starts with a bullet character' {
        $tableRows = $script:OutputLines | Where-Object { $_ -match '^\|' }
        foreach ($row in $tableRows) {
            # Second cell (between 2nd and 3rd pipe) must start with •
            if ($row -match '^\|\s.*?\|\s*(?<cell>.*?)\s*\|$') {
                $cell = $Matches['cell'].Trim()
                if ($cell -ne '') {
                    $cell[0] | Should -Be ([char]0x2022)
                }
            }
        }
    }
}

# ============================================================
Describe 'Format-ProtocolForm — all six form tags' {

    It 'renders REVIEW tag correctly' {
        $out = Format-ProtocolForm -Text "REVIEW`nrole: backend`nscope: x`nchecked: y`nverdict: pass"
        $out | Should -Match '^REVIEW'
    }

    It 'renders BRIEF tag correctly' {
        $out = Format-ProtocolForm -Text "BRIEF`nspec: docs/index.md`nlane: backend/**`ntask: do the thing`ngate: build ok"
        $out | Should -Match '^BRIEF'
        $out | Should -Match 'spec'
    }

    It 'renders FINDING tag correctly' {
        $out = Format-ProtocolForm -Text "FINDING`nwhere: x.cs`nissue: contradiction`noptions:`n  a\n  b`nneed: decision"
        $out | Should -Match '^FINDING'
    }

    It 'renders FIX tag correctly' {
        $out = Format-ProtocolForm -Text "FIX`ntest: MyTest`nexpect: green`nactual: red`nsuspect: x.cs"
        $out | Should -Match '^FIX'
    }

    It 'renders ARTIFACT tag correctly' {
        $out = Format-ProtocolForm -Text "ARTIFACT`nspec: docs/api/openapi.yaml`ndelta: GET /things"
        $out | Should -Match '^ARTIFACT'
    }

    It 'returns input as-is when no form tag is found' {
        $raw = 'Some random text without a tag'
        Format-ProtocolForm -Text $raw | Should -Be $raw
    }
}

# ============================================================
Describe 'Resolve-FormText — input source resolution' {

    It 'prefers -Text over -InputFile' {
        Resolve-FormText -Text 'inline' -InputFile 'does-not-exist.txt' | Should -Be 'inline'
    }

    It 'reads the form from -InputFile when -Text is empty' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "form-$([System.IO.Path]::GetRandomFileName()).txt"
        try {
            Set-Content -LiteralPath $tmp -Value "RESULT`nrole: backend`nchanged: x.cs`ngate: ok" -NoNewline
            $text = Resolve-FormText -Text '' -InputFile $tmp
            $text | Should -Match 'role: backend'
        }
        finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }

    It 'throws a clear error when -InputFile does not exist' {
        { Resolve-FormText -Text '' -InputFile 'C:\nope\missing-form.txt' } |
            Should -Throw '*InputFile not found*'
    }

    # Note: the no-source path (-Text/-InputFile both empty) falls through to a
    # blocking stdin read by design — it is only reached by genuine pipe usage
    # (`Get-Content form.txt | …`, which closes on EOF). It is intentionally NOT
    # unit-tested here: exercising it in a redirected-stdin host would block.
}

# ============================================================
Describe 'Format-ProtocolForm.ps1 — -InputFile end to end (real process)' {

    It 'renders an aligned table from a file via the script entry point' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "form-$([System.IO.Path]::GetRandomFileName()).txt"
        try {
            $form = "RESULT`nrole: backend`nchanged:`n  a.cs`n  b.cs`ngate: build ok"
            Set-Content -LiteralPath $tmp -Value $form -NoNewline
            $out    = (& $script:ScriptPath -InputFile $tmp) -join "`n"
            $lines  = $out -split "`r?`n"
            $out    | Should -Match '^RESULT'
            $out    | Should -Match '\| role\s+\|'
            # All table rows aligned → identical length.
            $rows   = @($lines | Where-Object { $_ -match '^\|' })
            $rows.Count | Should -BeGreaterThan 0
            $widths = $rows | ForEach-Object { $_.Length } | Sort-Object -Unique
            @($widths).Count | Should -Be 1
        }
        finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}

# ============================================================
Describe 'Format-ProtocolForm — single vs multiple items' {

    It 'single-item field produces exactly one data row and one dash rule' {
        $out = Format-ProtocolForm -Text "RESULT`nrole: backend`nchanged: x.cs`ngate: ok"
        $lines = $out -split "`r?`n"
        $dataRows  = @($lines | Where-Object { $_ -match '^\|' })
        $dashRules = @($lines | Where-Object { $_ -match '^-+$' })
        $dataRows.Count  | Should -Be 3  # one row per field
        $dashRules.Count | Should -Be 3  # one rule per field
    }

    It 'multi-item field produces correct number of rows' {
        $text = "RESULT`nrole: backend`nchanged:`n  a.cs`n  b.cs`n  c.cs`ngate: ok"
        $out  = Format-ProtocolForm -Text $text
        $lines = $out -split "`r?`n"
        $dataRows = @($lines | Where-Object { $_ -match '^\|' })
        # role=1, changed=3, gate=1 → 5 rows
        $dataRows.Count | Should -Be 5
    }
}
