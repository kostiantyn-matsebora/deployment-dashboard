# Configuration — PostgreSQL

PostgreSQL connection and auth configuration — variables that control how API services connect to and authenticate against the database.

## :material-database: PostgreSQL: bundled profiles { #postgresql-bundled-profiles }

Used by `full`, `full-pull`, and `demo`.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_USER` | **yes** | — | Database user / cloud identity DB role name. |
| `POSTGRES_PASSWORD` | conditional | — | Database password. Set for static-credential auth (local/CI). **Omit or leave empty** to activate managed-identity passwordless auth. See [Auth modes](#postgresql-auth-modes) below. |
| `POSTGRES_DB` | no | `deployment_dashboard` | Database name. |
| `POSTGRES_SSL_MODE` | no | managed-identity: `Require`; password: *(omitted)* | Npgsql `SslMode` override. Passed verbatim when set. Valid values (case-insensitive): `Disable`, `Allow`, `Prefer`, `Require`, `VerifyCA`, `VerifyFull`. See [Auth modes](#postgresql-auth-modes). |

## :material-database-outline: PostgreSQL: external profiles { #postgresql-external-profiles }

Used by `standalone` and `standalone-pull`.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_HOST` | **yes** | `postgres` | Hostname/IP of your external PostgreSQL. Override the bundled-service default. |
| `POSTGRES_PORT` | no | `5432` | External PostgreSQL port. |
| `POSTGRES_USER` | **yes** | — | Database user / cloud identity DB role name. |
| `POSTGRES_PASSWORD` | conditional | — | Database password. Set for static-credential auth (local/CI). **Omit or leave empty** to activate managed-identity passwordless auth. See [Auth modes](#postgresql-auth-modes) below. |
| `POSTGRES_SSL_MODE` | no | managed-identity: `Require`; password: *(omitted)* | Npgsql `SslMode` override. Passed verbatim when set. Valid values (case-insensitive): `Disable`, `Allow`, `Prefer`, `Require`, `VerifyCA`, `VerifyFull`. See [Auth modes](#postgresql-auth-modes). |

## :material-shield-key-outline: PostgreSQL: auth modes { #postgresql-auth-modes }

Auth mode is **auto-detected from credential presence** — no explicit toggle.

| `POSTGRES_PASSWORD` | Mode | How it works |
|---|---|---|
| Set (non-empty) | Static password | `POSTGRES_USER` + `POSTGRES_PASSWORD` used verbatim. Default behavior; suitable for local Compose, CI, and tests. |
| Omitted / empty | Managed identity | No static password. The service authenticates as its ambient cloud identity (e.g. Azure Workload Identity / Managed Identity) and obtains a short-lived access token at connection time, refreshed transparently. Set `POSTGRES_USER` to the identity's PostgreSQL role name. |

**SSL mode.** Precedence: `POSTGRES_SSL_MODE` env → `Postgres:SslMode` appsettings.

- **Unset, managed-identity mode:** `SslMode=Require` (Azure-managed PostgreSQL enforces TLS; explicit opt-out requires `POSTGRES_SSL_MODE=Disable`).
- **Unset, static-password mode:** `SslMode` omitted (local/bundled non-SSL container unchanged).
- **Set:** value passed verbatim to Npgsql regardless of auth mode.

!!! tip "Cloud deployment — Azure target (NFR-01 / NFR-06)"
    Omit `POSTGRES_PASSWORD` to eliminate static credential management. The seam is provider-agnostic; any identity system that supplies a bearer token to the Npgsql password provider is compatible.
