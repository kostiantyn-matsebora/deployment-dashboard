# API Examples — copy-paste minimum viable calls

Companion to [`api-guidelines.md`](./api-guidelines.md).

---

## Ingest (terminal success)

```http
POST /api/deployments HTTP/1.1
Host: dashboard.internal
Content-Type: application/json
X-Api-Key: ********
X-Progress-Reporter: dashboard-fetcher/github-actions

{
  "deployment_id":      "gh-9482-1",
  "service":            "service-a",
  "environment":        "dev",
  "version":            "1.4.2",
  "status":             "success",
  "happened_at":        "2026-05-28T09:42:17Z",
  "run_url":            "https://github.com/acme/repo/actions/runs/9482",
  "run_number":         9482,
  "actor":              "alice",
  "ref":                "refs/heads/main",
  "sha":                "3f2c1a9",
  "parent_deployments": []
}
```

```http
HTTP/1.1 201 Created
Location: /api/deployments/0d3e4f9a-2b1c-4f7e-9a12-7b6e5c2d8f01
Content-Type: application/json

{ "id": "0d3e4f9a-...", "deployment_id": "gh-9482-1", "happened_at": "2026-05-28T09:42:17Z", ... }
```

---

## Ingest (in-progress, same logical deployment as a later terminal row)

```http
POST /api/deployments HTTP/1.1
Content-Type: application/json
X-Api-Key: ********

{
  "deployment_id":      "gh-9491-1",
  "service":            "service-a",
  "environment":        "prod",
  "version":            "1.4.2",
  "status":             "in-progress",
  "happened_at":        "2026-05-28T10:14:02Z",
  "parent_deployments": ["gh-9482-1"]
}
```

A subsequent `POST` with `deployment_id=gh-9491-1`, `status=success`, and a later `happened_at` appends a second row. Both rows persist; the Matrix shows the latest by `happened_at`.

---

## Matrix snapshot

```http
GET /api/matrix HTTP/1.1
Accept: application/json
```

```http
HTTP/1.1 200 OK
ETag: W/"m-2026-05-28T10:14:02Z-482"
Content-Type: application/json

{
  "generated_at": "2026-05-28T10:14:02Z",
  "environments": ["dev","qa","uat","prod"],
  "rows": [
    {
      "service": "service-a",
      "slots": {
        "dev":  { "current": { ... status:"success" ... } },
        "qa": {
          "current":         { ... status:"success", version:"1.4.3" ... },
          "next":            { ... status:"queued",  version:"1.4.4" ... }
        },
        "prod": {
          "current":         { ... status:"failure", version:"1.4.3" ... },
          "last_successful": { ... status:"success", version:"1.4.2" ... }
        }
      }
    }
  ]
}
```

---

## SSE

```http
GET /api/events/stream HTTP/1.1
Accept: text/event-stream
Last-Event-ID: 01J9F4WZK3W9G2T6X4QH3DKQF4
```

```
: ping

id: 01J9F4WZK3W9G2T6X4QH3DKQF5
event: deployment
data: {"id":"01J9F4WZ...","deployment_id":"gh-9491-1","service":"service-a","environment":"prod","status":"success","happened_at":"2026-05-28T10:14:02Z",...}
```

---

## Fetcher cursor

```http
PUT /api/fetcher/state/github-actions HTTP/1.1
Content-Type: application/json
X-Api-Key: ********

{ "cursor": "eyJyZXBvIjoiYWNtZS9hcGkiLCJzaW5jZSI6Ijk0ODIifQ==" }
```

```http
HTTP/1.1 204 No Content
```

---

## Control — reset all data

```http
POST /api/control/reset HTTP/1.1
X-Control-API-Key: ********
```

```http
HTTP/1.1 204 No Content
```
