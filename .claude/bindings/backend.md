# Backend — project binding

> Project stack, file lanes, and gate commands for the **backend** role (`backend-developer`).
> Generic role: [`../team-process/roles/backend.md`](../team-process/roles/backend.md). Shared tool-output-economy guardrail: `CLAUDE.md` § *Project bindings*.

- **Stack:** .NET 10 (`net10.0`, C#), EF Core, xUnit. Solution `backend/Dashboard.slnx`.
- **Lanes:** `backend/<service>/**` (services: `api`, `control-api`, `read-api`, `write-api`, `fetcher`, `fetcher-github`, `fetcher-host`, `shared`).
- **Gates** (run from `backend/`; mirror `.github/workflows/api.yml`):
  - Format — `dotnet format whitespace Dashboard.slnx --verify-no-changes` + `dotnet format style Dashboard.slnx --verify-no-changes` (analyzers run in Build, not format).
  - Build — `dotnet build Dashboard.slnx -c Release --nologo -v q -p:EnableStructuralAnalyzers=true`. Structural analyzers (SonarAnalyzer, Gate B; `backend/.editorconfig` + `Directory.Build.props`) are **opt-in** via that flag (off in Docker publishes so image builds stay fast); they surface as warnings — flip the rules to `error` once the backlog clears.
  - Test — `dotnet test Dashboard.slnx --settings Dashboard.runsettings --nologo -c Release` → on fail `… 2>&1 | Select-String 'error|\bFailed\b|\[xUnit'`
- **Config:** flat `SCREAMING_SNAKE` env vars (appsettings base + `*OptionsEnv` override); never `Section__Property`. Env files gitignored; no secrets in code/logs.
