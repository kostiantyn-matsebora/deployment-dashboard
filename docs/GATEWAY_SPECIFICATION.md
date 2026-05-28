# Gateway Specification — App Gateway

**Status:** Draft · **Date:** 2026-05-28

Implementation contract for the **App Gateway** — the nginx reverse proxy that is the single public surface in front of the Frontend SPA and the `Dashboard.Api`.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/SAD.md`](SAD.md) §7 | Architecture — gateway as sole public surface, two internal upstreams. |
| [`docs/api/openapi.yaml`](api/openapi.yaml) | API paths the gateway routes (`/api/*`, `/healthz`, `/readyz`). |
| [`docs/BACKEND_SPECIFICATION.md`](BACKEND_SPECIFICATION.md) | Backend CORS / SSE behaviour the gateway pairs with (D3, D6). |

> `CR-####` / `ADR-####` documents referenced elsewhere **do not exist** — ignore those citations.

---

## 1. Role

A thin nginx reverse proxy — **routing + SSE plumbing only**. No auth, no business logic, no API response caching, no rate limiting, no request rewriting beyond path routing. All state stays in the API. The image is **config-only** (nginx + a replacement conf template) and avoids a second component that knows the contract.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| GW1 | **Single public surface**; fronts two internal-only upstreams (frontend SPA, API). | SAD §7, NFR-04. |
| GW2 | **Config-only image** — nginx + a replacement conf template. No unit tests. | Config-only by design; behaviour coverage via the integration suite. |
| GW3 | **SPA fallback (`try_files … /index.html`) is owned by the *frontend* container**, not the gateway. | Gateway proxies `/` blindly → stays contract-agnostic. (G-Q1) |
| GW4 | `/healthz` + `/readyz` **are proxied** to the API. | Ops reachability through the single surface. (G-Q2) |
| GW5 | **Env-agnostic config via `envsubst`** with a whitelisted var set. | One image, per-environment upstreams (local-compose vs Azure). Platform-agnostic (SAD §6). (G-Q3) |
| GW6 | **Gateway mode is the default; API CORS stays off** (`CORS_ALLOWED_ORIGINS` empty). | Single origin → no CORS. The split-domain CORS path (backend D6) is the gateway-less alternative; the two modes are mutually exclusive. |
| GW7 | **Base = `nginxinc/nginx-unprivileged`**, non-root, listens **`8080`**. | Matches integration `:8080` + a non-root container target. |
| GW8 | **Gateway does not terminate TLS**; serves plain HTTP on `:8080`. | Internal-only network (NFR-04). TLS, where required, is a hosting concern outside this spec. (G-Q4) |
| GW9 | **No build-time `nginx -t`**; no API caching; no rate limiting (reserved, guidelines §9). | Keep the build + image minimal. (G-Q5) |

---

## 3. Solution layout

The image builds from `gateway/Dockerfile` with build context `gateway/`.

```
gateway/
  Dockerfile                 # FROM nginxinc/nginx-unprivileged; COPY template
  default.conf.template      # → /etc/nginx/templates/default.conf.template (envsubst at start)
```

The official nginx entrypoint renders `*.template` from `/etc/nginx/templates/` into `/etc/nginx/conf.d/` via `envsubst` on container start.

---

## 4. Routing matrix

| Path | Upstream | Treatment |
|---|---|---|
| `/api/events/stream` | `api` | **Dedicated SSE block** — see §5 |
| `/api/` | `api` | JSON read/write; default buffering |
| `/healthz`, `/readyz` | `api` | API probes, proxied (GW4) |
| `/health` | **gateway-local** | `return 200` — gateway liveness (integration + platform probe) |
| `/` (all else) | `frontend` | SPA assets + Angular routes; **frontend owns `try_files` fallback** (GW3) |

---

## 5. SSE handling (the one critical block)

The stream location must disable every buffering/batching layer or live updates stall and violate NFR-03 (5 s):

```nginx
location /api/events/stream {
    proxy_pass http://api;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;          # nginx must not batch the stream
    proxy_cache off;
    gzip off;                     # gzip buffers the stream
    proxy_read_timeout 3600s;     # long-lived connection
    chunked_transfer_encoding on;
}
```

The API additionally emits `X-Accel-Buffering: no` (belt-and-braces).

---

## 6. Config template (shape)

```nginx
upstream frontend { server ${FRONTEND_UPSTREAM}; }
upstream api      { server ${API_UPSTREAM}; }

server {
    listen 8080;
    server_tokens off;
    client_max_body_size 256k;        # ingest bodies are tiny

    location = /health { return 200 "ok\n"; access_log off; default_type text/plain; }

    location /api/events/stream { ... }   # §5
    location /api/    { proxy_pass http://api; }
    location /healthz { proxy_pass http://api; }
    location /readyz  { proxy_pass http://api; }
    location /        { proxy_pass http://frontend; }
}
```

Standard proxy headers (`Host`, `X-Forwarded-For`, `X-Forwarded-Proto`) set on the proxied locations.

---

## 7. Configuration (env)

| Var | Example | Purpose |
|---|---|---|
| `FRONTEND_UPSTREAM` | `frontend:8080` | frontend upstream `host:port` |
| `API_UPSTREAM` | `api:8080` | API upstream `host:port` |
| `NGINX_ENVSUBST_FILTER` | `^(FRONTEND_UPSTREAM\|API_UPSTREAM)$` | restrict `envsubst` to our vars so nginx's own `$host`/`$uri` survive |

Examples are illustrative; actual upstream `host:port` come from the frontend / API deployment specs per environment.

---

## 8. Testing

Config-only ⇒ **no unit tests**. Behaviour is verified by the cross-stack **integration suite**, which drives real traffic — routing, SSE passthrough, health — through the running gateway at `http://localhost:8080`.

---

## 9. Out of scope

- Auth (the API owns `X-Api-Key`).
- Rate limiting (reserved; guidelines §9).
- API response caching (NFR-05 statelessness — every read hits the DB).
- SPA-fallback logic (frontend container owns it).
- TLS termination (internal-only; hosting concern).
- Request rewriting beyond path routing.
