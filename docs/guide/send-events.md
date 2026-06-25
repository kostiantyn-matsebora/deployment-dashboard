# Integrate your CI/CD

Deployment Dashboard is **tool-agnostic**: any pipeline that can make an HTTP `POST` can feed it. Integration is a **single step** added to your existing pipeline — no plugins, no pipeline rewrite. This is the core adopter workflow.

Full contract: [API guidelines](../api/api-guidelines.md) · [OpenAPI spec](../api/openapi.yaml) · [more examples](../api/api-examples.md).

## The one endpoint

```
POST /api/deployments
X-Api-Key: <your API_KEY>
Content-Type: application/json
```

Post one event whenever a deployment changes state. A typical deployment emits two: `in-progress` when it starts, then `success` / `failure` when it ends.

## Payload

| Field | Required | Type | Notes |
|---|---|---|---|
| `deployment_id` | **yes** | string | Correlation key grouping the rows of one logical deployment (e.g. a run id). **Not** a uniqueness key. |
| `service` | **yes** | string | Service name (matrix row). |
| `namespace` | no | string | Optional grouping segment that scopes `service` — typically the repository or project the service lives in (the repo half of a GitHub `owner/repo`, e.g. `acme/api` → `api`). Same `service` under two namespaces ⇒ two distinct matrix rows, labelled `namespace/service`. Omit ⇒ rows render unprefixed. |
| `environment` | **yes** | string | Environment name (matrix column), e.g. `dev`, `prod`. |
| `status` | **yes** | enum | `in-progress` \| `success` \| `failure`. |
| `happened_at` | **yes** | string | RFC 3339 UTC timestamp of when the state changed **on the CI/CD side** (not when the dashboard received it). |
| `version` | no | string | Version / tag / SHA shown in the slot. |
| `run_url` | no | string | Link back to the CI/CD run. |
| `run_number` | no | integer | Run number. |
| `actor` | no | string | Who triggered it (CI identifier, not an end user). |
| `ref` | no | string | Git ref, e.g. `refs/heads/main`. |
| `sha` | no | string | Commit SHA. |
| `parent_deployments` | no | string[] | `deployment_id`s of upstream deployments (e.g. prod inherits from dev). |

Services and environments are **discovered from the data** — no registration, no config. Post a new `service`/`environment` and it appears.

## Responses

| Code | Meaning |
|---|---|
| `201 Created` | Row appended. `Location: /api/deployments/{id}`. |
| `401 Unauthorized` | `X-Api-Key` missing or invalid. |
| `422 Unprocessable Entity` | Validation failed (missing required field, bad enum, non-integer `run_number`, malformed `happened_at`, unknown field). Body is `application/problem+json` with an `errors[]` array. |

## Append-only semantics

- `POST /api/deployments` **appends** a row. There is no update, no upsert, no server-side dedup.
- A retried POST creates **another** row. Retry handling is the caller's concern.
- The dashboard reduces the log on read: the matrix shows the latest by `happened_at` per `(service, environment)`; the history drawer keeps every row.

So: send `in-progress` and the terminal `success`/`failure` as **separate** POSTs with the **same** `deployment_id` and increasing `happened_at`. Both persist; the matrix shows the latest.

## Copy-paste integrations

### curl (any pipeline)

```bash
curl -fsS -X POST "$DASHBOARD_URL/api/deployments" \
  -H "X-Api-Key: $DASHBOARD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "deployment_id": "'"$RUN_ID"'",
    "service": "checkout",
    "namespace": "storefront",
    "environment": "prod",
    "version": "'"$VERSION"'",
    "status": "success",
    "happened_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
    "run_url": "'"$RUN_URL"'",
    "actor": "'"$ACTOR"'"
  }'
```

### GitHub Actions

Add a step at the end of your deploy job (and optionally one at the start with `status: in-progress`):

```yaml
      - name: Notify Deployment Dashboard
        if: always()                       # report failures too
        run: |
          curl -fsS -X POST "${{ vars.DASHBOARD_URL }}/api/deployments" \
            -H "X-Api-Key: ${{ secrets.DASHBOARD_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "deployment_id": "gh-${{ github.run_id }}",
              "service": "checkout",
              "namespace": "${{ github.event.repository.name }}",
              "environment": "prod",
              "version": "${{ github.sha }}",
              "status": "${{ job.status == 'success' && 'success' || 'failure' }}",
              "happened_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
              "run_url": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
              "run_number": ${{ github.run_number }},
              "actor": "${{ github.actor }}",
              "ref": "${{ github.ref }}",
              "sha": "${{ github.sha }}"
            }'
```

> Prefer pull mode over editing every workflow? The optional **Fetcher** polls the GitHub Actions API and posts for you — see [Install § pull mode](./install/index.md#deployment-shapes) and the [Fetcher spec](../FETCHER_SPECIFICATION.md).

### Azure DevOps Pipelines

```yaml
- task: Bash@3
  displayName: Notify Deployment Dashboard
  condition: always()
  inputs:
    targetType: inline
    script: |
      curl -fsS -X POST "$(DASHBOARD_URL)/api/deployments" \
        -H "X-Api-Key: $(DASHBOARD_API_KEY)" \
        -H "Content-Type: application/json" \
        -d '{
          "deployment_id": "ado-$(Build.BuildId)",
          "service": "checkout",
          "namespace": "$(Build.Repository.Name)",
          "environment": "prod",
          "version": "$(Build.SourceVersion)",
          "status": "success",
          "happened_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
          "run_url": "$(System.CollectionUri)$(System.TeamProject)/_build/results?buildId=$(Build.BuildId)",
          "actor": "$(Build.RequestedFor)"
        }'
```

### GitLab CI

```yaml
notify_dashboard:
  stage: .post
  when: always
  script:
    - |
      curl -fsS -X POST "$DASHBOARD_URL/api/deployments" \
        -H "X-Api-Key: $DASHBOARD_API_KEY" \
        -H "Content-Type: application/json" \
        -d "{
          \"deployment_id\": \"gl-$CI_PIPELINE_ID\",
          \"service\": \"checkout\",
          \"namespace\": \"$CI_PROJECT_NAME\",
          \"environment\": \"prod\",
          \"version\": \"$CI_COMMIT_SHORT_SHA\",
          \"status\": \"success\",
          \"happened_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
          \"run_url\": \"$CI_PIPELINE_URL\",
          \"actor\": \"$GITLAB_USER_LOGIN\"
        }"
```

### Jenkins (declarative pipeline)

```groovy
post {
  always {
    sh '''
      curl -fsS -X POST "$DASHBOARD_URL/api/deployments" \
        -H "X-Api-Key: $DASHBOARD_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
          "deployment_id": "jenkins-'"$BUILD_TAG"'",
          "service": "checkout",
          "namespace": "storefront",
          "environment": "prod",
          "version": "'"$GIT_COMMIT"'",
          "status": "success",
          "happened_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
          "run_url": "'"$BUILD_URL"'",
          "actor": "'"$BUILD_USER"'"
        }'
    '''
  }
}
```

## Verify it worked

```bash
curl "$DASHBOARD_URL/api/matrix"          # your service/environment should appear
```

Or just open the dashboard — the new slot updates live over SSE within a few seconds. If nothing shows up, see [FAQ & troubleshooting](./faq.md).
