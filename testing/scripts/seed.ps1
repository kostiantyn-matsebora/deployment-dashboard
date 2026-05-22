<#
.SYNOPSIS
    Seeds the Deployment Dashboard ingest API with prefilled events that
    exercise all six box states from the mockup. Zero-setup for local dev.

.DESCRIPTION
    Implements WBS MVP §2.4 (and the seed step of §3.1) of
    docs/architecture.md.

    Configuration is declarative. The script reads its target's
    `writeBaseUrl` and `apiKey` from a JSON config file under
    `testing/config/` (default `testing/config/local.json`, which points
    at the local docker-compose stack from `dev_env/start.ps1` and
    embeds the fixed fake API token baked into that stack). To target a
    different environment, pass `-Config testing/config/<target>.json`
    pointing at another file with the same schema. The script does not
    accept loose `-BaseUrl` / `-ApiKey` overrides — those are
    configuration and belong in the JSON file.

    Reads the canonical fixture corpus from
    testing/fixtures/seed-data.json (derived from the 'SERVICES' const
    block in docs/ui/deployment-dashboard.html) and POSTs each event to
    {writeBaseUrl}/api/deployments using the wire contract documented
    in SAD §7 'API Contract' and 'Components -> CI/CD Notify Step':

        POST {writeBaseUrl}/api/deployments
        Headers:
            X-Api-Key:    <apiKey>
            Content-Type: application/json
            User-Agent:   deployment-dashboard-seed/1.0
        Body (snake_case keys; deployment_id + parent_deployments
        added in Phase 2 per SAD §5 'deployments table' / §7 'POST
        /api/deployments request body'; ref + sha added in the
        FR-05 additive cycle per SAD §10 Decision #10):
            {
              "deployment_id":      "<string>",        # required (new)
              "parent_deployments": ["<deployment_id>", ...],  # optional (new)
              "service":            "<string>",
              "environment":        "<string>",
              "version":            "<string>",
              "status":             "success" | "failure" | "in-progress",
              "run_url":            "<string>",
              "run_number":         <integer>,
              "actor":              "qa.bot",
              "ref":                "<string>" | null,  # optional (FR-05)
              "sha":                "<string>" | null   # optional (FR-05)
            }
        ref / sha are forwarded only when the fixture event supplies
        them. Backward-compatible: events that omit both keys produce
        the original 7-field payload, which the server MUST continue
        to accept (SAD §7 "POST /api/deployments request body"
        backward-compatibility clause).

    Events for a given (service, environment) slot are POSTed in
    chronological order (oldest first). The ingest API stamps
    'deployed_at = NOW()' on each insert, so the server-side history
    ordering matches the loop ordering. A short sleep between events
    within the same slot guarantees distinct timestamps even on hosts
    with low-resolution clocks.

    Topology section: in addition to the 6-box-state 'slots' the
    fixture file declares a 'topology' section exercising the three
    derivation paths (explicit / correlated / mixed) from SAD §5
    'Topology Derivation'. Topology events are POSTed in declaration
    order so 'parent_deployments' references resolve at write time;
    dangling-reference cases are exercised by the functional suite,
    not the seed loop.

    Idempotency: the ingest API enforces unique (service,
    deployment_id) (SAD §7 'API Contract' - 'POST /api/deployments
    validation'). Re-running seed.ps1 therefore yields 409 Conflict
    on every event after the first run; that is treated as
    'already-seeded' rather than failure (status 409 in -Lenient
    mode, default on). The matrix view derived by
    'GET /api/deployments' is unchanged because the original rows
    are unchanged.

.PARAMETER Config
    Path to a target config JSON file under testing/config/. Default
    'testing/config/local.json'. The file must contain
    { readBaseUrl, writeBaseUrl, apiKey } — see
    testing/config/README.md for the schema. POSTs land on
    {writeBaseUrl}/api/deployments.

.PARAMETER DryRun
    Print every payload that would be POSTed. Performs no network
    calls. Exits 0 unless validation fails.

.PARAMETER FailFast
    Stop on the first non-2xx response or transport error. Default is
    to continue and report a summary at end-of-run.

.PARAMETER TimeoutSec
    Per-request HTTP timeout. Default 10s.

.PARAMETER States
    Optional filter restricting which canonical box states to seed.
    Allowed values:
      success
      running-with-last-success
      running-with-prev-failed-and-last-success
      failed-with-last-success
      running
      running-with-prev-failed
    Default (empty array) seeds all six.

.PARAMETER SkipTopology
    If set, the seeder skips the 'topology' fixtures section and only
    POSTs the 6-box-state 'slots' section. Useful when running against
    a Phase 1 backend that doesn't yet accept the new fields.

.PARAMETER TopologyOnly
    If set, the seeder skips the 'slots' section and only POSTs the
    'topology' fixtures. Useful for targeted topology-derivation
    debugging.

.PARAMETER Clean
    Truncates the `deployments` table on the target stack BEFORE
    POSTing the fixture corpus. Removes accumulated state pollution
    from prior test runs (the functional suite POSTs unique-per-run
    rows that would otherwise accumulate indefinitely). Implemented
    via `docker exec dashboard-db psql ...` against the local dev
    stack; only supported when the target config points at
    `localhost`. Against a non-local target the script errors out
    rather than silently doing nothing.

.PARAMETER CleanOnly
    Truncates the `deployments` table and exits without seeding.
    Useful as a cleanup step after the functional suite when the
    intent is to hand off to e2e against a known-empty state and
    re-seed explicitly. Mutually exclusive with -Clean.

.EXAMPLE
    pwsh -NoProfile -File testing/scripts/seed.ps1

    Zero-setup local-dev usage. Uses testing/config/local.json which
    points at the local docker-compose stack from dev_env/start.ps1.

.EXAMPLE
    pwsh -NoProfile -File testing/scripts/seed.ps1 -DryRun

    Prints every payload that would be POSTed and exits without
    contacting the network. Useful for fixture validation in CI.

.EXAMPLE
    pwsh -NoProfile -File testing/scripts/seed.ps1 `
        -Config testing/config/dev.json `
        -States 'failed-with-last-success','running-with-prev-failed' `
        -FailFast

    Seeds only the two failure-related states against the dev target
    described by dev.json, stopping on the first error.

.NOTES
    File:   testing/scripts/seed.ps1
    Owner:  qa-engineer (.claude/agents/qa-engineer.md)
    WBS:    MVP §2.4, §3.1 in docs/architecture.md
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$Config = (Join-Path $PSScriptRoot '..\config\local.json'),

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$FailFast,

    [Parameter()]
    [ValidateRange(1, 300)]
    [int]$TimeoutSec = 10,

    [Parameter()]
    [ValidateSet(
        'success',
        'running-with-last-success',
        'running-with-prev-failed-and-last-success',
        'failed-with-last-success',
        'running',
        'running-with-prev-failed'
    )]
    [string[]]$States = @(),

    [Parameter()]
    [switch]$SkipTopology,

    [Parameter()]
    [switch]$TopologyOnly,

    [Parameter()]
    [switch]$Clean,

    [Parameter()]
    [switch]$CleanOnly,

    [Parameter()]
    [switch]$RateLimit
)

$ErrorActionPreference = 'Stop'

$UserAgent        = 'deployment-dashboard-seed/1.0'
$AllowedStatus    = @('success', 'failure', 'in-progress')
$IntraSlotDelayMs = 50

# Resolve config + fixture paths.
$ConfigPath  = [System.IO.Path]::GetFullPath($Config)
$FixturePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\fixtures\seed-data.json'))

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Config file not found at '$ConfigPath'. See testing/config/README.md."
}
if (-not (Test-Path -LiteralPath $FixturePath)) {
    throw "Fixture file not found at '$FixturePath'."
}

function Write-StructuredLog {
    param(
        [Parameter(Mandatory)] [string]$Event,
        [Parameter()]          [string]$Level = 'info',
        [Parameter()]          [hashtable]$Payload = @{}
    )
    $record = [ordered]@{
        ts    = (Get-Date).ToUniversalTime().ToString('o')
        level = $Level
        event = $Event
    }
    foreach ($key in $Payload.Keys) { $record[$key] = $Payload[$key] }
    $record | ConvertTo-Json -Compress -Depth 6 | Write-Output
}

function Assert-FixtureSlot {
    param(
        [Parameter(Mandatory)] [object]$Slot,
        [Parameter(Mandatory)] [int]$Index
    )
    foreach ($field in @('service', 'environment', 'state', 'events')) {
        if (-not $Slot.PSObject.Properties.Match($field)) {
            throw "Fixture slot #$Index is missing required field '$field'."
        }
    }
    if ([string]::IsNullOrWhiteSpace($Slot.service))     { throw "Fixture slot #$Index has empty 'service'." }
    if ([string]::IsNullOrWhiteSpace($Slot.environment)) { throw "Fixture slot #$Index has empty 'environment'." }
    if (-not $Slot.events -or $Slot.events.Count -lt 1)  { throw "Fixture slot $($Slot.service)/$($Slot.environment) has no events." }
    foreach ($evt in $Slot.events) {
        # 'deployment_id' is REQUIRED per SAD §7 'POST /api/deployments
        # request body' (Phase 2). Empty / missing -> 422 from server.
        foreach ($field in @('deployment_id', 'version', 'status', 'run_number', 'run_url')) {
            if (-not $evt.PSObject.Properties.Match($field)) {
                throw "Event in $($Slot.service)/$($Slot.environment) is missing field '$field'."
            }
        }
        if ([string]::IsNullOrWhiteSpace([string]$evt.deployment_id)) {
            throw "Event in $($Slot.service)/$($Slot.environment) has empty 'deployment_id'."
        }
        if ($AllowedStatus -notcontains $evt.status) {
            throw "Event in $($Slot.service)/$($Slot.environment) has invalid status '$($evt.status)'. Must be one of: $($AllowedStatus -join ', ')."
        }
        if ($evt.run_number -isnot [int] -and $evt.run_number -isnot [long]) {
            $parsed = 0
            if (-not [int]::TryParse([string]$evt.run_number, [ref]$parsed)) {
                throw "Event in $($Slot.service)/$($Slot.environment) has non-integer run_number '$($evt.run_number)'."
            }
        }
    }
}

function Assert-TopologyService {
    param(
        [Parameter(Mandatory)] [object]$Service,
        [Parameter(Mandatory)] [int]$Index
    )
    foreach ($field in @('service', 'events')) {
        if (-not $Service.PSObject.Properties.Match($field)) {
            throw "Topology service #$Index is missing required field '$field'."
        }
    }
    if ([string]::IsNullOrWhiteSpace($Service.service)) { throw "Topology service #$Index has empty 'service'." }
    if (-not $Service.events -or $Service.events.Count -lt 1) {
        throw "Topology service $($Service.service) has no events."
    }
    foreach ($evt in $Service.events) {
        foreach ($field in @('deployment_id', 'environment', 'version', 'status', 'run_number', 'run_url')) {
            if (-not $evt.PSObject.Properties.Match($field)) {
                throw "Topology event in $($Service.service) is missing field '$field'."
            }
        }
        if ([string]::IsNullOrWhiteSpace([string]$evt.deployment_id)) {
            throw "Topology event in $($Service.service) has empty 'deployment_id'."
        }
        if ($AllowedStatus -notcontains $evt.status) {
            throw "Topology event in $($Service.service) has invalid status '$($evt.status)'."
        }
        # parent_deployments is optional but must be a string[] when present.
        if ($evt.PSObject.Properties.Match('parent_deployments')) {
            if ($null -ne $evt.parent_deployments -and -not ($evt.parent_deployments -is [System.Collections.IEnumerable])) {
                throw "Topology event $($evt.deployment_id) in $($Service.service) has non-array 'parent_deployments'."
            }
        }
    }
}

function Send-DeploymentEvent {
    param(
        [Parameter(Mandatory)] [string]$Url,
        [Parameter(Mandatory)] [hashtable]$Headers,
        [Parameter(Mandatory)] [string]$Body,
        [Parameter(Mandatory)] [int]$TimeoutSec,
        [Parameter()]          [switch]$DryRun
    )
    if ($DryRun) {
        return @{ ok = $true; status_code = 0; latency_ms = 0.0; error = $null; dryRun = $true }
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $resp = Invoke-WebRequest -Uri $Url -Method POST -Headers $Headers -Body $Body `
            -ContentType 'application/json' -TimeoutSec $TimeoutSec `
            -SkipHttpErrorCheck -UseBasicParsing -ErrorAction Stop
        $sw.Stop()
        $code = [int]$resp.StatusCode
        if ($code -ge 200 -and $code -lt 300) {
            return @{ ok = $true; status_code = $code; latency_ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); error = $null }
        }
        $bodyText = $null
        try { $bodyText = $resp.Content } catch { $bodyText = '<unreadable>' }
        return @{ ok = $false; status_code = $code; latency_ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); error = "HTTP $code; body=$bodyText" }
    }
    catch {
        $sw.Stop()
        return @{ ok = $false; status_code = 0; latency_ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1); error = $_.Exception.Message }
    }
}

# Load declarative target config.
try {
    $targetConfig = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
}
catch {
    throw "Failed to parse config file '$ConfigPath': $($_.Exception.Message)"
}

foreach ($key in @('writeBaseUrl','apiKey')) {
    if (-not $targetConfig.PSObject.Properties.Match($key) -or [string]::IsNullOrWhiteSpace([string]$targetConfig.$key)) {
        throw "Config file '$ConfigPath' is missing required key '$key'. See testing/config/README.md."
    }
}

$WriteBaseUrl = ([string]$targetConfig.writeBaseUrl).TrimEnd('/')
$ApiKey       = [string]$targetConfig.apiKey
$Endpoint     = "$WriteBaseUrl/api/deployments"

$Headers = @{
    'X-Api-Key'  = $ApiKey
    'User-Agent' = $UserAgent
}

if ($Clean -and $CleanOnly) {
    throw "-Clean and -CleanOnly are mutually exclusive."
}

function Invoke-DeploymentsTruncate {
    <#
    Truncates the `deployments` table on the target dev stack.
    Implemented via `docker exec dashboard-db psql` against the
    well-known container name from dev_env/docker-compose.local.yml.
    Only supported when the target is local; against a non-local
    target the caller must clean by other means (a real Postgres
    client or an admin endpoint).
    #>
    param(
        [Parameter(Mandatory)] [string]$WriteBaseUrl
    )

    $isLocal = $WriteBaseUrl -match '^(https?://)?(localhost|127\.0\.0\.1)(:|/|$)'
    if (-not $isLocal) {
        throw "-Clean / -CleanOnly is only supported against the local dev stack (target is '$WriteBaseUrl'). Use a real Postgres client for non-local cleanups."
    }

    $dockerCmd = Get-Command -Name 'docker' -ErrorAction SilentlyContinue
    if ($null -eq $dockerCmd) {
        throw "'docker' is not on PATH but is required for -Clean / -CleanOnly against the local stack."
    }

    Write-StructuredLog -Event 'seed_clean_start' -Payload @{ container = 'dashboard-db'; target = $WriteBaseUrl }
    # `TRUNCATE ... RESTART IDENTITY CASCADE` matches a freshly-migrated
    # state. `fetcher_state` is included so the integration-test suite
    # (testing/integration/) gets a reset cursor between scenarios --
    # without it, the fetcher's per-(progress_reporter, source_id)
    # watermark persists across tests and filters out newer scenarios'
    # deployments. Functional suite is unaffected (no fetcher in that
    # profile -> no rows in fetcher_state to begin with).
    # schema (resets the sequence on the auto-increment `id` column).
    $sql = 'TRUNCATE TABLE deployments, fetcher_state RESTART IDENTITY CASCADE;'
    & docker exec -i 'dashboard-db' psql -U 'dashboard' -d 'dashboard' -v 'ON_ERROR_STOP=1' -c $sql | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "TRUNCATE deployments failed (docker exec exit $LASTEXITCODE). Is the dev stack running (dev_env/start.ps1)?"
    }
    Write-StructuredLog -Event 'seed_clean_ok' -Payload @{ container = 'dashboard-db' }
}

if ($Clean -or $CleanOnly) {
    if ($DryRun) {
        Write-StructuredLog -Event 'seed_clean_skipped_dryrun' -Level 'warn' -Payload @{ reason = 'dry_run' }
    } else {
        Invoke-DeploymentsTruncate -WriteBaseUrl $WriteBaseUrl
    }
}

if ($CleanOnly) {
    Write-StructuredLog -Event 'seed_done' -Level 'info' -Payload @{
        total_posted   = 0
        succeeded      = 0
        already_seeded = 0
        failed         = 0
        first_error    = $null
        dry_run        = [bool]$DryRun
        exit_code      = 0
        mode           = 'clean-only'
    }
    exit 0
}

# Load and validate fixtures.
try {
    $fixture = Get-Content -LiteralPath $FixturePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
}
catch {
    throw "Failed to parse fixture file '$FixturePath': $($_.Exception.Message)"
}

if (-not $fixture.slots -or $fixture.slots.Count -lt 1) {
    throw "Fixture file '$FixturePath' contains no slots."
}

$actor = if ($fixture.PSObject.Properties.Match('actor') -and -not [string]::IsNullOrWhiteSpace($fixture.actor)) {
    [string]$fixture.actor
} else {
    'qa.bot'
}

if ($SkipTopology -and $TopologyOnly) {
    throw "-SkipTopology and -TopologyOnly are mutually exclusive."
}

$slots = @($fixture.slots)
for ($i = 0; $i -lt $slots.Count; $i++) {
    Assert-FixtureSlot -Slot $slots[$i] -Index $i
}

if ($States.Count -gt 0) {
    $slots = @($slots | Where-Object { $States -contains $_.state })
    if ($slots.Count -eq 0) {
        Write-StructuredLog -Event 'no_slots_after_filter' -Level 'warn' -Payload @{ requested_states = $States }
        exit 0
    }
}

# Topology section (Phase 2). Optional in the file for forward compatibility
# but expected to be present after the Phase 2 fixture update.
$topologyServices = @()
if ($fixture.PSObject.Properties.Match('topology') -and $null -ne $fixture.topology) {
    $topologyServices = @($fixture.topology)
    for ($i = 0; $i -lt $topologyServices.Count; $i++) {
        Assert-TopologyService -Service $topologyServices[$i] -Index $i
    }
}

if ($TopologyOnly) { $slots = @() }
if ($SkipTopology) { $topologyServices = @() }

$slotEventCount     = if ($slots.Count -eq 0) { 0 } else { ($slots | ForEach-Object { $_.events.Count } | Measure-Object -Sum).Sum }
$topologyEventCount = if ($topologyServices.Count -eq 0) { 0 } else { ($topologyServices | ForEach-Object { $_.events.Count } | Measure-Object -Sum).Sum }
$totalEvents        = $slotEventCount + $topologyEventCount

Write-StructuredLog -Event 'seed_start' -Payload @{
    config_path           = $ConfigPath
    write_base_url        = $WriteBaseUrl
    endpoint              = $Endpoint
    dry_run               = [bool]$DryRun
    fail_fast             = [bool]$FailFast
    timeout_sec           = $TimeoutSec
    states_filter         = $States
    slot_count            = $slots.Count
    topology_service_count = $topologyServices.Count
    event_count           = $totalEvents
    actor                 = $actor
    fixture_path          = $FixturePath
    user_agent            = $UserAgent
    skip_topology         = [bool]$SkipTopology
    topology_only         = [bool]$TopologyOnly
}

$posted = 0
$succeeded = 0
$alreadySeeded = 0   # 409 Conflict on a stable (service, deployment_id) - benign
$failed = 0
$firstError = $null

function Invoke-SeedPost {
    # Emits ONE JSON line on the pipeline (the per-event log) and updates
    # the $script:lastSendOk flag for caller-side fail-fast handling.
    # Counters live in script scope and are mutated in place. Avoid using
    # 'return' here: any non-void expression bleeds into the function's
    # output stream and corrupts the seed log.
    param(
        [Parameter(Mandatory)] [hashtable]$Payload,
        [Parameter(Mandatory)] [hashtable]$LogPayload
    )

    $body = $Payload | ConvertTo-Json -Compress -Depth 6

    $result = Send-DeploymentEvent -Url $Endpoint -Headers $Headers -Body $body `
        -TimeoutSec $TimeoutSec -DryRun:$DryRun

    $script:posted++

    $LogPayload['status_code'] = $result.status_code
    $LogPayload['latency_ms']  = $result.latency_ms

    if ($DryRun) {
        $LogPayload['dry_run'] = $true
        $LogPayload['payload'] = $Payload
        Write-StructuredLog -Event 'seed_dryrun' -Payload $LogPayload
        $script:succeeded++
        $script:lastSendOk = $true
    }
    elseif ($result.ok) {
        $script:succeeded++
        Write-StructuredLog -Event 'seed_post_ok' -Payload $LogPayload
        $script:lastSendOk = $true
    }
    elseif ($result.status_code -eq 409) {
        # 409 Conflict on (service, deployment_id) means the row already
        # exists. Re-running seed.ps1 with stable deployment_id values is
        # expected to hit this, so we treat it as benign and continue.
        $script:alreadySeeded++
        $LogPayload['note'] = 'duplicate-deployment-id; row already seeded'
        Write-StructuredLog -Event 'seed_post_already' -Level 'info' -Payload $LogPayload
        $script:lastSendOk = $true
    }
    else {
        $script:failed++
        if ($null -eq $script:firstError) { $script:firstError = $result.error }
        $LogPayload['error'] = $result.error
        Write-StructuredLog -Event 'seed_post_fail' -Level 'error' -Payload $LogPayload
        $script:lastSendOk = $false
    }
}

:slotLoop foreach ($slot in $slots) {
    $svc = [string]$slot.service
    $env = [string]$slot.environment

    for ($i = 0; $i -lt $slot.events.Count; $i++) {
        $evt = $slot.events[$i]

        $payload = [ordered]@{
            deployment_id = [string]$evt.deployment_id
            service       = $svc
            environment   = $env
            version       = [string]$evt.version
            status        = [string]$evt.status
            run_url       = [string]$evt.run_url
            run_number    = [int]$evt.run_number
            actor         = $actor
        }
        # parent_deployments only included when fixture supplies one - the
        # 6-box-state corpus intentionally OMITS this field so we exercise
        # the correlation-fallback path in the topology builder. (Note:
        # PSObject.Properties.Match returns a non-empty collection that is
        # truthy even when the property isn't present, so we test .Count
        # explicitly.)
        if ($evt.PSObject.Properties.Match('parent_deployments').Count -gt 0) {
            $payload['parent_deployments'] = @($evt.parent_deployments)
        }
        # ref / sha are FR-05 additive (SAD §10 Decision #10): forward
        # only when the fixture supplies the key. An explicit JSON null
        # in the fixture is forwarded as a JSON null (the server treats
        # absent and null as equivalent per SAD §7 'POST /api/deployments
        # request body' - "Omit the property, send null, or send a string;
        # absence and null are equivalent").
        if ($evt.PSObject.Properties.Match('ref').Count -gt 0) {
            $payload['ref'] = $evt.ref
        }
        if ($evt.PSObject.Properties.Match('sha').Count -gt 0) {
            $payload['sha'] = $evt.sha
        }

        $logPayload = @{
            section        = 'slots'
            service        = $svc
            environment    = $env
            deployment_id  = $payload.deployment_id
            version        = $payload.version
            status         = $payload.status
            run_number     = $payload.run_number
            box_state      = [string]$slot.state
            slot_event_ix  = $i
            has_ref        = $payload.Contains('ref')
            has_sha        = $payload.Contains('sha')
        }

        $script:lastSendOk = $true
        Invoke-SeedPost -Payload $payload -LogPayload $logPayload

        if (-not $script:lastSendOk -and $FailFast) {
            Write-StructuredLog -Event 'seed_failfast_abort' -Level 'error' -Payload @{ after_event = $posted }
            break slotLoop
        }

        if (-not $DryRun -and $i -lt ($slot.events.Count - 1)) {
            Start-Sleep -Milliseconds $IntraSlotDelayMs
        }
    }
}

# Topology section: one service at a time, events in declaration order so
# parent_deployments references resolve at write time.
:topoLoop foreach ($topoSvc in $topologyServices) {
    $svc = [string]$topoSvc.service

    for ($i = 0; $i -lt $topoSvc.events.Count; $i++) {
        $evt = $topoSvc.events[$i]

        $payload = [ordered]@{
            deployment_id      = [string]$evt.deployment_id
            service            = $svc
            environment        = [string]$evt.environment
            version            = [string]$evt.version
            status             = [string]$evt.status
            run_url            = [string]$evt.run_url
            run_number         = [int]$evt.run_number
            actor              = "$actor-topo"
            parent_deployments = @($evt.parent_deployments)
        }
        # Same ref / sha forwarding rule as the slots loop (FR-05; SAD §10
        # Decision #10). Topology fixtures don't currently carry these
        # fields, but the seeder must respect them if a future fixture does.
        if ($evt.PSObject.Properties.Match('ref').Count -gt 0) {
            $payload['ref'] = $evt.ref
        }
        if ($evt.PSObject.Properties.Match('sha').Count -gt 0) {
            $payload['sha'] = $evt.sha
        }

        $logPayload = @{
            section            = 'topology'
            service            = $svc
            environment        = [string]$evt.environment
            deployment_id      = $payload.deployment_id
            version            = $payload.version
            status             = $payload.status
            run_number         = $payload.run_number
            topo_event_ix      = $i
            parent_deployments = $payload.parent_deployments
            has_ref            = $payload.Contains('ref')
            has_sha            = $payload.Contains('sha')
        }

        $script:lastSendOk = $true
        Invoke-SeedPost -Payload $payload -LogPayload $logPayload

        if (-not $script:lastSendOk -and $FailFast) {
            Write-StructuredLog -Event 'seed_failfast_abort' -Level 'error' -Payload @{ after_event = $posted; section = 'topology' }
            break topoLoop
        }

        if (-not $DryRun -and $i -lt ($topoSvc.events.Count - 1)) {
            Start-Sleep -Milliseconds $IntraSlotDelayMs
        }
    }
}

# ---------------------------------------------------------------------
# CR-0011 — opt-in rate-limit snapshot seeding.
#
# When `-RateLimit` is passed, POST three representative
# (adapter_id, source_id) snapshots to /api/fetcher/usage covering all
# three severity bands (green / amber / red) from
# docs/ui/rate-limit-cluster.md § Fixture additions. This lets a local
# operator see the dashboard cluster light up immediately without
# spinning up a real fetcher.
#
# The switch is OPT-IN to preserve the existing seed behaviour for
# users who run seed.ps1 without flags — § "Existing scenarios
# unchanged when the switch is absent" per the QA Phase 2e plan.
# ---------------------------------------------------------------------
if ($RateLimit -and -not $DryRun) {
    $usageEndpoint = "$WriteBaseUrl/api/fetcher/usage"
    $usageHeaders = @{
        'X-Api-Key'           = $ApiKey
        'X-Progress-Reporter' = 'dashboard-fetcher/seed'
        'User-Agent'          = $UserAgent
    }
    $nowUtc = (Get-Date).ToUniversalTime()
    $resetAt = $nowUtc.AddMinutes(30).ToString('o')
    $observedAt = $nowUtc.ToString('o')

    $rateLimitSnapshots = @(
        [ordered]@{
            adapter_id         = 'github-actions'
            source_id          = 'acme/widget-a'
            upstream_limit     = 5000
            upstream_remaining = 3600   # 28% — green
            upstream_reset_at  = $resetAt
            self_imposed_cap   = 1500
            upstream_used      = 1400
            observed_at        = $observedAt
        },
        [ordered]@{
            adapter_id         = 'github-actions'
            source_id          = 'acme/widget-b'
            upstream_limit     = 5000
            upstream_remaining = 1250   # 75% — amber (shares PAT with widget-a)
            upstream_reset_at  = $resetAt
            self_imposed_cap   = 1500
            upstream_used      = 3750
            observed_at        = $observedAt
        },
        [ordered]@{
            adapter_id         = 'azure-devops'
            source_id          = 'contoso/payments'
            upstream_limit     = 5000
            upstream_remaining = 600    # 88% — red (different adapter, different PAT)
            upstream_reset_at  = $resetAt
            self_imposed_cap   = 1500
            upstream_used      = 4400
            observed_at        = $observedAt
        }
    )

    foreach ($snap in $rateLimitSnapshots) {
        $bodyJson = $snap | ConvertTo-Json -Compress -Depth 4
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $resp = Invoke-WebRequest -Uri $usageEndpoint -Method POST -Headers $usageHeaders `
                -Body $bodyJson -ContentType 'application/json' -TimeoutSec $TimeoutSec `
                -SkipHttpErrorCheck -UseBasicParsing -ErrorAction Stop
            $sw.Stop()
            $code = [int]$resp.StatusCode
            $logRecord = @{
                section     = 'rate-limit'
                adapter_id  = $snap.adapter_id
                source_id   = $snap.source_id
                upstream_used = $snap.upstream_used
                status_code = $code
                latency_ms  = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
            }
            if ($code -ge 200 -and $code -lt 300) {
                Write-StructuredLog -Event 'seed_usage_ok' -Payload $logRecord
            } else {
                $logRecord['error'] = "HTTP $code"
                Write-StructuredLog -Event 'seed_usage_fail' -Level 'error' -Payload $logRecord
            }
        }
        catch {
            $sw.Stop()
            Write-StructuredLog -Event 'seed_usage_fail' -Level 'error' -Payload @{
                section    = 'rate-limit'
                adapter_id = $snap.adapter_id
                source_id  = $snap.source_id
                error      = $_.Exception.Message
            }
        }
    }
} elseif ($RateLimit -and $DryRun) {
    Write-StructuredLog -Event 'seed_usage_skipped_dryrun' -Level 'warn' -Payload @{ reason = 'dry_run' }
}

$exitCode = 0
if ($failed -gt 0) { $exitCode = 1 }

Write-StructuredLog -Event 'seed_done' -Level ($(if ($exitCode -eq 0) { 'info' } else { 'error' })) -Payload @{
    total_posted    = $posted
    succeeded       = $succeeded
    already_seeded  = $alreadySeeded
    failed          = $failed
    first_error     = $firstError
    dry_run         = [bool]$DryRun
    exit_code       = $exitCode
}

exit $exitCode
