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
        (Get-SessionFilePath -Root 'C:/r' -Id 'feat-9') -replace '\\', '/' | Should -Match '/\.team-process/sessions/feat-9/session\.json$'
    }
    It 'session dir is sessions/<id>' {
        (Get-SessionDir -Root 'C:/r' -Id 'feat-9') -replace '\\', '/' | Should -Match '/\.team-process/sessions/feat-9$'
    }
    It 'outbox dir is sessions/<id>/outbox' {
        (Get-OutboxDir -Root 'C:/r' -Id 'feat-9') -replace '\\', '/' | Should -Match '/\.team-process/sessions/feat-9/outbox$'
    }
    It 'inbox dir is sessions/<id>/inbox' {
        (Get-InboxDir -Root 'C:/r' -Id 'feat-9') -replace '\\', '/' | Should -Match '/\.team-process/sessions/feat-9/inbox$'
    }
    It 'sessions dir is directly under .team-process (no run/ layer)' {
        (Get-SessionsDir -Root 'C:/r') -replace '\\', '/' | Should -Match '/\.team-process/sessions$'
    }
    It 'lane file is directly under .team-process (no run/ layer)' {
        (Get-LaneFilePath -Root 'C:/r') -replace '\\', '/' | Should -Match '/\.team-process/lane$'
    }
    It 'legacy single-file is .team-process/session.json' {
        (Get-LegacySessionFilePath -Root 'C:/r') -replace '\\', '/' | Should -Match '/\.team-process/session\.json$'
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
    It 'rejects dot-only traversal ids (.. / . / ...)' {
        ConvertTo-SessionId -Team '..'  | Should -Be 'unknown'
        ConvertTo-SessionId -Team '.'   | Should -Be 'unknown'
        ConvertTo-SessionId -Team '...' | Should -Be 'unknown'
    }
    It 'collapses path separators so a traversal cannot survive' {
        # '/' -> '-'; result is one safe segment with no bare '..' between separators.
        $id = ConvertTo-SessionId -Team '../../etc'
        $id | Should -Be '..-..-etc'
        Test-SafeSessionId -Id $id | Should -BeTrue
    }
}

# ============================================================
Describe 'Test-SafeSessionId' {
    It 'accepts a normal id' { Test-SafeSessionId -Id 'feat-321' | Should -BeTrue }
    It 'rejects ..'         { Test-SafeSessionId -Id '..' | Should -BeFalse }
    It 'rejects .'          { Test-SafeSessionId -Id '.'  | Should -BeFalse }
    It 'rejects a separator' { Test-SafeSessionId -Id '../x' | Should -BeFalse }
    It 'rejects a backslash' { Test-SafeSessionId -Id 'a\b' | Should -BeFalse }
    It 'rejects blank'      { Test-SafeSessionId -Id '' | Should -BeFalse }
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

    It 'preserves acceptance + decisions (the durable resume state) on re-create' {
        $existing = [pscustomobject]@{
            id = 'feat-1'; workflow = 'feature-team'; team = 'feat-1'; phase = 'implement'
            createdAt = '2026-01-01T00:00:00Z'
            acceptance = @('chevron toggles the row')
            decisions  = @([pscustomobject]@{ id = 1; decision = 'glob widget'; supersedes = 'issue text'; status = 'locked' })
        }
        $r = New-SessionRecord -Id 'feat-1' -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow -Existing $existing
        @($r.acceptance).Count    | Should -Be 1
        @($r.decisions).Count     | Should -Be 1
        $r.decisions[0].decision  | Should -Be 'glob widget'
        $r.decisions[0].supersedes| Should -Be 'issue text'
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
    It 'accepts a record carrying acceptance, decisions, and roster progress' {
        $rec = [ordered]@{
            id = 'feat-1'; workflow = 'feature-team'; team = 'feat-1'; phase = 'implement'
            createdAt = '2026-01-01T00:00:00Z'; updatedAt = '2026-01-02T00:00:00Z'
            roster = @([ordered]@{ role = 'backend'; lane = 'backend/**'; status = 'in-progress'; progress = 'adapter extracted, tests pending' })
            acceptance = @('chevron toggles the row')
            decisions = @([ordered]@{ id = 1; decision = 'glob widget'; why = 'matches mockup'; supersedes = 'issue text'; status = 'locked'; refs = @('docs/design/mockup/x') })
        }
        ($rec | ConvertTo-Json -Depth 8 | Test-Json -SchemaFile $script:SchemaFile) | Should -BeTrue
    }
    It 'rejects a decision entry with an unknown field (additionalProperties:false)' {
        $bad = [ordered]@{
            id = 'feat-1'; workflow = 'feature-team'; team = 'feat-1'; phase = 'implement'; createdAt = '2026-01-01T00:00:00Z'
            decisions = @([ordered]@{ id = 1; decision = 'x'; bogus = 'y' })
        }
        ($bad | ConvertTo-Json -Depth 8 | Test-Json -SchemaFile $script:SchemaFile -ErrorAction SilentlyContinue) | Should -BeFalse
    }
    It 'rejects a decision with an invalid status enum' {
        $bad = [ordered]@{
            id = 'feat-1'; workflow = 'feature-team'; team = 'feat-1'; phase = 'implement'; createdAt = '2026-01-01T00:00:00Z'
            decisions = @([ordered]@{ id = 1; decision = 'x'; status = 'maybe' })
        }
        ($bad | ConvertTo-Json -Depth 8 | Test-Json -SchemaFile $script:SchemaFile -ErrorAction SilentlyContinue) | Should -BeFalse
    }
}

# ============================================================
Describe 'Format-RosterStatus' {
    It 'renders role=status pairs from the roster' {
        $rec = [pscustomobject]@{ roster = @(
                [pscustomobject]@{ role = 'backend'; status = 'in-progress' },
                [pscustomobject]@{ role = 'frontend'; status = 'returned' }
            ) }
        Format-RosterStatus -Record $rec | Should -Be 'backend=in-progress, frontend=returned'
    }
    It 'defaults a missing status to spawned' {
        $rec = [pscustomobject]@{ roster = @([pscustomobject]@{ role = 'docs' }) }
        Format-RosterStatus -Record $rec | Should -Be 'docs=spawned'
    }
    It 'returns empty when there is no roster' {
        Format-RosterStatus -Record ([pscustomobject]@{ id = 'x' }) | Should -Be ''
    }
}

# ============================================================
Describe 'Format-DecisionDigest' {
    It 'renders id + decision + supersedes' {
        $rec = [pscustomobject]@{ decisions = @(
                [pscustomobject]@{ id = 3; decision = 'glob widget'; supersedes = 'issue text' }
            ) }
        $d = Format-DecisionDigest -Record $rec
        $d | Should -Match '#3 glob widget'
        $d | Should -Match 'supersedes: issue text'
    }
    It 'caps the list and notes the overflow count' {
        $decisions = 1..8 | ForEach-Object { [pscustomobject]@{ id = $_; decision = "d$_" } }
        $d = Format-DecisionDigest -Record ([pscustomobject]@{ decisions = $decisions }) -Max 6
        $d | Should -Match '\(\+2 more\)'
    }
    It 'returns empty when there are no decisions' {
        Format-DecisionDigest -Record ([pscustomobject]@{ id = 'x' }) | Should -Be ''
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
    It 'surfaces agent statuses and the decision digest inline (content, not counts)' {
        $rec = [pscustomobject]@{
            id = 'feat-1'; workflow = 'feature-team'; branch = 'feat/x'; phase = 'implement'; issue = '#351'
            roster = @([pscustomobject]@{ role = 'backend'; status = 'in-progress' })
            decisions = @([pscustomobject]@{ id = 2; decision = 'glob widget'; supersedes = 'issue text' })
        }
        $msg = Get-SessionReminder -Records @($rec)
        $msg | Should -Match 'agents: backend=in-progress'
        $msg | Should -Match 'decisions: #2 glob widget'
        $msg | Should -Match 'issue: #351'
    }
    It 'states the record-is-authoritative rule (overrides a conflicting summary)' {
        $rec = [pscustomobject]@{ id = 'feat-1'; workflow = 'feature-team'; branch = 'b'; phase = 'implement' }
        $msg = Get-SessionReminder -Records @($rec)
        $msg | Should -Match 'AUTHORITATIVE'
        $msg | Should -Match 'OVERRIDES'
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

    It 'Set-TeamSession creates the outbox dir up front' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            Test-Path -LiteralPath (Get-OutboxDir -Root $root -Id 'feat-1') | Should -BeTrue
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'Set-TeamSession creates the inbox dir up front' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            Test-Path -LiteralPath (Get-InboxDir -Root $root -Id 'feat-1') | Should -BeTrue
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

    It 'Clear-TeamSession refuses a traversal id and deletes nothing outside sessions/<id>' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b1' -Now $script:FixedNow | Out-Null
            $baseDir = Get-TeamProcessBaseDir -Root $root
            # A '..' id would resolve to .team-process/ (the parent of sessions/) under naive removal.
            Clear-TeamSession -Root $root -Id '..'
            Test-Path -LiteralPath $baseDir | Should -BeTrue -Because '.team-process/ must survive a .. id'
            Test-Path -LiteralPath (Get-SessionFilePath -Root $root -Id 'feat-1') | Should -BeTrue
            Clear-TeamSession -Root $root -Id '../../x'   # also a no-op, no throw
            Test-Path -LiteralPath $baseDir | Should -BeTrue
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'Set-TeamSession preserves an existing freeform workflow when re-created without -Workflow' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'task-2' -Workflow 'freeform' -Branch 'b' -Now $script:FixedNow | Out-Null
            # SetMarker now passes -Workflow through raw (empty) on re-create.
            $rec = Set-TeamSession -Root $root -Team 'task-2' -Branch 'b' -Now $script:FixedNow
            $rec.workflow | Should -Be 'freeform'
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
    It 'projects a role lane from the roster into the lane file' {
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
    It 'returns null AND does not write the lane file when the role is absent from the roster' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'feat/x' -Now $script:FixedNow | Out-Null
            Sync-LaneFromSession -Root $root -Id 'feat-1' -Role 'frontend' | Should -BeNullOrEmpty
            Test-Path -LiteralPath (Get-LaneFilePath -Root $root) | Should -BeFalse
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }
    It 'returns null for an unsafe id (traversal guard)' {
        $root = New-TmpRoot
        try {
            Sync-LaneFromSession -Root $root -Id '..' -Role 'backend' | Should -BeNullOrEmpty
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }
}

# ============================================================
Describe 'Legacy single-file back-compat' {
    It 'reads a legacy .team-process/session.json as one active session' {
        $root = New-TmpRoot
        try {
            $baseDir = Join-Path $root '.team-process'
            New-Item -ItemType Directory -Path $baseDir -Force | Out-Null
            $legacy = [ordered]@{ id = 'old-1'; workflow = 'feature-team'; team = 'old-1'; phase = 'implement'; createdAt = '2026-01-01T00:00:00Z' }
            Set-Content -LiteralPath (Join-Path $baseDir 'session.json') -Value ($legacy | ConvertTo-Json -Depth 8)
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

# ============================================================
# End-to-end entry-block dispatch. Push-Location to a temp NON-git dir so the script's
# `git rev-parse --show-toplevel` fails and it falls back to the CWD — the real repo is
# never touched. (System temp is not a git repo on CI runners or dev boxes.)
Describe 'Entry block dispatch (subprocess, temp root)' {

    It 'PreToolUse BLOCKS a foreground subagent (no team_name) when a session is active' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b' -Now $script:FixedNow | Out-Null
            $payload = @{ tool_name = 'Agent'; agent_type = ''; agent_id = ''; tool_input = @{ team_name = '' } } | ConvertTo-Json -Compress
            Push-Location $root
            try { $out = ($payload | pwsh -NonInteractive -NoProfile -File $script:ScriptPath) -join "`n" }
            finally { Pop-Location }
            $out | Should -Match '"decision":\s*"block"'
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It 'PreToolUse ALLOWS a member spawn (team_name set) when a session is active' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b' -Now $script:FixedNow | Out-Null
            $payload = @{ tool_name = 'Agent'; agent_type = ''; agent_id = ''; tool_input = @{ team_name = 'feat-1' } } | ConvertTo-Json -Compress
            Push-Location $root
            try { $out = ($payload | pwsh -NonInteractive -NoProfile -File $script:ScriptPath) -join "`n" }
            finally { Pop-Location }
            $out.Trim() | Should -BeNullOrEmpty
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It '-EndSession -Id .. is a no-op via the entry block (.team-process/ + other sessions survive)' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b' -Now $script:FixedNow | Out-Null
            $baseDir = Get-TeamProcessBaseDir -Root $root
            Push-Location $root
            try { pwsh -NonInteractive -NoProfile -File $script:ScriptPath -EndSession -Id '..' | Out-Null }
            finally { Pop-Location }
            Test-Path -LiteralPath $baseDir | Should -BeTrue
            Test-Path -LiteralPath (Get-SessionFilePath -Root $root -Id 'feat-1') | Should -BeTrue
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It '-ClearMarker removes only the named team session via the entry block' {
        $root = New-TmpRoot
        try {
            Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b' -Now $script:FixedNow | Out-Null
            Set-TeamSession -Root $root -Team 'task-2' -Workflow 'freeform' -Branch 'b' -Now $script:FixedNow | Out-Null
            $payload = @{ tool_input = @{ team_name = 'feat-1' } } | ConvertTo-Json -Compress
            Push-Location $root
            try { $payload | pwsh -NonInteractive -NoProfile -File $script:ScriptPath -ClearMarker | Out-Null }
            finally { Pop-Location }
            Test-Path -LiteralPath (Get-SessionFilePath -Root $root -Id 'feat-1') | Should -BeFalse
            Test-Path -LiteralPath (Get-SessionFilePath -Root $root -Id 'task-2') | Should -BeTrue
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }

    It '-SyncLane projects the lane file from the roster via the entry block' {
        $root = New-TmpRoot
        try {
            $rec = Set-TeamSession -Root $root -Team 'feat-1' -Branch 'b' -Now $script:FixedNow
            $rec | Add-Member -NotePropertyName roster -NotePropertyValue @(
                [pscustomobject]@{ role = 'backend'; lane = 'backend/Dashboard.Api/**' }
            ) -Force
            Set-Content -LiteralPath (Get-SessionFilePath -Root $root -Id 'feat-1') -Value ($rec | ConvertTo-Json -Depth 8)
            Push-Location $root
            try { pwsh -NonInteractive -NoProfile -File $script:ScriptPath -SyncLane -Id 'feat-1' -Role 'backend' | Out-Null }
            finally { Pop-Location }
            (Get-Content -LiteralPath (Get-LaneFilePath -Root $root) -Raw) | Should -Match 'backend/Dashboard\.Api/\*\*'
        }
        finally { Remove-Item -Recurse -Force -LiteralPath $root -ErrorAction SilentlyContinue }
    }
}
