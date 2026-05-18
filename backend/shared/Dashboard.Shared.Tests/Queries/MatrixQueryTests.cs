using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Queries;
using Dashboard.Shared.Tests.Persistence;
using Dashboard.Shared.Topology;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Shared.Tests.Queries;

/// <summary>
/// Contract tests for the matrix derivation logic. These cover every one
/// of the six box states defined in <c>docs/ui/deployment-dashboard.html</c>
/// SERVICES block — they are the wire-contract proof.
/// </summary>
public sealed class MatrixQueryTests
{
    // ---------- Helpers --------------------------------------------------

    private static int _nextDeploymentId;

    private static DeploymentEntity Evt(
        string service,
        string env,
        string version,
        string status,
        DateTime deployedAt,
        long runNumber = 1,
        string actor = "tester",
        string runUrl = "https://ci.example.com/runs/1",
        string? deploymentId = null)
        => new()
        {
            DeploymentId = deploymentId ?? $"d-{Interlocked.Increment(ref _nextDeploymentId)}",
            Service = service,
            Environment = env,
            Version = version,
            Status = status,
            RunUrl = runUrl,
            RunNumber = runNumber,
            Actor = actor,
            DeployedAt = DateTime.SpecifyKind(deployedAt, DateTimeKind.Utc),
        };

    private static TopologyBuilder NewTopologyBuilder() =>
        new(NullLogger<TopologyBuilder>.Instance);

    private static Task<string> AlwaysVersion(string _) =>
        Task.FromResult(CorrelationAttribute.Version);

    private static MatrixSlot SlotFor(
        IEnumerable<DeploymentEntity> events,
        string service,
        string env)
    {
        // Caller may supply events in any order; matrix derivation expects
        // newest-first, so we sort here to keep test fixtures readable.
        var ordered = events.OrderByDescending(e => e.DeployedAt).ThenByDescending(e => e.Id);
        var matrix = MatrixQuery.BuildFromEvents(ordered);
        Assert.True(matrix.ContainsKey(service), $"matrix is missing service '{service}'");
        Assert.True(matrix[service].ContainsKey(env), $"slot ({service},{env}) is missing");
        return matrix[service][env];
    }

    // ---------- State 1: Success ----------------------------------------

    [Fact]
    public void State1_Success_CurrentIsLastEvent_LastSuccessfulIsNull()
    {
        // Mockup: auth-service/dev — single successful deploy.
        var events = new[]
        {
            Evt("auth-service", "dev", "v1.8.0", DeploymentStatus.Success, new DateTime(2026, 5, 14, 11, 45, 0)),
            Evt("auth-service", "dev", "v1.7.9", DeploymentStatus.Success, new DateTime(2026, 5, 12,  9,  0, 0)),
        };

        var slot = SlotFor(events, "auth-service", "dev");

        Assert.Equal("v1.8.0", slot.Current.Version);
        Assert.Equal(DeploymentStatus.Success, slot.Current.Status);
        // lastSuccessful is null when current is itself a success.
        Assert.Null(slot.LastSuccessful);
        Assert.False(slot.PreviousFailed);
    }

    // ---------- State 2: Running + Last Successful ----------------------

    [Fact]
    public void State2_RunningOverSuccess_LastSuccessfulIsPriorSuccess_PreviousFailedFalse()
    {
        // Mockup: web-portal/dev — current in-progress, prior success exists.
        var events = new[]
        {
            Evt("web-portal", "dev", "v2.3.2", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 14, 34, 0)),
            Evt("web-portal", "dev", "v2.3.1", DeploymentStatus.Success,    new DateTime(2026, 5, 14, 12, 30, 0)),
            Evt("web-portal", "dev", "v2.3.0", DeploymentStatus.Failure,    new DateTime(2026, 5, 14, 11, 50, 0)),
            Evt("web-portal", "dev", "v2.2.9", DeploymentStatus.Success,    new DateTime(2026, 5, 12, 15, 20, 0)),
        };

        var slot = SlotFor(events, "web-portal", "dev");

        Assert.Equal("v2.3.2", slot.Current.Version);
        Assert.Equal(DeploymentStatus.InProgress, slot.Current.Status);
        Assert.NotNull(slot.LastSuccessful);
        Assert.Equal("v2.3.1", slot.LastSuccessful!.Version);
        // Most recent terminal is a success, so previousFailed must be false.
        Assert.False(slot.PreviousFailed);
    }

    // ---------- State 3: Running + Failed + Last Successful -------------

    [Fact]
    public void State3_RunningAfterFailure_PreviousFailedTrue_LastSuccessfulFromOlderHistory()
    {
        // Mockup: order-api/dev — current in-progress, prior was a failure,
        // an older success exists.
        var events = new[]
        {
            Evt("order-api", "dev", "v3.1.2", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 14, 35, 0)),
            Evt("order-api", "dev", "v3.1.1", DeploymentStatus.Failure,    new DateTime(2026, 5, 14, 13,  0, 0)),
            Evt("order-api", "dev", "v3.1.0", DeploymentStatus.Success,    new DateTime(2026, 5, 12, 11,  0, 0)),
        };

        var slot = SlotFor(events, "order-api", "dev");

        Assert.Equal("v3.1.2", slot.Current.Version);
        Assert.Equal(DeploymentStatus.InProgress, slot.Current.Status);
        Assert.True(slot.PreviousFailed);
        Assert.NotNull(slot.LastSuccessful);
        Assert.Equal("v3.1.0", slot.LastSuccessful!.Version);
    }

    // ---------- State 4: Failed + Last Successful -----------------------

    [Fact]
    public void State4_FailureOverSuccess_LastSuccessfulIsPriorSuccess_PreviousFailedFalse()
    {
        // Mockup: auth-service/qa — current is a failure with an older success.
        var events = new[]
        {
            Evt("auth-service", "qa", "v1.7.9", DeploymentStatus.Failure, new DateTime(2026, 5, 12, 14, 0, 0)),
            Evt("auth-service", "qa", "v1.7.8", DeploymentStatus.Success, new DateTime(2026, 5,  9, 12, 0, 0)),
        };

        var slot = SlotFor(events, "auth-service", "qa");

        Assert.Equal("v1.7.9", slot.Current.Version);
        Assert.Equal(DeploymentStatus.Failure, slot.Current.Status);
        Assert.NotNull(slot.LastSuccessful);
        Assert.Equal("v1.7.8", slot.LastSuccessful!.Version);
        // previousFailed is reserved for in-progress only; failure-current
        // already communicates failure on its own.
        Assert.False(slot.PreviousFailed);
    }

    // ---------- State 5: Running (first deploy, no history) -------------

    [Fact]
    public void State5_RunningNoHistory_LastSuccessfulNull_PreviousFailedFalse()
    {
        // Mockup: notifications-worker/uat — only a single in-progress event ever.
        var events = new[]
        {
            Evt("notifications-worker", "uat", "v4.0.4", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 14, 36, 0)),
        };

        var slot = SlotFor(events, "notifications-worker", "uat");

        Assert.Equal(DeploymentStatus.InProgress, slot.Current.Status);
        Assert.Null(slot.LastSuccessful);
        Assert.False(slot.PreviousFailed);
    }

    // ---------- State 6: Running + Failed (no successful history) -------

    [Fact]
    public void State6_RunningOverFailureOnly_PreviousFailedTrue_LastSuccessfulNull()
    {
        // Mockup: notifications-worker/dev — current in-progress; only prior events are
        // failures; no success has ever happened.
        var events = new[]
        {
            Evt("notifications-worker", "dev", "v4.0.3", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 14, 33, 0)),
            Evt("notifications-worker", "dev", "v4.0.2", DeploymentStatus.Failure,    new DateTime(2026, 5, 14, 12,  0, 0)),
            Evt("notifications-worker", "dev", "v4.0.1", DeploymentStatus.Failure,    new DateTime(2026, 5, 13, 16,  0, 0)),
        };

        var slot = SlotFor(events, "notifications-worker", "dev");

        Assert.Equal(DeploymentStatus.InProgress, slot.Current.Status);
        Assert.True(slot.PreviousFailed);
        // No successful history exists → lastSuccessful must be null even
        // though previousFailed is true.
        Assert.Null(slot.LastSuccessful);
    }

    // ---------- Additional contract guards ------------------------------

    [Fact]
    public void LatestEventWinsRegardlessOfStatus_FailedOverSuccess()
    {
        // Decision §10 #3: failures replace the previous matrix entry.
        var events = new[]
        {
            Evt("svc", "dev", "v2", DeploymentStatus.Failure, new DateTime(2026, 5, 14, 10, 0, 0)),
            Evt("svc", "dev", "v1", DeploymentStatus.Success, new DateTime(2026, 5, 13, 10, 0, 0)),
        };

        var slot = SlotFor(events, "svc", "dev");

        Assert.Equal("v2", slot.Current.Version);
        Assert.Equal(DeploymentStatus.Failure, slot.Current.Status);
        Assert.NotNull(slot.LastSuccessful);
        Assert.Equal("v1", slot.LastSuccessful!.Version);
    }

    [Fact]
    public void Matrix_Builds_OneSlot_PerServiceEnvironmentPair()
    {
        var events = new[]
        {
            Evt("a", "dev",  "1", DeploymentStatus.Success, new DateTime(2026, 5, 14, 10, 0, 0)),
            Evt("a", "prod", "1", DeploymentStatus.Success, new DateTime(2026, 5, 14, 11, 0, 0)),
            Evt("b", "dev",  "1", DeploymentStatus.Success, new DateTime(2026, 5, 14, 12, 0, 0)),
        };

        var matrix = MatrixQuery.BuildFromEvents(events.OrderByDescending(e => e.DeployedAt));

        Assert.Equal(2, matrix.Count);
        Assert.True(matrix["a"].ContainsKey("dev"));
        Assert.True(matrix["a"].ContainsKey("prod"));
        Assert.True(matrix["b"].ContainsKey("dev"));
    }

    [Fact]
    public async Task MatrixQuery_BuildAsync_UsesDbContextAndReturnsCorrectMatrix()
    {
        // Round-trip the SQLite path so the EF query is exercised too.
        using var harness = InMemorySqliteContext.Create();
        var db = harness.Context;

        db.Deployments.Add(Evt("svc", "dev", "v2", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 14, 0, 0)));
        db.Deployments.Add(Evt("svc", "dev", "v1", DeploymentStatus.Success, new DateTime(2026, 5, 13, 14, 0, 0)));
        await db.SaveChangesAsync();

        var matrix = await MatrixQuery.BuildAsync(db, NewTopologyBuilder(), AlwaysVersion);

        var slot = matrix["svc"].Envs["dev"];
        Assert.Equal("v2", slot.Current.Version);
        Assert.Equal("v1", slot.LastSuccessful!.Version);
        Assert.False(slot.PreviousFailed);
    }

    [Fact]
    public async Task MatrixQuery_BuildSlotAsync_ReturnsSameShapeAsMatrixForOneSlot()
    {
        // The SSE listener uses BuildSlotAsync to derive the wrapped payload
        // on every NOTIFY. The per-slot shape must equal what BuildAsync
        // would project for that same (service, environment) — otherwise the
        // SSE wire view and the REST wire view diverge.
        using var harness = InMemorySqliteContext.Create();
        var db = harness.Context;

        db.Deployments.Add(Evt("svc", "dev", "v3", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 15, 0, 0)));
        db.Deployments.Add(Evt("svc", "dev", "v2", DeploymentStatus.Failure, new DateTime(2026, 5, 14, 14, 0, 0)));
        db.Deployments.Add(Evt("svc", "dev", "v1", DeploymentStatus.Success, new DateTime(2026, 5, 13, 14, 0, 0)));
        // Unrelated slot — must not leak into the per-slot result.
        db.Deployments.Add(Evt("svc", "qa", "vq", DeploymentStatus.Success, new DateTime(2026, 5, 13, 14, 0, 0)));
        await db.SaveChangesAsync();

        var (slot, _) = await MatrixQuery.BuildSlotAsync(
            db, "svc", "dev", NewTopologyBuilder(), CorrelationAttribute.Version);

        Assert.NotNull(slot);
        Assert.Equal("v3", slot!.Current.Version);
        Assert.Equal(DeploymentStatus.InProgress, slot.Current.Status);
        Assert.True(slot.PreviousFailed);
        Assert.Equal("v1", slot.LastSuccessful!.Version);
    }

    [Fact]
    public async Task MatrixQuery_BuildSlotAsync_ReturnsNullWhenSlotHasNoHistory()
    {
        using var harness = InMemorySqliteContext.Create();
        var db = harness.Context;

        var (slot, topology) = await MatrixQuery.BuildSlotAsync(
            db, "missing", "dev", NewTopologyBuilder(), CorrelationAttribute.Version);

        Assert.Null(slot);
        Assert.Empty(topology.Edges);
    }
}
