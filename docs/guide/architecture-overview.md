# Architecture overview

A high-level map for adopters and operators. For the full specification, see the [Solution Architecture Document](../SAD.md) and the per-component specs in [Development & reference](../index.md).

## The question it answers

> *What version of service X is running in environment Y right now — and did the last deployment succeed?*

Deployment Dashboard is a **read-only** view of deployment state, fed by CI/CD pipeline events. It does **not** trigger or manage deployments.

## Data flow

```mermaid
flowchart TD
    CI["CI/CD tool"] -->|"POST /api/deployments"| GW["App Gateway<br/>(nginx)"]
    FETCH["Fetcher<br/>(optional, pull-mode)"] -.->|"POST /api/deployments"| GW
    GW --> FE["Frontend<br/>(Angular + nginx)"]
    GW --> API["API (.NET 10)<br/>Write + Read"]
    API --> PG[("PostgreSQL<br/>LISTEN / NOTIFY")]
    PG -. "fan-out" .-> API
    API -. "SSE (live updates)" .-> FE
```

The Fetcher is an **optional** pull-mode adapter: it polls a CI/CD API and posts events through the same `POST /api/deployments` endpoint as any other pusher.

1. A pipeline (or the Fetcher) posts a deployment event to the gateway.
2. The **Write API** validates and **appends** it to PostgreSQL (append-only log).
3. PostgreSQL `NOTIFY` fans the event out to every API instance over `LISTEN/NOTIFY`.
4. Each instance pushes it to its connected browsers via **SSE** — no reload, no sticky sessions.
5. The **Read API** reduces the log into the matrix (latest per slot), swimlanes, and history.

## Component diagram (C4)

A C4 component-level view of the runtime system (demo/eval components omitted). External systems sit outside the boundary; everything inside ships in the production stack. The gateway is the only published surface, and the API tier is a single stateless .NET container you can scale horizontally.

```mermaid
flowchart TB
    CICD["<b>CI/CD pipeline</b><br><i>[External · any tool]</i><br>GitHub Actions, Azure DevOps,<br>Jenkins, GitLab, …"]
    PROVIDER["<b>CI/CD provider API</b><br><i>[External]</i><br>e.g. GitHub Actions REST"]
    BROWSER["<b>Operator browser</b><br><i>[External]</i>"]
    NOTIFY["<b>Notification client</b><br><i>[Component · planned v2]</i><br>desktop tray alerts"]

    subgraph SYS["Deployment Dashboard — system boundary"]
        GW{{"<b>App Gateway</b><br><i>[Container: nginx]</i><br>only public surface · :8080<br>routing + SSE buffering"}}
        FE["<b>Frontend SPA</b><br><i>[Container: Angular + nginx]</i><br>static · holds no secrets"]

        subgraph APIC["API container · [.NET 10] · stateless (scale freely)"]
            WRITE["<b>Write API</b><br><i>[Component]</i><br>POST /api/deployments<br>validate + append · X-Api-Key"]
            READ["<b>Read API</b><br><i>[Component]</i><br>matrix · history · services<br>(no auth)"]
            SSE["<b>Real-time hub</b><br><i>[Component]</i><br>GET /api/events/stream<br>per-instance SSE fan-out"]
            CTRL["<b>Control API</b><br><i>[Component]</i><br>reset · control stream<br>X-Control-API-Key"]
        end

        FETCH["<b>Fetcher</b><br><i>[Container · optional · pull-mode]</i><br>polls provider → posts events"]
        PG[("<b>PostgreSQL</b><br><i>[Database]</i><br>append-only event store<br>LISTEN / NOTIFY bus")]
    end

    CICD -->|"POST /api/deployments"| GW
    BROWSER -->|"HTTPS"| GW
    GW -->|"serves SPA"| FE
    GW -->|"/api writes"| WRITE
    GW -->|"/api reads"| READ
    GW -->|"/api/events/stream"| SSE
    GW -->|"/api/control"| CTRL

    PROVIDER -.->|"polled (REST)"| FETCH
    FETCH -.->|"POST /api/deployments"| GW

    WRITE -->|"append"| PG
    READ -->|"query"| PG
    CTRL -->|"reset / control"| PG
    PG -.->|"NOTIFY"| SSE
    SSE -. "SSE live updates" .-> BROWSER
    NOTIFY -.->|"polls Read API (planned)"| GW

    classDef planned stroke-dasharray:5 5,opacity:0.75;
    class NOTIFY planned;
```

## Components

| Component | Stack | Role |
|---|---|---|
| App Gateway | nginx | Only published port (`:8080`). Routes to frontend + API; handles SSE buffering. |
| Frontend | Angular 20, served by nginx | The SPA. Static files, no runtime build. Holds no secrets. |
| API (Write + Read) | .NET 10 | Write = API-key-gated ingest; Read = unauthenticated matrix/history/SSE. Stateless. |
| Fetcher *(optional)* | .NET 10 | Pull-mode: polls a CI/CD API (GitHub Actions today) → posts via the push endpoint. |
| PostgreSQL | — | Event store + `LISTEN/NOTIFY` fan-out bus. |

The repo also ships demo-only components (Demo Driver, GitHub Emulator, Mock server) used for evaluation and testing — see [Development & reference](../index.md).

## Key design properties

| Property | What it means for you |
|---|---|
| **Tool-agnostic ingest** | Any CI/CD that can HTTP POST works. One step to integrate. See [Integrate your CI/CD](./send-events.md). |
| **Append-only** | Events are never mutated. Full history is retained (≥ 90 days, configurable). Retries = extra rows. |
| **Stateless backend** | Scale API instances freely behind the gateway; SSE still reaches every client. |
| **Auto-discovery** | Services and environments come from the data — no hardcoded lists, no registration. |
| **Internal-only by design** | Reads and the SSE stream are unauthenticated; only writes require a key. Deploy behind your network / TLS — never expose the Read API publicly. |

## Security model (short version)

| Surface | Auth |
|---|---|
| `POST /api/deployments`, fetcher state, component events | `X-Api-Key` |
| `POST /api/control/reset`, control stream | `X-Control-API-Key` (separate, optional) |
| Reads (`/api/matrix`, history, `/api/events/stream`) | none — internal network only |

See the [Security policy](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/SECURITY.md) and [API guidelines §10](../api/api-guidelines.md#10-security-notes).
