using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Realtime;
using Dashboard.Shared.Security;
using Dashboard.Shared.Validation;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.WriteApi;

/// <summary>
/// Entry point for the Write API. Owns:
///   - POST /api/deployments    — insert event, 201 Created
///   - GET  /health             — liveness probe with DB ping
///   - X-Api-Key middleware     — every write requires the configured key
///   - PostgreSQL NOTIFY        — emitted after the insert commits
///
/// Stateless: no in-memory state held between requests.
/// </summary>
public sealed class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // ---- Configuration ------------------------------------------------
        // Standard ASP.NET Core pulls ConnectionStrings:DefaultConnection
        // from environment (ConnectionStrings__DefaultConnection) and from
        // appsettings.json out of the box.
        var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection (env ConnectionStrings__DefaultConnection) is required.");

        var apiKey = Environment.GetEnvironmentVariable("API_TOKEN")
            ?? builder.Configuration["API_TOKEN"]
            ?? string.Empty;

        // ---- Services -----------------------------------------------------
        builder.Services.AddDbContext<DashboardDbContext>(opt =>
            opt.UseNpgsql(connectionString, npg =>
                npg.MigrationsAssembly(typeof(DashboardDbContext).Assembly.FullName)));

        builder.Services.AddSingleton(new ApiKeyOptions { ApiKey = apiKey });

        builder.Services.AddSingleton(sp => new DeploymentNotifier(
            connectionString,
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<DeploymentNotifier>()));

        // Use snake_case across the wire by default; per-DTO JsonPropertyName
        // attributes still win for keys that must stay camelCase
        // (lastSuccessful, previousFailed).
        builder.Services.Configure<JsonOptions>(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = DashboardJson.Options.PropertyNamingPolicy;
        });

        var app = builder.Build();

        // ---- Pipeline -----------------------------------------------------
        // Health is unauthenticated by design so external orchestrators
        // (ACA, Docker Compose, k8s) can probe without the API key.
        MapHealth(app);

        // Everything from here on is gated by the API-key middleware.
        app.UseWhen(
            ctx => ctx.Request.Path.StartsWithSegments("/api"),
            sub => sub.UseApiKeyAuth(app.Services.GetRequiredService<ApiKeyOptions>()));

        MapDeployments(app);

        app.Run();
    }

    private static void MapHealth(WebApplication app)
    {
        app.MapGet("/health", async (DashboardDbContext db, CancellationToken ct) =>
        {
            // SELECT 1 confirms the DB is reachable. EF Core's ExecuteSqlAsync
            // works against both Postgres and SQLite which keeps tests honest.
            await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
            return Results.Ok(new { status = "ok" });
        });
    }

    private static void MapDeployments(WebApplication app)
    {
        app.MapPost("/api/deployments", async (
            DeploymentEventRequest request,
            DashboardDbContext db,
            DeploymentNotifier notifier,
            CancellationToken ct) =>
        {
            // SAD §7 "POST /api/deployments validation" — failure modes
            // (handled in this fixed order so a payload-shape failure does
            // not require a DB round-trip):
            //
            //   1. Missing or empty deployment_id         -> 422
            //   2. Any other Data Annotations failure     -> 422
            //   3. parent_deployments[i] cross-service    -> 400
            //   4. Duplicate (service, deployment_id)     -> 409
            //   5. parent_deployments[i] forms a cycle    -> 400
            //   6. Dangling reference (parent not yet
            //      ingested)                              -> accepted (201)

            // (1) + (2) — Data Annotations cover deployment_id required +
            // every other rule on the payload shape.
            var (isValid, errors) = DataAnnotationsValidator.Validate(request);
            if (!isValid)
            {
                return Results.ValidationProblem(
                    errors, statusCode: StatusCodes.Status422UnprocessableEntity);
            }

            // Normalise parent_deployments to a non-null list for the rest
            // of the handler.
            var parents = request.ParentDeployments?.Where(p => !string.IsNullOrWhiteSpace(p)).ToList()
                          ?? new List<string>();

            // (3) cross-service parent — a parent_deployment id that exists
            // but belongs to a different service is rejected.
            if (parents.Count > 0)
            {
                var existing = await db.Deployments
                    .AsNoTracking()
                    .Where(d => parents.Contains(d.DeploymentId))
                    .Select(d => new { d.DeploymentId, d.Service, d.Environment })
                    .ToListAsync(ct);

                var crossService = existing
                    .Where(d => !string.Equals(d.Service, request.Service, StringComparison.Ordinal))
                    .Select(d => d.DeploymentId)
                    .ToList();

                if (crossService.Count > 0)
                {
                    return Results.BadRequest(new
                    {
                        error = "cross_service_parent_reference",
                        message = "parent_deployments references must point to deployments in the same service.",
                        offending = crossService,
                    });
                }

                // (5) cycle — would the new deployment, given the already-
                // resolved subgraph, create a directed cycle through
                // resolved nodes? Dangling references are excluded by
                // construction (we walk via the resolved rows only).
                if (await WouldFormCycleAsync(db, request, parents, ct))
                {
                    return Results.BadRequest(new
                    {
                        error = "topology_cycle",
                        message = "parent_deployments would form a cycle through already-ingested deployments.",
                    });
                }
            }

            // (4) duplicate (service, deployment_id) — fast pre-check so we
            // can return a clean 409 with the existing id instead of letting
            // the unique-index throw surface as 500.
            var existingDuplicate = await db.Deployments
                .AsNoTracking()
                .Where(d => d.Service == request.Service && d.DeploymentId == request.DeploymentId)
                .Select(d => new { d.Id, d.DeploymentId })
                .FirstOrDefaultAsync(ct);

            if (existingDuplicate is not null)
            {
                return Results.Conflict(new
                {
                    error = "duplicate_deployment_id",
                    message = $"A deployment with id '{request.DeploymentId}' already exists for service '{request.Service}'.",
                    existing_id = existingDuplicate.Id,
                    deployment_id = existingDuplicate.DeploymentId,
                });
            }

            var entity = new DeploymentEntity
            {
                DeploymentId = request.DeploymentId,
                Service = request.Service,
                Environment = request.Environment,
                Version = request.Version,
                Status = request.Status,
                RunUrl = request.RunUrl,
                RunNumber = request.RunNumber,
                Actor = request.Actor,
                DeployedAt = DateTime.UtcNow,
                ParentDeployments = parents,
                // FR-05 + SAD §10 Decision 10: persist verbatim — no
                // trimming, no length truncation, no format check. Absent /
                // null on the wire are equivalent and both materialise as
                // null in storage.
                Ref = request.Ref,
                Sha = request.Sha,
            };

            db.Deployments.Add(entity);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
            {
                // Race: another writer beat us between the pre-check and the
                // insert. Return 409 to preserve the contract.
                return Results.Conflict(new
                {
                    error = "duplicate_deployment_id",
                    message = $"A deployment with id '{request.DeploymentId}' already exists for service '{request.Service}'.",
                });
            }

            var response = DeploymentEventResponse.FromEntity(entity);

            // NOTIFY only AFTER the row is committed; if NOTIFY itself fails
            // the notifier swallows the exception so the client still gets
            // 201. SSE listeners pick up the change on their next reconnect.
            await notifier.PublishAsync(response, ct);

            return Results.Created($"/api/deployments/{entity.Service}/{entity.Environment}", response);
        });
    }

    /// <summary>
    /// Returns <c>true</c> iff inserting the deployment described by
    /// <paramref name="request"/> with <paramref name="parents"/> would
    /// produce a directed cycle in the <em>environment</em> graph of the
    /// service, considering only references that resolve to already-ingested
    /// deployments (plus the new deployment itself, so an existing dangling
    /// reference that closes a cycle on resolution is still caught).
    ///
    /// <para>The topology DAG surfaced to the SPA is over <em>environments</em>
    /// (see <see cref="TopologyBuilder"/> and SAD §5 "Topology Derivation" —
    /// each emitted edge is <c>parent.environment → child.environment</c>),
    /// so cycle prevention must run on the same graph. Self-edges in the env
    /// graph (parent and child in the same environment) are no-ops on the
    /// read side; here they are treated as cycles only when caused by a
    /// deployment-id self-reference — a row naming itself as its own parent
    /// is semantically broken regardless of env.</para>
    ///
    /// <para>Dangling parents (a referenced <c>deployment_id</c> that has not
    /// yet been ingested and is not the row being inserted) are excluded —
    /// the SAD explicitly excludes them from the write-time check; the
    /// read-side defensive cycle drop catches any cycle that forms when the
    /// dangling source eventually lands.</para>
    /// </summary>
    private static async Task<bool> WouldFormCycleAsync(
        DashboardDbContext db,
        DeploymentEventRequest request,
        IReadOnlyList<string> parents,
        CancellationToken ct)
    {
        // Self-reference by deployment_id is invalid regardless of env.
        // Caught here before any DB work so it short-circuits the cheapest
        // path; also keeps the env-graph builder below cleanly focused on
        // resolved cross-row edges.
        foreach (var p in parents)
        {
            if (string.Equals(p, request.DeploymentId, StringComparison.Ordinal))
            {
                return true;
            }
        }

        // Pull the full deployment set for this service. The matrix is
        // bounded by service x environment, so even with a year of history
        // this is a few thousand rows in the worst case — far cheaper than
        // executing recursive SQL across two providers (Postgres + SQLite).
        var rows = await db.Deployments
            .AsNoTracking()
            .Where(d => d.Service == request.Service)
            .Select(d => new { d.DeploymentId, d.Environment, d.ParentDeployments })
            .ToListAsync(ct);

        // Map deployment_id -> environment. Include the new deployment so
        // an existing dangling reference TO request.DeploymentId becomes
        // resolved for the purpose of the check (cycle case: B inserted
        // first with parent A — held as dangling, no edge — then A inserted
        // with parent B; on A's insert we must see both directions to detect
        // the closing cycle).
        var idToEnv = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            if (!string.IsNullOrEmpty(r.DeploymentId))
            {
                idToEnv[r.DeploymentId] = r.Environment;
            }
        }
        idToEnv[request.DeploymentId] = request.Environment;

        // Build the env-graph adjacency from every resolved parent reference
        // already stored. Skip self-edges per the read-side builder
        // (TopologyBuilder.Build pass 2): they produce no edge on the read
        // side, so they cannot contribute to a cycle on the write side
        // either.
        var adjacency = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var r in rows)
        {
            if (r.ParentDeployments is not { Count: > 0 }) continue;
            foreach (var parentId in r.ParentDeployments)
            {
                if (string.IsNullOrEmpty(parentId)) continue;
                if (!idToEnv.TryGetValue(parentId, out var parentEnv)) continue; // dangling
                if (string.Equals(parentEnv, r.Environment, StringComparison.Ordinal)) continue;
                AddEdge(adjacency, parentEnv, r.Environment);
            }
        }

        // Probe each hypothetical edge introduced by this POST against the
        // accumulated graph (one edge per resolved parent). Probe-then-add:
        // a single POST could itself bring two parents whose envs would
        // close a cycle once both edges are present, so we check each in
        // turn against the running graph.
        foreach (var parentId in parents)
        {
            if (!idToEnv.TryGetValue(parentId, out var parentEnv)) continue; // dangling
            if (string.Equals(parentEnv, request.Environment, StringComparison.Ordinal))
            {
                // Self-edge in the env graph: emitted as a no-op on the read
                // side, so do not treat as a cycle here either.
                continue;
            }

            if (WouldCloseCycle(adjacency, parentEnv, request.Environment))
            {
                return true;
            }

            AddEdge(adjacency, parentEnv, request.Environment);
        }

        return false;
    }

    private static void AddEdge(
        Dictionary<string, HashSet<string>> adjacency,
        string from,
        string to)
    {
        if (!adjacency.TryGetValue(from, out var children))
        {
            children = new HashSet<string>(StringComparer.Ordinal);
            adjacency[from] = children;
        }
        children.Add(to);
    }

    /// <summary>
    /// A new edge <c>from → to</c> would close a directed cycle iff the
    /// graph already contains a path <c>to → … → from</c>. BFS from
    /// <paramref name="to"/> looking for <paramref name="from"/>.
    /// </summary>
    private static bool WouldCloseCycle(
        IReadOnlyDictionary<string, HashSet<string>> adjacency,
        string from,
        string to)
    {
        if (!adjacency.ContainsKey(to)) return false;

        var visited = new HashSet<string>(StringComparer.Ordinal) { to };
        var queue = new Queue<string>();
        queue.Enqueue(to);

        while (queue.Count > 0)
        {
            var node = queue.Dequeue();
            if (!adjacency.TryGetValue(node, out var children)) continue;
            foreach (var child in children)
            {
                if (string.Equals(child, from, StringComparison.Ordinal)) return true;
                if (visited.Add(child)) queue.Enqueue(child);
            }
        }

        return false;
    }

    /// <summary>
    /// Best-effort detection of "unique index violated" without coupling to
    /// the underlying provider. Both Npgsql and SQLite throw
    /// <see cref="DbUpdateException"/> wrapping a provider-specific exception
    /// whose message mentions the index name.
    /// </summary>
    private static bool IsUniqueConstraintViolation(DbUpdateException ex)
    {
        var msg = ex.GetBaseException().Message ?? string.Empty;
        return msg.Contains("ux_deployments_service_deployment_id", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("unique", StringComparison.OrdinalIgnoreCase);
    }
}
