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
    It 'session file is sessions/<id>/session.json' {
        (Get-SessionFilePath -Root 'C:/r' -Id 'feat-9') -replace '\\', '/' | Should -Match '/\.team-process/run/sessions/feat-9/session\.json$'
    }
    It 'session dir is sessions/<id>' {
        (Get-SessionDir -Root 'C:/r' -Id 'feat-9') -replace '\\', '/' | Should -Match '/\.team-process/run/sessions/feat-9$'
    }
    It 'outbox dir is sessions/<id>/outbox' {
        (Get-OutboxDir -Root 'C:/r' -Id 'feat-9') -replace '\\', '/' | Should -Match '/\.team-process/run/sessions/feat-9/outbox$'
    }
    It 'sessions dir is under .team-process/run' {
        (Get-SessionsDir -Root 'C:/r') -replace '\\', '/' | Should -Match '/\.team-process/run/sessions$'
    }
    It 'lane file is under .team-process/run' {
        (Get-LaneFilePath -Root 'C:/r') -replace '\\', '/' | Should -Match '/\.team-process/run/lane$'
    }
}

# ============================================================
Describe 'ConvertTo-SessionId' {
    It 'passes through an already-safe team name' {
        ConvertTo-SessionId -Team 'feat-321' | Should -Be 'feat-321'
    }
    It 'replaces unsafe characters and trims separators' {
        ConvertTo-SessionId -Team 'feat/3 21!' | Should -Be 'feat-3-21'
    }
    It 'falls back to unknown for blank input' {
        ConvertTo-SessionId -Team '' | Should -Be 'unknown'
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
    It 'builds a fresh record with id, phase=created and matching timestamps' {
        $r = New-SessionRecord -Id 'feat-1' -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $null
        $r.id        | Should -Be 'feat-1'
        $r.team      | Should -Be 'feat-1'
        $r.branch    | Should -Be 'feat/x'
        $r.phase     | Should -Be 'created'
        $r.createdAt | Should -Be $r.updatedAt
    }
    It 'defaults workflow to feature-team' {
        (New-SessionRecord -Id 'feat-1' -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $null).workflow | Should -Be 'feature-team'
    }
    It 'derives id from team when -Id omitted' {
        (New-SessionRecord -Team 'feat/9 a' -Branch '' -Now $script:FixedNow -Existing $null).id | Should -Be 'feat-9-a'
    }
    It 'honors an explicit workflow' {
        (New-SessionRecord -Id 'task-1' -Team 'task-1' -Workflow 'freeform' -Branch '' -Now $script:FixedNow -Existing $null).workflow | Should -Be 'freeform'
    }
    It 'omits roster and ledger when empty' {
        $r = New-SessionRecord -Id 'feat-1' -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $null
        $r.Contains('roster') | Should -BeFalse
        $r.Contains('ledger') | Should -BeFalse
    }
    It 'falls back to team=unknown when none supplied' {
        (New-SessionRecord -Id 'unknown' -Team '' -Branch '' -Now $script:FixedNow -Existing $null).team | Should -Be 'unknown'
    }
    It 'preserves id, workflow, createdAt, ledger, roster, issue, task on re-create (merge)' {
        $existing = [pscustomobject]@{
            id = 'feat-1'; workflow = 'freeform'; team = 'feat-1'; branch = 'feat/x'; issue = '#42'; task = 'do thing'; phase = 'implement'
            createdAt = '2026-01-01T00:00:00Z'; updatedAt = '2026-01-01T00:00:00Z'
            roster = @([pscustomobject]@{ role = 'backend' }); ledger = @([pscustomobject]@{ wave = 1 })
        }
        $r = New-SessionRecord -Id 'feat-1' -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $existing
        $r.id        | Should -Be 'feat-1'
        $r.workflow  | Should -Be 'freeform'
        $r.createdAt | Should -Be '2026-01-01T00:00:00Z'
        $r.phase     | Should -Be 'implement'
        $r.issue     | Should -Be '#42'
        $r.task      | Should -Be 'do thing'
        @($r.roster).Count | Should -Be 1
        @($r.ledger).Count | Should -Be 1
        $r.updatedAt | Should -Not -Be $r.createdAt
    }
}

# ============================================================
Describe 'Schema conformance' {
    It 'accepts a feature-team record with an enum phase' {
        $r = New-SessionRecord -Id 'feat-1' -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $null
        ($r | ConvertTo-Json -Depth 8 | Test-Json -SchemaFile $script:SchemaFile) | Should -BeTrue
    }
    It 'accepts a freeform record with a free-form phase string' {
        $r = New-SessionRecord -Id 'task-1' -Team 'task-1' -Workflow 'freeform' -Branch 'feat/x' -Now $script:FixedNow -Existing ([pscustomobject]@{ phase = 'gathering' })
        ($r | ConvertTo-Json -Depth 8 | Test-Json -SchemaFile $script:SchemaFile) | Should -BeTrue
    }
    It 'rejects a feature-team record with a non-enum phase' {
        $bad = [ordered]@{ id = 'feat-1'; workflow = 'feature-team'; team = 'feat-1'; phase = 'gathering'; createdAt = '2026-01-01T00:00:00Z' }
        ($bad | ConvertTo-Json -Depth 8 | Test-Json -SchemaFile $script:SchemaFile -ErrorAction SilentlyContinue) | Should -BeFalse
    }
    It 'rejects a record missing the required workflow field' {
        $bad = [ordered]@{ id = 'feat-1'; team = 'feat-1'; createdAt = '2026-01-01T00:00:00Z' }
        ($bad | ConvertTo-Json -Depth 8 | Test-Json -SchemaFile $script:SchemaFile -ErrorAction SilentlyContinue) | Should -BeFalse
    }
}

# ============================================================
Describe 'Get-SessionReminder' {
    It 'lists a single active record and names the abandon command' {
        $rec = [pscustomobject]@{ id = 'feat-1'; workflow = 'feature-team'; branch = 'feat/x'; phase = 'implement'; createdAt = '2026-01-01T00:00:00Z' }
        $msg = Get-SessionReminder -Records @($rec)
        $msg | Should -Match 'feat-1'
        $msg | Should -Match 'feat/x'
        $msg | Should -Match 'implement'
        $msg | Should -Match 'EndSession'
        $msg | Should -Match 'RESUME'
        $msg | Should -Match '1 run\(s\)'
    }
    It 'lists every active record when multiple sessions are present' {
        $a = [pscustomobject]@{ id = 'feat-1'; workflow = 'feature-team'; branch = 'b1'; phase = 'implement' }
        $b = [pscustomobject]@{ id = 'task-2'; workflow = 'freeform'; branch = 'b2'; phase = 'running' }
        $msg = Get-SessionReminder -Records @($a, $b)
        $msg | Should -Match 'feat-1'
        $msg | Should -Match 'task-2'
        $msg | Should -Match 'freeform'
        $msg | Should -Match '2 run\(s\)'
    }
}

# ============================================================
Describe 'Set/Clear/Get session round-trip (temp root)' {

    It 'Set-TeamSession writes a schema-valid record under sessions/<id>/session.json' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Workflow 'feature-team' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            $file = Get-SessionFilePath -Root $root -Id 'feat-1'
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
            $rec2.createdAt | Should -Be $rec1.createdAt
            $rec2.updatedAt | Should -Not -Be $rec1.updatedAt
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'supports two concurrent sessions in one root' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b1' -Now $script:FixedNow | Out-Null
            Set-TeamSession -Root $root -Team 'task-2' -Workflow 'freeform' -Branch 'b2' -Now $script:FixedNow | Out-Null
            (Get-ActiveSessionFiles -Root $root).Count | Should -Be 2
            (Test-AnySessionActive -Root $root) | Should -BeTrue
            $ctx = Get-SessionStartContext -Root $root
            $ctx | Should -Match 'feat-1'
            $ctx | Should -Match 'task-2'
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

    It 'Clear-TeamSession -Id removes that session dir (incl. outbox), leaving others' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b1' -Now $script:FixedNow | Out-Null
            Set-TeamSession -Root $root -Team 'task-2' -Workflow 'freeform' -Branch 'b2' -Now $script:FixedNow | Out-Null
            $outbox = Get-OutboxDir -Root $root -Id 'feat-1'
            New-Item -ItemType Directory -Path $outbox -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $outbox 'backend.RESULT.json') -Value '{}'
            Clear-TeamSession -Root $root -Id 'feat-1'
            Test-Path -LiteralPath (Get-SessionDir -Root $root -Id 'feat-1') | Should -BeFalse
            Test-Path -LiteralPath (Get-SessionFilePath -Root $root -Id 'task-2') | Should -BeTrue
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'Clear-TeamSession (no id) removes all sessions + lane and is idempotent' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            Set-Content -LiteralPath (Get-LaneFilePath -Root $root) -Value 'backend/**'
            Clear-TeamSession -Root $root
            Test-Path -LiteralPath (Get-SessionFilePath -Root $root -Id 'feat-1') | Should -BeFalse
            Test-Path -LiteralPath (Get-LaneFilePath -Root $root) | Should -BeFalse
            { Clear-TeamSession -Root $root } | Should -Not -Throw
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }
}

# ============================================================
Describe 'Sync-LaneFromSession' {
    It 'projects a role lane from the roster into run/lane' {
        $root = New-TmpRoot
        try {
            $rec = Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow
            # Enrich the record on disk with a roster (as the orchestrator would).
            $enriched = $rec
            $enriched | Add-Member -NotePropertyName roster -NotePropertyValue @(
                [pscustomobject]@{ role = 'backend'; lane = 'backend/Dashboard.Api/**, backend/shared/**' }
            ) -Force
            Set-Content -LiteralPath (Get-SessionFilePath -Root $root -Id 'feat-1') -Value ($enriched | ConvertTo-Json -Depth 8)
            $globs = Sync-LaneFromSession -Root $root -Id 'feat-1' -Role 'backend'
            $globs.Count | Should -Be 2
            $lane = Get-Content -LiteralPath (Get-LaneFilePath -Root $root)
            ($lane -join '|') | Should -Match 'backend/Dashboard\.Api/\*\*'
            ($lane -join '|') | Should -Match 'backend/shared/\*\*'
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }
    It 'returns null when the role is absent from the roster' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            Sync-LaneFromSession -Root $root -Id 'feat-1' -Role 'frontend' | Should -BeNullOrEmpty
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }
}

# ============================================================
Describe 'Legacy single-file back-compat' {
    It 'reads a legacy run/session.json as one active session' {
        $root = New-TmpRoot
        try {
            $runDir = Join-Path $root '.team-process' 'run'
            New-Item -ItemType Directory -Path $runDir -Force | Out-Null
            $legacy = [ordered]@{ id = 'old-1'; workflow = 'feature-team'; team = 'old-1'; phase = 'implement'; createdAt = '2026-01-01T00:00:00Z' }
            Set-Content -LiteralPath (Join-Path $runDir 'session.json') -Value ($legacy | ConvertTo-Json -Depth 8)
            (Test-AnySessionActive -Root $root) | Should -BeTrue
            (Get-SessionStartContext -Root $root) | Should -Match 'old-1'
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
