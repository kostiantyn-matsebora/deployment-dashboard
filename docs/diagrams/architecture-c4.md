# Component diagram (C4)

A C4 component-level view of the runtime system (demo/eval components omitted). External systems sit outside the boundary; everything inside ships in the production stack. The gateway is the only published surface, and the API tier is a single stateless .NET container you can scale horizontally.

This Mermaid view is the lightweight, diff-friendly source. The [Architecture overview](../guide/architecture-overview.md#component-diagram-c4) embeds a polished draw.io rendering ([`architecture-c4.drawio`](./architecture-c4.drawio)) of the same system.

```mermaid
%%{init: {"flowchart": {"htmlLabels": true, "nodeSpacing": 38, "rankSpacing": 60}, "themeVariables": {"fontSize": "17px"}}}%%
flowchart TB
    CICD["<b>CI/CD pipeline</b><br>any tool"]
    PROVIDER["<b>CI/CD provider API</b><br>e.g. GitHub REST"]
    BROWSER["<b>Operator browser</b>"]
    NOTIFY["<b>Notification client</b><br>planned · v2"]

    subgraph SYS["Deployment Dashboard — system boundary"]
        GW{{"<b>App Gateway</b> · nginx<br>:8080 · only public surface"}}

        subgraph APIC["API container · .NET 10 · stateless"]
            direction LR
            WRITE["<b>Write API</b><br>X-Api-Key"]
            READ["<b>Read API</b><br>no auth"]
            SSE["<b>Real-time hub</b><br>SSE fan-out"]
            CTRL["<b>Control API</b><br>X-Control-API-Key"]
        end

        FE["<b>Frontend SPA</b><br>Angular · static"]
        FETCH["<b>Fetcher</b><br>optional · pull-mode"]
        PG[("<b>PostgreSQL</b><br>append-only · LISTEN/NOTIFY")]
    end

    CICD -->|"POST /api/deployments"| GW
    BROWSER -->|"HTTPS"| GW
    GW -->|"serves SPA"| FE
    GW -->|"writes"| WRITE
    GW -->|"reads"| READ
    GW -->|"/events/stream"| SSE
    GW -->|"control"| CTRL

    PROVIDER -.->|"poll (REST)"| FETCH
    FETCH -.->|"POST"| GW

    WRITE -->|"append"| PG
    READ -->|"query"| PG
    CTRL --> PG
    PG -.->|"NOTIFY"| SSE
    SSE -. "SSE live updates" .-> BROWSER
    NOTIFY -.->|"polls Read API"| GW

    classDef planned stroke-dasharray:6 4;
    class NOTIFY planned;
```
