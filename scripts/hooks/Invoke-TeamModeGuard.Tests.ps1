#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ScriptPath = (Resolve-Path (Join-Path $PSScriptRoot 'Invoke-TeamModeGuard.ps1')).Path
    . $script:ScriptPath -AsLibrary
    $script:SchemaFile = (Resolve-Path (Join-Path $PSScriptRoot '..' '..' '.claude' 'team-process' 'schemas' 'session.schema.json')).Path
    $script:FixedNow = [datetime]'2026-06-14T12:00:00Z'

    function New-TmpRoot {
        $r = Join-Path ([System.IO.Path]::GetTempPath()) "tmg-$(New-Guid)"
        New-Item -ItemType Directory -Path $r -Force | Out-Null
        return $r
    }
}

# ============================================================
Describe 'Get-TeamModeDecision' {

    It 'allows a subagent caller (even with an active session)' {
        (Get-TeamModeDecision -IsSubagent $true -SessionActive $true -HasTeamName $false).Block | Should -BeFalse
    }
    It 'allows when no session is active' {
        (Get-TeamModeDecision -IsSubagent $false -SessionActive $false -HasTeamName $false).Block | Should -BeFalse
    }
    It 'allows a member spawn (session active + team_name set)' {
        (Get-TeamModeDecision -IsSubagent $false -SessionActive $true -HasTeamName $true).Block | Should -BeFalse
    }
    It 'blocks a foreground in-session subagent when a session is active' {
        $d = Get-TeamModeDecision -IsSubagent $false -SessionActive $true -HasTeamName $false
        $d.Block | Should -BeTrue
        $d.Reason | Should -Match 'Team mode is active'
        $d.Reason | Should -Match 'team_name'
        $d.Reason | Should -Match 'EndSession'
    }
    It 'allows team_name present without an active session yet' {
        (Get-TeamModeDecision -IsSubagent $false -SessionActive $false -HasTeamName $true).Block | Should -BeFalse
    }
}

# ============================================================
Describe 'Path helpers' {
    It 'session file is under .team-process/run' {
        (Get-SessionFilePath -Root 'C:/r') -replace '\\', '/' | Should -Match '/\.team-process/run/session\.json$'
    }
    It 'lane file is under .team-process/run' {
        (Get-LaneFilePath -Root 'C:/r') -replace '\\', '/' | Should -Match '/\.team-process/run/lane$'
    }
}

# ============================================================
Describe 'Get-TeamCreateName' {
    It 'reads tool_input.team_name' {
        Get-TeamCreateName -Payload ([pscustomobject]@{ tool_input = [pscustomobject]@{ team_name = 'feat-9' } }) | Should -Be 'feat-9'
    }
    It 'falls back to tool_input.name' {
        Get-TeamCreateName -Payload ([pscustomobject]@{ tool_input = [pscustomobject]@{ name = 'feat-x' } }) | Should -Be 'feat-x'
    }
    It 'reads from tool_response when tool_input lacks it' {
        Get-TeamCreateName -Payload ([pscustomobject]@{ tool_input = [pscustomobject]@{}; tool_response = [pscustomobject]@{ team = 'feat-r' } }) | Should -Be 'feat-r'
    }
    It 'returns empty when no name is present' {
        Get-TeamCreateName -Payload ([pscustomobject]@{ tool_input = [pscustomobject]@{} }) | Should -Be ''
    }
}

# ============================================================
Describe 'New-SessionRecord' {
    It 'builds a fresh record with phase=created and matching timestamps' {
        $r = New-SessionRecord -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $null
        $r.team | Should -Be 'feat-1'
        $r.branch | Should -Be 'feat/x'
        $r.phase | Should -Be 'created'
        $r.createdAt | Should -Be $r.updatedAt
    }
    It 'omits roster and ledger when empty' {
        $r = New-SessionRecord -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $null
        $r.Contains('roster') | Should -BeFalse
        $r.Contains('ledger') | Should -BeFalse
    }
    It 'falls back to team=unknown when none supplied' {
        (New-SessionRecord -Team '' -Branch '' -Now $script:FixedNow -Existing $null).team | Should -Be 'unknown'
    }
    It 'preserves createdAt, ledger, roster, issue on re-create (merge)' {
        $existing = [pscustomobject]@{
            team = 'feat-1'; branch = 'feat/x'; issue = '#42'; phase = 'implement'
            createdAt = '2026-01-01T00:00:00Z'; updatedAt = '2026-01-01T00:00:00Z'
            roster = @([pscustomobject]@{ role = 'backend' }); ledger = @([pscustomobject]@{ wave = 1 })
        }
        $r = New-SessionRecord -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $existing
        $r.createdAt | Should -Be '2026-01-01T00:00:00Z'
        $r.phase     | Should -Be 'implement'
        $r.issue     | Should -Be '#42'
        @($r.roster).Count | Should -Be 1
        @($r.ledger).Count | Should -Be 1
        $r.updatedAt | Should -Not -Be $r.createdAt
    }
}

# ============================================================
Describe 'Get-SessionReminder' {
    It 'summarizes the record and names the abandon command' {
        $rec = [pscustomobject]@{ team = 'feat-1'; branch = 'feat/x'; phase = 'implement'; createdAt = '2026-01-01T00:00:00Z' }
        $msg = Get-SessionReminder -Record $rec
        $msg | Should -Match 'feat-1'
        $msg | Should -Match 'feat/x'
        $msg | Should -Match 'implement'
        $msg | Should -Match 'EndSession'
        $msg | Should -Match 'RESUME'
    }
}

# ============================================================
Describe 'Set/Clear/Get session round-trip (temp root)' {

    It 'Set-TeamSession writes a schema-valid session.json' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            $file = Get-SessionFilePath -Root $root
            Test-Path -LiteralPath $file | Should -BeTrue
            (Get-Content -LiteralPath $file -Raw | Test-Json -SchemaFile $script:SchemaFile) | Should -BeTrue
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'Set-TeamSession merges (preserves createdAt, advances updatedAt) on re-create' {
        $root = New-TmpRoot
        try {
            $rec1 = Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now ([datetime]'2026-01-01T00:00:00Z')
            $rec2 = Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow
            # createdAt preserved verbatim across the JSON round-trip; updatedAt moved on.
            $rec2.createdAt | Should -Be $rec1.createdAt
            $rec2.updatedAt | Should -Not -Be $rec1.updatedAt
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'Get-SessionStartContext yields additionalContext when active, empty when not' {
        $root = New-TmpRoot
        try {
            (Get-SessionStartContext -Root $root) | Should -Be ''
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            $ctx = Get-SessionStartContext -Root $root
            $ctx | Should -Match 'additionalContext'
            $ctx | Should -Match 'SessionStart'
            $ctx | Should -Match 'feat-1'
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'Clear-TeamSession removes session + lane and is idempotent' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            Set-Content -LiteralPath (Get-LaneFilePath -Root $root) -Value 'backend/**'
            Clear-TeamSession -Root $root
            Test-Path -LiteralPath (Get-SessionFilePath -Root $root) | Should -BeFalse
            Test-Path -LiteralPath (Get-LaneFilePath -Root $root) | Should -BeFalse
            { Clear-TeamSession -Root $root } | Should -Not -Throw
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }
}

# ============================================================
Describe 'Entry block plumbing (subprocess)' {

    It 'empty stdin exits 0 with no output' {
        $result = '' | pwsh -NonInteractive -NoProfile -File $script:ScriptPath 2>$null
        $LASTEXITCODE | Should -Be 0
        $result | Should -BeNullOrEmpty
    }
    It 'no active session in the real repo → no block JSON' {
        $payload = @{ tool_name = 'Agent'; agent_type = ''; agent_id = ''; tool_input = @{ team_name = '' } } | ConvertTo-Json -Compress
        $result = $payload | pwsh -NonInteractive -NoProfile -File $script:ScriptPath 2>$null
        $LASTEXITCODE | Should -Be 0
        $result | Should -BeNullOrEmpty
    }
}
