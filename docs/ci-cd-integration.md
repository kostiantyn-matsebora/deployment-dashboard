# CI/CD Integration Guide - Deployment Dashboard

This is the operational companion to
[`deployment-dashboard-architecture.md`](deployment-dashboard-architecture.md)
§7 "CI/CD Integration". The architecture doc is the source of truth -
this guide only repeats payload and snippet detail to make integration
copy-pasteable.

Implements WBS MVP §1.4.1 and "CI/CD Integration" §1.1 / §1.5.

## Why this works for every CI/CD tool

Per SAD §1 "Problem Statement" and §6 "Constraints", the dashboard
deliberately has **no CI/CD-specific SDK and queries no CI/CD tool**.
The only integration point is a single HTTP `POST /api/deployments`
call (SAD §7 "Components" -> "CI/CD Notify Step", and SAD §7
"API Contract"). Any tool that can run a shell command, PowerShell
task, or HTTP-capable scripted step can integrate.

FR-06 in SAD §4 codifies this: integrating the notify step shall
require no changes to existing CI/CD pipelines beyond adding a single
step.

## Wire contract (canonical)

See SAD §7 "Components" -> "CI/CD Notify Step" and "API Contract".

**Endpoint:** `POST {DEPLOYMENT_DASHBOARD_URL}/api/deployments`

**Authentication header:**

```
X-Api-Key: <DEPLOYMENT_DASHBOARD_TOKEN>
```

A missing or invalid key returns `401` (FR-10, SAD §7 "API Contract").

**Recommended caller identifier (added by this repo, not enforced by
the API):**

```
User-Agent: deployment-dashboard-notify/1.0 (+<tool>)
```

This makes dashboard access logs auditable - swap `<tool>` for
`github-actions`, `azure-devops`, `jenkins`, `gitlab-ci`, etc.

**Payload — minimum required shape (eight required fields; names
match the API contract exactly):**

```json
{
  "deployment_id": "gh-12345",
  "service":       "service-a",
  "environment":   "dev",
  "version":       "v2.3.1",
  "status":        "success",
  "run_url":       "https://ci.example.com/runs/12345",
  "run_number":    1247,
  "actor":         "john.doe"
}
```

Three optional fields — `parent_deployments`, `ref`, `sha` — MAY be
added to the same payload (FR-05, FR-13; SAD §7 "API Contract" →
"POST `/api/deployments` request body"). They are independently
omittable; the dashboard stores any combination and surfaces them on
read responses.

```json
{
  "deployment_id":      "gh-12345",
  "parent_deployments": ["gh-12340"],
  "service":            "service-a",
  "environment":        "qa",
  "version":            "v2.3.1",
  "status":             "success",
  "run_url":            "https://ci.example.com/runs/12345",
  "run_number":         1247,
  "actor":              "john.doe",
  "ref":                "feature/login-revamp",
  "sha":                "9f1c0d2e8a"
}
```

- `deployment_id` - CI/CD-side identifier (run id, build number, guid).
  Required (SAD §7 POST validation table row 1). Non-empty. Unique
  within `service`; duplicate `(service, deployment_id)` → `409
  Conflict`. Length cap 200. Namespace by tool prefix (e.g. `gh-`,
  `ado-`, `jenkins-`) to avoid collisions across CI/CD platforms.
- `parent_deployments` *(optional)* - JSON array of `deployment_id`
  values referencing upstream deployments in the **same `service`**.
  Omit, send `[]`, or send a string array. Empty / absent → the
  Read API falls back to correlation-based topology derivation
  (SAD §"Topology Derivation"). Cross-service references → `400
  Bad Request`. Cycles through resolved references → `400 Bad
  Request`. References to a not-yet-ingested `deployment_id` are
  **accepted** and held as dangling (SAD §10 Decision 9).
- `service` - free-form identifier; lists are derived dynamically from
  stored events (FR-09, SAD §7 "API Contract" - `GET /api/services`).
  Length cap 200.
- `environment` - free-form identifier; same dynamic discovery via
  `GET /api/environments`. Length cap 200.
- `version` - any string. Semver, git SHA, build number - the
  dashboard does not parse it. Length cap 200.
- `status` - one of `success`, `failure`, `in-progress`.
- `run_url` - link to the originating CI run; rendered as a clickable
  link on the matrix box (FR-02). Must validate as a URL; length
  cap 2048.
- `run_number` - non-negative integer; serialised as a JSON number,
  **not** a string.
- `actor` - whoever or whatever triggered the run. Length cap 200.
- `ref` *(optional)* - branch name, PR number, tag, or any
  human-readable git ref. Free-form string. Omit, send `null`, or
  send a string. No length cap or format check at this stage
  (deferred — SAD §10 Decision 10).
- `sha` *(optional)* - commit SHA associated with this deployment.
  Free-form string at this stage (no hex check, no length cap).
  Omit, send `null`, or send a string. Deferred — SAD §10
  Decision 10.

Backward compatibility: `deployment_id` is **required** (FR-13 cycle —
SAD §10 Decision 9). Pipelines that previously sent the original
seven-field shape MUST be updated to include `deployment_id` before
their next run. The optional fields (`parent_deployments`, `ref`,
`sha`) may be added independently at any time without coordination.

**Success response:** `201 Created` with the created resource in the
body (SAD §7 "API Contract").

**Failure responses (SAD §7 "POST `/api/deployments` validation —
failure modes"):**

| Status | When |
|---|---|
| `400 Bad Request` | `parent_deployments[i]` references a `deployment_id` in a different service, OR closes a cycle through already-resolved references. |
| `401 Unauthorized` | Missing or invalid `X-Api-Key`. |
| `409 Conflict` | Duplicate `(service, deployment_id)` — an event with this id already exists for this service. |
| `422 Unprocessable Entity` | Missing or empty `deployment_id`; missing required field; invalid `status`; `run_number` sent as a quoted string; any other Data Annotations failure. |

**Idempotency:** `POST /api/deployments` is append-only with a
deduplication key. The CI/CD-side caller owns `deployment_id` (SAD §7
"REST constraints observed"); retrying with the **same**
`deployment_id` yields `409 Conflict` and does not produce a duplicate
row. Retrying with a **new** `deployment_id` is a new event and
creates a new history entry. The matrix view always picks the latest
event by `deployed_at`.

## Secrets

Set these in each CI/CD tool's secret store. Never embed defaults in
workflow files or repo source.

| Secret | Source spec | Description |
|---|---|---|
| `DEPLOYMENT_DASHBOARD_URL`   | SAD §7 "CI/CD Integration" - "Secrets required" | Base URL of the dashboard, no trailing slash. |
| `DEPLOYMENT_DASHBOARD_TOKEN` | SAD §7 "CI/CD Integration" - "Secrets required" | API key sent in the `X-Api-Key` header. |

## Generic shell snippet (works in any CI/CD tool)

Use this as the starting point for any tool that can run a shell step.
Maps the tool's built-in variables onto the dashboard payload fields.
Reproduces SAD §7 "Other tools" example.

```sh
curl -sf -X POST "$DEPLOYMENT_DASHBOARD_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $DEPLOYMENT_DASHBOARD_TOKEN" \
  -H "User-Agent: deployment-dashboard-notify/1.0 (+shell)" \
  -d "{
    \"deployment_id\": \"$TOOL_PREFIX-$BUILD_ID\",
    \"service\":       \"$SERVICE_NAME\",
    \"environment\":   \"$ENVIRONMENT\",
    \"version\":       \"$VERSION\",
    \"status\":        \"success\",
    \"run_url\":       \"$BUILD_URL\",
    \"run_number\":    $BUILD_NUMBER,
    \"actor\":         \"$BUILD_USER\"
  }"
```

`$TOOL_PREFIX` is a literal you set per tool (e.g. `gh`, `ado`,
`jenkins`) so `deployment_id` is unique across CI/CD platforms (SAD §7
"Other tools"). To wire up explicit topology, add
`\"parent_deployments\": [\"$UPSTREAM_DEPLOYMENT_ID\"]` to the body —
the array MUST reference `deployment_id` values from the **same
`service`** (SAD §7 "Topology constraints"); omit the field to fall
back to correlation-based derivation.

`curl -sf` makes the step **fail the pipeline on any HTTP 4xx/5xx**.
That is the desired default - if your platform should be best-effort
for the dashboard, swap `-sf` for `-s` and the call will not fail the
pipeline on a non-2xx.

## Per-tool examples

Each section below shows the **inline pattern** (always available) and
maps the tool's built-in variables onto the dashboard payload fields.

### GitHub Actions

#### Variable mapping

| Payload field | GitHub Actions value                                                                       |
|---------------|--------------------------------------------------------------------------------------------|
| `deployment_id` | `gh-${{ github.run_id }}` — `gh-` namespace prefix avoids collisions with other CI/CD tools writing to the same dashboard |
| `parent_deployments` *(optional)* | JSON array of upstream `deployment_id` values in the same `service` — e.g. `["gh-${{ needs.deploy-dev.outputs.deployment_id }}"]` when promoting from a `deploy-dev` job. Omit or `[]` to fall back to correlation. |
| `service`     | Literal, or `${{ github.event.repository.name }}` if one repo == one service               |
| `environment` | Literal per job/stage; commonly tied to the GitHub environment name                        |
| `version`     | `${{ github.sha }}` (commit SHA) or a tag like `${{ github.ref_name }}`                    |
| `status`      | `success` / `failure` / `in-progress` driven by `if: success()` / `if: failure()` guards   |
| `run_url`     | `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`      |
| `run_number`  | `${{ github.run_number }}`                                                                 |
| `actor`       | `${{ github.actor }}`                                                                      |
| `ref` *(optional)*    | `${{ github.ref_name }}` (branch / tag / PR head ref), or `pr-${{ github.event.pull_request.number }}` on PR events |
| `sha` *(optional)*    | `${{ github.sha }}` — when `version` is set to a tag or semver, `sha` can carry the commit hash separately |

#### Inline step

Reproduced from SAD §7 "GitHub Actions (example)":

```yaml
- name: Notify Deployment Dashboard
  run: |
    curl -sf -X POST "${{ secrets.DEPLOYMENT_DASHBOARD_URL }}/api/deployments" \
      -H "Content-Type: application/json" \
      -H "X-Api-Key: ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}" \
      -H "User-Agent: deployment-dashboard-notify/1.0 (+github-actions)" \
      -d '{
        "service":     "service-a",
        "environment": "dev",
        "version":     "${{ github.sha }}",
        "status":      "success",
        "run_url":     "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
        "run_number":  ${{ github.run_number }},
        "actor":       "${{ github.actor }}"
      }'
```

#### Reusable composite action

Prefer the composite action in this repo. It validates inputs, masks
the token, sets `User-Agent`, and works on every runner OS (the inline
`curl` block above is Linux-only as written).

See [`.github/actions/notify/README.md`](../.github/actions/notify/README.md).

```yaml
- uses: ./.github/actions/notify          # from within this repo
  with:
    dashboard_url: ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
    api_token:     ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
    service:       service-a
    environment:   dev
    version:       ${{ github.sha }}
    status:        success
```

Or from another repo:

```yaml
- uses: org/deployment-dashboard/.github/actions/notify@v1
  with:
    dashboard_url: ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
    api_token:     ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
    service:       service-a
    environment:   dev
    version:       ${{ github.sha }}
    status:        success
```

### Azure DevOps

#### Variable mapping

| Payload field | Azure DevOps value                                                                |
|---------------|-----------------------------------------------------------------------------------|
| `service`     | Literal, or `$(Build.Repository.Name)`                                            |
| `environment` | Literal per stage (e.g. matches the Environment resource name)                    |
| `version`     | `$(Build.BuildNumber)` or `$(Build.SourceVersion)` (commit SHA)                   |
| `status`      | `success` / `failure` / `in-progress` driven by stage condition                   |
| `run_url`     | `$(System.CollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId)` |
| `run_number`  | `$(Build.BuildId)`                                                                |
| `actor`       | `$(Build.RequestedFor)`                                                           |
| `ref` *(optional)*    | `$(Build.SourceBranchName)` (branch / tag short name)                     |
| `sha` *(optional)*    | `$(Build.SourceVersion)` — when `version` already carries the commit, omit `sha` to avoid duplication |

`DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` are
exposed via a variable group linked to Azure Key Vault, or as
pipeline-level secret variables marked "secret".

#### PowerShell task (reproduced from SAD §7 "Azure DevOps (example)")

```yaml
- task: PowerShell@2
  displayName: Notify Deployment Dashboard
  inputs:
    targetType: inline
    script: |
      $body = @{
        service     = "service-a"
        environment = "dev"
        version     = "$(Build.BuildNumber)"
        status      = "success"
        run_url     = "$(System.CollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId)"
        run_number  = [int]"$(Build.BuildId)"
        actor       = "$(Build.RequestedFor)"
      } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri "$(DEPLOYMENT_DASHBOARD_URL)/api/deployments" `
        -Method POST -ContentType "application/json" `
        -Headers @{
          "X-Api-Key"  = "$(DEPLOYMENT_DASHBOARD_TOKEN)"
          "User-Agent" = "deployment-dashboard-notify/1.0 (+azure-devops)"
        } `
        -Body $body
```

`Invoke-RestMethod` throws on non-2xx by default, which fails the
task - the desired behaviour. Wrap in `try { ... } catch { Write-Warning ... }`
if the dashboard should be best-effort for this pipeline.

### Jenkins

#### Variable mapping

| Payload field | Jenkins value                                                       |
|---------------|---------------------------------------------------------------------|
| `service`     | Literal, or `$JOB_NAME` split on `/`                                |
| `environment` | Literal per stage / parameter                                       |
| `version`     | `$GIT_COMMIT`, `$BUILD_TAG`, or a parameter such as `$VERSION`      |
| `status`      | `success` / `failure` / `in-progress` driven by `post { ... }`      |
| `run_url`     | `$BUILD_URL`                                                        |
| `run_number`  | `$BUILD_NUMBER`                                                     |
| `actor`       | `$BUILD_USER` (requires the Build User Vars plugin), or `$CHANGE_AUTHOR` |
| `ref` *(optional)*    | `$GIT_BRANCH` (branch name), or `$CHANGE_BRANCH` on PR builds |
| `sha` *(optional)*    | `$GIT_COMMIT` — when `version` already carries the commit, omit `sha` |

Secrets are exposed via the Credentials Binding plugin -
`withCredentials` makes `DEPLOYMENT_DASHBOARD_URL` and
`DEPLOYMENT_DASHBOARD_TOKEN` available as masked env vars.

#### Declarative pipeline (shell step)

```groovy
pipeline {
  agent any
  stages {
    stage('Deploy') {
      steps {
        // ... your existing deploy steps ...
      }
    }
  }
  post {
    success { notifyDashboard('success') }
    failure { notifyDashboard('failure') }
  }
}

def notifyDashboard(String status) {
  withCredentials([
    string(credentialsId: 'deployment-dashboard-url',   variable: 'DEPLOYMENT_DASHBOARD_URL'),
    string(credentialsId: 'deployment-dashboard-token', variable: 'DEPLOYMENT_DASHBOARD_TOKEN')
  ]) {
    sh """
      curl -sf -X POST "\$DEPLOYMENT_DASHBOARD_URL/api/deployments" \\
        -H "Content-Type: application/json" \\
        -H "X-Api-Key: \$DEPLOYMENT_DASHBOARD_TOKEN" \\
        -H "User-Agent: deployment-dashboard-notify/1.0 (+jenkins)" \\
        -d '{
          "service":    "service-a",
          "environment":"dev",
          "version":    "'"\$GIT_COMMIT"'",
          "status":     "${status}",
          "run_url":    "'"\$BUILD_URL"'",
          "run_number": '"\$BUILD_NUMBER"',
          "actor":      "'"\${BUILD_USER:-jenkins}"'"
        }'
    """
  }
}
```

The double-escaping (`\\$`) is required so Groovy passes the env var
references through to the shell intact. `curl -sf` makes the post-step
fail the build on a non-2xx response.

### GitLab CI

#### Variable mapping

| Payload field | GitLab CI value                                                       |
|---------------|-----------------------------------------------------------------------|
| `service`     | Literal, or `$CI_PROJECT_NAME`                                        |
| `environment` | `$CI_ENVIRONMENT_NAME` when using `environment:` in the job           |
| `version`     | `$CI_COMMIT_SHA` or `$CI_COMMIT_TAG`                                  |
| `status`      | `success` / `failure` / `in-progress` driven by `when:`               |
| `run_url`     | `$CI_JOB_URL` (job) or `$CI_PIPELINE_URL` (pipeline)                  |
| `run_number`  | `$CI_JOB_ID` or `$CI_PIPELINE_IID`                                    |
| `actor`       | `$GITLAB_USER_LOGIN`                                                  |
| `ref` *(optional)*    | `$CI_COMMIT_REF_NAME` (branch / tag), or `$CI_MERGE_REQUEST_IID` on MR pipelines |
| `sha` *(optional)*    | `$CI_COMMIT_SHA` — when `version` already carries the commit, omit `sha` |

`DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` are
project- or group-level CI/CD variables marked "Masked" and
"Protected".

#### `.gitlab-ci.yml` job

```yaml
.notify-dashboard: &notify-dashboard
  image: curlimages/curl:8.10.1
  script:
    - |
      curl -sf -X POST "$DEPLOYMENT_DASHBOARD_URL/api/deployments" \
        -H "Content-Type: application/json" \
        -H "X-Api-Key: $DEPLOYMENT_DASHBOARD_TOKEN" \
        -H "User-Agent: deployment-dashboard-notify/1.0 (+gitlab-ci)" \
        -d "{
          \"service\":    \"service-a\",
          \"environment\":\"$CI_ENVIRONMENT_NAME\",
          \"version\":    \"$CI_COMMIT_SHA\",
          \"status\":     \"$NOTIFY_STATUS\",
          \"run_url\":    \"$CI_JOB_URL\",
          \"run_number\": $CI_JOB_ID,
          \"actor\":      \"$GITLAB_USER_LOGIN\"
        }"

notify:success:
  <<: *notify-dashboard
  stage: .post
  variables:
    NOTIFY_STATUS: success
  when: on_success

notify:failure:
  <<: *notify-dashboard
  stage: .post
  variables:
    NOTIFY_STATUS: failure
  when: on_failure
```

### Other tools (CircleCI, Bitbucket Pipelines, TeamCity, ...)

Use the [generic shell snippet](#generic-shell-snippet-works-in-any-cicd-tool)
and map the tool's built-in variables onto the seven required payload
fields. The two optional fields — `ref`, `sha` — can be added if the
tool exposes them as built-in variables; otherwise omit them. Every
CI/CD tool exposes equivalents for run URL, run number, actor, and
commit SHA.

## In-progress + terminal pattern

The matrix renders one of six box states (SAD §7 "Web Dashboard
(MVP) - Visual layout"). To get the **running spinner + last
successful version** behaviour:

1. Fire `status: "in-progress"` at the start of the deploy stage.
2. Fire `status: "success"` (or `failure`) when the stage finishes.

The dashboard derives `lastSuccessful` and `previousFailed`
automatically from history (SAD §7 "API Contract" - matrix response
shape). No client-side coordination is required.

## Troubleshooting

| Symptom                                | Likely cause                                                              | Fix                                                                                  |
|----------------------------------------|---------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `401 Unauthorized`                     | `DEPLOYMENT_DASHBOARD_TOKEN` missing, expired, or rotated                 | Re-issue the API token; update the CI/CD secret store.                               |
| `422 Unprocessable Entity`             | Payload shape mismatch - typically `run_number` sent as a quoted string   | Send as a JSON number, not `"1247"`. See SAD §7 "API Contract".                      |
| `404` from `curl` (HTML response body) | URL ends with `/`, producing `//api/deployments`                          | Strip the trailing slash from `DEPLOYMENT_DASHBOARD_URL`.                            |
| Connection timeout / DNS               | Pipeline runner cannot reach the dashboard's internal network             | Per NFR-04, the dashboard is internal-only; run the notify step from a runner inside the same network, or via VPN. |
| Matrix box never updates               | Notify step ran but failed silently                                       | Switch to the composite action (validates + masks) or replace `curl -s` with `curl -sf` so failures surface. |

## Cross-references

- SAD §1 / §2 - why a push-based, tool-agnostic ingest model.
- SAD §4 FR-05, FR-06, FR-10 - functional requirements driving this
  integration shape.
- SAD §7 "CI/CD Integration" - canonical inline-step examples this
  doc mirrors.
- SAD §7 "API Contract" - status codes, idempotency, REST constraints.
- SAD §8 "Security Considerations" - why a static API key is
  sufficient for internal-only tooling.
- SAD §11 MVP §1.4 / "CI/CD Integration" §1 - WBS items this doc and
  the composite action satisfy.
