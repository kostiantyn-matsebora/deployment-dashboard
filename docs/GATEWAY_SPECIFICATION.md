# Gateway Specification — App Gateway

**Status:** Draft · **Date:** 2026-06-16

Implementation contract for the **App Gateway** — the nginx reverse proxy that is the single public surface in front of the Frontend SPA and the `Dashboard.Api`. A separate **demo-gateway image** layers `/demo/*` routing on top for evaluation use.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/SAD.md`](SAD.md) §7 | Architecture — gateway as sole public surface, internal upstreams. |
| [`docs/api/openapi.yaml`](api/openapi.yaml) | API paths the gateway routes (`/api/*`, `/healthz`, `/readyz`). |
| [`docs/API_SPECIFICATION.md`](API_SPECIFICATION.md) | API CORS / SSE behaviour the gateway pairs with (D3, D6). |
| [`docs/DEMO_DRIVER_SPECIFICATION.md`](DEMO_DRIVER_SPECIFICATION.md) | Demo driver paths (`/demo/*`) and SSE streams the demo-gateway proxies. |

> `CR-####` / `ADR-####` documents referenced elsewhere **do not exist** — ignore those citations.

---

## 1. Role

Thin nginx reverse proxy — **routing + SSE plumbing only**:
- No auth, business logic, API response caching, rate limiting, or request rewriting beyond path routing.
- All state stays in the API.
- **Config-only image** — nginx + a replacement conf template; no second component that knows the contract.

The **production image** carries no demo routes, no resolver, and no `DEMO_DRIVER_UPSTREAM`. The **demo-gateway image** layers those on via the `*.snippet` include mechanism (GW12, §3).

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| GW1 | **Single public surface**; fronts internal-only upstreams (frontend SPA, API). | SAD §7, NFR-04. |
| GW2 | **Config-only image** — nginx + a replacement conf template. No unit tests. | Config-only by design; behaviour coverage via the integration suite. |
| GW3 | **SPA fallback (`try_files … /index.html`) is owned by the *frontend* container**, not the gateway. | Gateway proxies `/` blindly → stays contract-agnostic. (G-Q1) |
| GW4 | `/healthz` + `/readyz` **are proxied** to the API. | Ops reachability through the single surface. (G-Q2) |
| GW5 | **Env-agnostic config via `envsubst`** with a narrowed var filter per image. | One image pair, per-environment upstreams (local-compose vs Azure). Platform-agnostic (SAD §6). (G-Q3) |
| GW6 | **Gateway mode is the default; API CORS stays off** (`CORS_ALLOWED_ORIGINS` empty). | Single origin → no CORS. The split-domain CORS path (backend D6) is the gateway-less alternative; the two modes are mutually exclusive. |
| GW7 | **Base = `nginxinc/nginx-unprivileged`**, non-root, listens **`8080`**. | Matches integration `:8080` + a non-root container target. |
| GW8 | **Gateway does not terminate TLS**; serves plain HTTP on `:8080`. | Internal-only network (NFR-04). TLS, where required, is a hosting concern outside this spec. (G-Q4) |
| GW9 | **No build-time `nginx -t`**; no API caching; no rate limiting (reserved, guidelines §9). | Keep the build + image minimal. (G-Q5) |
| GW10 | **Scalar reference UI + OpenAPI document are proxied** to the API (`/scalar*`, `/openapi/*`). | API docs reachable through the single public surface; read-only, consistent with public `GET /api/*` reads. |
| GW11 | **`Host` set per-location to the upstream FQDN**, never `$host`. | ACA's internal Envoy routes by `Host` header to the upstream FQDN. Using `$host` (the gateway's public hostname) causes 404s on ACA. Per-location `Host` makes one config work on both Compose and ACA. |
| GW12 | **Demo split** — the demo-gateway image `FROM`s the production image and layers `/demo/*` routing via the `*.snippet` include. Production carries no demo routes, no resolver, no `DEMO_DRIVER_UPSTREAM`. | Keeps production minimal; demo concerns are fully isolated in the demo-gateway image (#266). |

---

## 3. Solution layout

Two images build from `gateway/` with the same build context.

```
gateway/
  Dockerfile                   # Production image: FROM nginxinc/nginx-unprivileged; COPY default.conf.template
  Dockerfile.demo              # Demo image: FROM production image; adds 15-detect-dns-resolver.envsh + demo.snippet.template
  15-detect-dns-resolver.envsh # Entrypoint drop-in — auto-detects DNS_RESOLVER from resolv.conf (demo image only)
  default.conf.template        # → /etc/nginx/templates/default.conf.template (envsubst at start)
  demo.snippet.template        # → /etc/nginx/templates/demo.snippet.template (envsubst at start, demo image only)
```

**`*.snippet` render + include mechanism.**

The stock `nginxinc/nginx-unprivileged` entrypoint renders every `*.template` file in `/etc/nginx/templates/` into `/etc/nginx/conf.d/` via `envsubst` at container start. This produces files with the original extension:
- `default.conf.template` → `conf.d/default.conf` (loaded by nginx's http-level `include conf.d/*.conf`)
- `demo.snippet.template` → `conf.d/demo.snippet`

The `conf.d/*.snippet` files are **not** matched by nginx's default http-level `include conf.d/*.conf`. They are only loaded by the explicit `include /etc/nginx/conf.d/*.snippet;` directive inside the production `server{}` block. In the production image, no `.snippet` file is present — the include is a legal nginx no-op. In the demo-gateway image, `demo.snippet` is rendered and picked up by that directive, activating `/demo/*` routing inside the existing server block without any modification to `default.conf.template`.

---

## 4. Routing matrix

### Production gateway

| Path | Upstream | Treatment |
|---|---|---|
| `/api/events/stream` | `api` | **Dedicated SSE block** — see §5 |
| `/api/` | `api` | JSON read/write; default buffering |
| `/scalar`, `/scalar/` | `api` | Scalar API-reference UI (read-only docs) — bare path redirects to `/scalar/v1` |
| `/openapi/` | `api` | OpenAPI document (`/openapi/v1.json`), fetched in-browser by Scalar |
| `/healthz`, `/readyz` | `api` | API probes, proxied (GW4) |
| `/health` | **gateway-local** | `return 200` — gateway liveness (integration + platform probe) |
| `/` (all else) | `frontend` | SPA assets + Angular routes; **frontend owns `try_files` fallback** (GW3) |

### Demo-gateway additions (demo-gateway image only)

These routes are absent from the production image. They are activated by `demo.snippet` (§3) when the demo-gateway image is used.

| Path | Upstream | Treatment |
|---|---|---|
| `/demo/stream` | `demo-driver` | **Dedicated SSE block** — same settings as `/api/events/stream`; see §5 |
| `/demo/control-stream` | `demo-driver` | **Dedicated SSE block** — same settings as `/api/events/stream`; see §5 |
| `/demo/` | `demo-driver` | Demo driver control API + panel; default buffering |

---

## 5. SSE handling (the one critical block)

The stream location must disable every buffering/batching layer or live updates stall and violate NFR-03 (5 s):

```nginx
location = /api/events/stream {
    proxy_pass         http://api;
    proxy_http_version 1.1;
    proxy_set_header   Host              ${API_UPSTREAM};
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   Connection        '';
    proxy_buffering    off;          # nginx must not batch the stream
    proxy_cache        off;
    gzip               off;          # gzip buffers the stream
    proxy_read_timeout 3600s;        # long-lived connection
    chunked_transfer_encoding on;
}
```

The API additionally emits `X-Accel-Buffering: no` (belt-and-braces).

**Demo SSE blocks.** The same settings apply to `/demo/stream` and `/demo/control-stream` in `demo.snippet.template`, with upstream `demo-driver` (variable-based `proxy_pass` — see §6 demo snippet shape). These blocks live in `demo.snippet.template`, not in `default.conf.template`.

---

## 6. Config template (shape)

### Production template (`default.conf.template`)

```nginx
upstream frontend    { server ${FRONTEND_UPSTREAM}; }
upstream api         { server ${API_UPSTREAM}; }

server {
    listen 8080;
    server_tokens off;
    client_max_body_size 256k;

    # Server-level proxy defaults — do NOT set Host here.
    # Any location-level proxy_set_header cancels server-level inheritance,
    # so every proxy location re-declares Host + forwarded headers in full.
    proxy_http_version 1.1;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;

    location = /health  { return 200 "ok\n"; access_log off; default_type text/plain; }

    location = /api/events/stream { ... }  # §5 — SSE block; Host: ${API_UPSTREAM}
    location /api/    { proxy_pass http://api;      proxy_set_header Host ${API_UPSTREAM}; ... }
    location /healthz { proxy_pass http://api;      proxy_set_header Host ${API_UPSTREAM}; ... }
    location /readyz  { proxy_pass http://api;      proxy_set_header Host ${API_UPSTREAM}; ... }
    location = /scalar  { proxy_pass http://api;    proxy_set_header Host ${API_UPSTREAM}; ... }
    location /scalar/   { proxy_pass http://api;    proxy_set_header Host ${API_UPSTREAM}; ... }
    location /openapi/  { proxy_pass http://api;    proxy_set_header Host ${API_UPSTREAM}; ... }
    location /        { proxy_pass http://frontend; proxy_set_header Host ${FRONTEND_UPSTREAM}; ... }

    # Demo extension point — zero matches in production = legal nginx no-op.
    include /etc/nginx/conf.d/*.snippet;
}
```

Key properties:
- **No `upstream demo-driver` block** — production image carries no demo config.
- **No resolver** — upstreams resolved at startup via named `upstream` blocks; variable `proxy_pass` is not used in the production image.
- **Per-location `Host`** set to the upstream FQDN (GW11): `${API_UPSTREAM}` for api locations, `${FRONTEND_UPSTREAM}` for the frontend. Never `$host`.
- **`include /etc/nginx/conf.d/*.snippet;`** is the extension point; the demo-gateway image drops `demo.snippet` there.

### Demo snippet shape (`demo.snippet.template`)

```nginx
# DNS resolver — required for variable-based proxy_pass (demo-driver is optional).
# Variable proxy_pass defers DNS resolution; gateway starts cleanly when
# demo-driver is not running (returns 502 until available).
# DNS_RESOLVER is auto-detected at container start (see §7) — no default ENV
# baked into the image. Examples of what detection yields per platform:
#   Docker Compose (embedded DNS):    127.0.0.11
#   Azure Container Apps (Azure DNS): 168.63.129.16
#   Kubernetes (kube-dns/CoreDNS):    cluster DNS ClusterIP
resolver ${DNS_RESOLVER} valid=10s ipv6=off;

location = /demo/stream {
    set                        $dd http://${DEMO_DRIVER_UPSTREAM};
    proxy_pass                 $dd;
    proxy_http_version         1.1;
    proxy_set_header           Host              ${DEMO_DRIVER_UPSTREAM};
    ...   # same SSE settings as §5
}

location = /demo/control-stream {
    set              $dd http://${DEMO_DRIVER_UPSTREAM};
    proxy_pass       $dd;
    proxy_http_version 1.1;
    proxy_set_header Host ${DEMO_DRIVER_UPSTREAM};
    ...   # same SSE settings as §5
}

location /demo/ {
    set              $dd http://${DEMO_DRIVER_UPSTREAM};
    proxy_pass       $dd;
    proxy_set_header Host              ${DEMO_DRIVER_UPSTREAM};
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Key properties:
- **Variable `proxy_pass`** (`set $dd …; proxy_pass $dd`) defers DNS resolution — demo-driver is optional; gateway starts without it (returns 502 until demo-driver is available).
- **`resolver`** directive is required by nginx when variable `proxy_pass` is used.
- **`Host`** set to `${DEMO_DRIVER_UPSTREAM}` for ACA Envoy routing (GW11).

---

## 7. Configuration (env)

### Production image env

| Var | Example | Purpose |
|---|---|---|
| `FRONTEND_UPSTREAM` | `frontend:80` | Frontend upstream `host:port` |
| `API_UPSTREAM` | `api:8080` | API upstream `host:port` |
| `NGINX_ENVSUBST_FILTER` | `^(FRONTEND_UPSTREAM\|API_UPSTREAM)$` | Narrows `envsubst` to production vars; nginx's own `$host`/`$uri`/`$scheme`/`$proxy_add_x_forwarded_for` survive unchanged |

The production image filter **excludes** `DNS_RESOLVER` and `DEMO_DRIVER_UPSTREAM` — those vars are demo-image-only (GW12).

### Demo-gateway image additional env

| Var | Default in image | Example override | Purpose |
|---|---|---|---|
| `DNS_RESOLVER` | *(unset — auto-detected)* | `168.63.129.16` (Azure DNS) | DNS resolver address for variable-based `proxy_pass` in `demo.snippet` |
| `DEMO_DRIVER_UPSTREAM` | — | `demo-driver:3001` | Demo driver upstream `host:port`; required by the snippet's `resolver` + `proxy_pass` |
| `NGINX_ENVSUBST_FILTER` | `^(FRONTEND_UPSTREAM\|API_UPSTREAM\|DEMO_DRIVER_UPSTREAM\|DNS_RESOLVER)$` | — | Widened filter to include demo vars in addition to production vars |

The demo image ships no `DNS_RESOLVER` default ENV. A sourced entrypoint drop-in (`gateway/15-detect-dns-resolver.envsh`) auto-detects it at container start: if `DNS_RESOLVER` is unset or empty, it reads the first `nameserver` line from `/etc/resolv.conf`, falling back to `127.0.0.11` (Docker embedded DNS) when none is found. An explicitly set `DNS_RESOLVER` env always overrides — the script only fills in a value when one is not supplied. This makes the demo image zero-config on Compose, Kubernetes, and Azure Container Apps alike; override only when the auto-detected value is wrong for the target environment.

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
