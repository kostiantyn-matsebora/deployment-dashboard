using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Topology;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Shared.Tests.Topology;

/// <summary>
/// Contract tests for the 5-pass topology derivation algorithm from
/// SAD §5 "Topology Derivation". One test per documented pass, plus
/// per-service-override and cycle-drop guards.
/// </summary>
public sealed class TopologyBuilderTests
{
    private static TopologyBuilder NewBuilder() =>
        new(NullLogger<TopologyBuilder>.Instance);

    private static DeploymentEntity D(
        string deploymentId,
        string env,
        string version,
        DateTime deployedAt,
        string service = "svc",
        string actor = "tester",
        long runNumber = 1,
        IReadOnlyList<string>? parents = null) => new()
        {
            DeploymentId = deploymentId,
            Service = service,
            Environment = env,
            Version = version,
            Status = DeploymentStatus.Success,
            RunUrl = "https://example.com/runs/1",
            RunNumber = runNumber,
            Actor = actor,
            DeployedAt = DateTime.SpecifyKind(deployedAt, DateTimeKind.Utc),
            ParentDeployments = parents?.ToList() ?? new List<string>(),
        };

    [Fact]
    public void Pass2_ExplicitOnly_EmitsEdgesWithSourceExplicit()
    {
        // SAD pass 2: explicit-first emits edges with source: "explicit".
        var deployments = new[]
        {
            D("p", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)),
            D("q", "qa",  "v1", new DateTime(2026, 5, 14, 11, 0, 0), parents: new[] { "p" }),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        var edge = Assert.Single(topology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceExplicit, edge.Source);
    }

    [Fact]
    public void Pass3_CorrelationOnly_MatchesByVersion_ClosestInTimePerEnvWins()
    {
        // SAD pass 3: deployments without parent_deployments fall back to
        // correlation; closest-in-time per parent env wins.
        var deployments = new[]
        {
            // Older dev success — should be ignored when a newer dev success exists.
            D("dev-old", "dev", "v9", new DateTime(2026, 5, 14, 8, 0, 0)),
            D("dev-new", "dev", "v9", new DateTime(2026, 5, 14, 9, 0, 0)),
            // qa picks up the closest-prior dev with version v9.
            D("qa",      "qa",  "v9", new DateTime(2026, 5, 14, 10, 0, 0)),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        var edge = Assert.Single(topology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceCorrelated, edge.Source);
    }

    [Fact]
    public void Pass3_Correlation_SkipsDeploymentsWithExplicitParents()
    {
        // SAD pass 3 opening clause: "For each deployment D *without*
        // parent_deployments". Deployments with explicit parents do not
        // contribute correlation edges.
        var deployments = new[]
        {
            D("p", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)),
            // qa-1 has an explicit parent; correlation pass must not also
            // produce a correlated edge for the same version.
            D("q", "qa",  "v1", new DateTime(2026, 5, 14, 11, 0, 0), parents: new[] { "p" }),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        var edge = Assert.Single(topology.Edges);
        Assert.Equal(TopologyEdge.SourceExplicit, edge.Source);
    }

    [Fact]
    public void Pass4_Mixed_ExplicitWinsOverCorrelatedOnSameFromTo()
    {
        // SAD pass 4 merge rule: same (from, to) -> "explicit" wins so the
        // SPA can render explicit edges distinctly.
        var deployments = new[]
        {
            D("p", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)),
            // Two children both pointing dev -> qa: one explicit, one not.
            D("q1", "qa", "v1", new DateTime(2026, 5, 14, 11, 0, 0), parents: new[] { "p" }),
            D("q2", "qa", "v1", new DateTime(2026, 5, 14, 12, 0, 0)),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        var edge = Assert.Single(topology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceExplicit, edge.Source);
    }

    [Fact]
    public void Pass5_Dangling_ContributesNoEdge_UntilSourceLands()
    {
        // SAD pass 5: dangling references contribute no edge in this read.
        // We model "next read after the missing source lands" by building
        // twice — once before, once after the source row is added.
        var withoutSource = new[]
        {
            D("q", "qa", "v1", new DateTime(2026, 5, 14, 11, 0, 0), parents: new[] { "p-missing" }),
        };
        var beforeTopology = NewBuilder().Build("svc", withoutSource, CorrelationAttribute.Version);
        Assert.Empty(beforeTopology.Edges);

        // Now the source row lands.
        var afterIngest = new[]
        {
            D("p-missing", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)),
            D("q",         "qa",  "v1", new DateTime(2026, 5, 14, 11, 0, 0), parents: new[] { "p-missing" }),
        };
        var afterTopology = NewBuilder().Build("svc", afterIngest, CorrelationAttribute.Version);
        var edge = Assert.Single(afterTopology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceExplicit, edge.Source);
    }

    [Fact]
    public void CycleDetected_IsDroppedDefensively()
    {
        // SAD "Cycle handling at read time": defensive topological sort
        // drops any edge that would close a cycle. We construct A -> B
        // and B -> A explicitly; one of the two must be dropped.
        var deployments = new[]
        {
            D("a", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0), parents: new[] { "b" }),
            D("b", "qa",  "v1", new DateTime(2026, 5, 14, 11, 0, 0), parents: new[] { "a" }),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        // Exactly one of the two opposing edges survives the cycle drop.
        Assert.Single(topology.Edges);
    }

    [Fact]
    public void SelfEdge_IsSkippedInExplicitPass()
    {
        // SAD pass 2: "Skip self-edges (P.environment === D.environment)".
        var deployments = new[]
        {
            D("p", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)),
            D("q", "dev", "v2", new DateTime(2026, 5, 14, 11, 0, 0), parents: new[] { "p" }),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        Assert.Empty(topology.Edges);
    }

    [Fact]
    public void Correlation_UsesPerServiceAttribute_WhenProvidedAtBuildTime()
    {
        // Per-service override: the caller resolves the attribute and
        // passes it to Build(); here we simulate `service-a` -> `actor`.
        var deployments = new[]
        {
            D("p", "dev", "v9", new DateTime(2026, 5, 14, 10, 0, 0), actor: "ada"),
            // Different version, but same actor — must still match under
            // CorrelationAttribute.Actor.
            D("q", "qa",  "v1", new DateTime(2026, 5, 14, 11, 0, 0), actor: "ada"),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Actor);

        var edge = Assert.Single(topology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceCorrelated, edge.Source);
    }

    [Fact]
    public void EmptyTopology_WhenNoExplicitNorCorrelatedMatches()
    {
        // Service has deployments but no chain — every env is a root.
        var deployments = new[]
        {
            D("a", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)),
            D("b", "qa",  "v2", new DateTime(2026, 5, 14, 11, 0, 0)),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        Assert.Empty(topology.Edges);
    }

    [Fact]
    public void UnsupportedCorrelationAttribute_ProducesNoCorrelatedEdges()
    {
        // SAD §7 lists `ago` among allowed names but its semantics are not
        // yet defined; the resolver returns the sentinel for every row, so
        // no correlation edges form.
        var deployments = new[]
        {
            D("p", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)),
            D("q", "qa",  "v1", new DateTime(2026, 5, 14, 11, 0, 0)),
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Ago);

        Assert.Empty(topology.Edges);
    }

    [Fact]
    public void Correlation_MatchesByRef_WhenRefIsPopulatedOnBothRows()
    {
        // FR-05: ref is now a real column on the entity. With
        // correlationAttribute=ref, two rows in different envs sharing the
        // same ref value form a correlated edge.
        var deployments = new[]
        {
            new DeploymentEntity
            {
                DeploymentId = "p", Service = "svc", Environment = "dev",
                Version = "v9", Status = DeploymentStatus.Success,
                RunUrl = "https://example.com/runs/1", RunNumber = 1, Actor = "tester",
                DeployedAt = DateTime.SpecifyKind(new DateTime(2026, 5, 14, 10, 0, 0), DateTimeKind.Utc),
                Ref = "feature/login-revamp",
            },
            new DeploymentEntity
            {
                DeploymentId = "q", Service = "svc", Environment = "qa",
                Version = "v1", Status = DeploymentStatus.Success,
                RunUrl = "https://example.com/runs/2", RunNumber = 2, Actor = "tester",
                DeployedAt = DateTime.SpecifyKind(new DateTime(2026, 5, 14, 11, 0, 0), DateTimeKind.Utc),
                Ref = "feature/login-revamp",
            },
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Ref);

        var edge = Assert.Single(topology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceCorrelated, edge.Source);
    }

    [Fact]
    public void Correlation_MatchesBySha_WhenShaIsPopulatedOnBothRows()
    {
        // FR-05: sha is now a real column on the entity. With
        // correlationAttribute=sha, two rows in different envs sharing the
        // same sha form a correlated edge.
        var deployments = new[]
        {
            new DeploymentEntity
            {
                DeploymentId = "p", Service = "svc", Environment = "dev",
                Version = "v9", Status = DeploymentStatus.Success,
                RunUrl = "https://example.com/runs/1", RunNumber = 1, Actor = "tester",
                DeployedAt = DateTime.SpecifyKind(new DateTime(2026, 5, 14, 10, 0, 0), DateTimeKind.Utc),
                Sha = "9f1c0d2e8a",
            },
            new DeploymentEntity
            {
                DeploymentId = "q", Service = "svc", Environment = "qa",
                Version = "v1", Status = DeploymentStatus.Success,
                RunUrl = "https://example.com/runs/2", RunNumber = 2, Actor = "tester",
                DeployedAt = DateTime.SpecifyKind(new DateTime(2026, 5, 14, 11, 0, 0), DateTimeKind.Utc),
                Sha = "9f1c0d2e8a",
            },
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Sha);

        var edge = Assert.Single(topology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceCorrelated, edge.Source);
    }

    [Fact]
    public void Correlation_NullRef_ProducesNoEdge()
    {
        // FR-05: ref is nullable. A row with null ref must not silently
        // correlate to another row with null ref — the resolver returns the
        // sentinel, so the correlation pass emits no edge.
        var deployments = new[]
        {
            new DeploymentEntity
            {
                DeploymentId = "p", Service = "svc", Environment = "dev",
                Version = "v9", Status = DeploymentStatus.Success,
                RunUrl = "https://example.com/runs/1", RunNumber = 1, Actor = "tester",
                DeployedAt = DateTime.SpecifyKind(new DateTime(2026, 5, 14, 10, 0, 0), DateTimeKind.Utc),
                Ref = null,
            },
            new DeploymentEntity
            {
                DeploymentId = "q", Service = "svc", Environment = "qa",
                Version = "v9", Status = DeploymentStatus.Success,
                RunUrl = "https://example.com/runs/2", RunNumber = 2, Actor = "tester",
                DeployedAt = DateTime.SpecifyKind(new DateTime(2026, 5, 14, 11, 0, 0), DateTimeKind.Utc),
                Ref = null,
            },
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Ref);

        Assert.Empty(topology.Edges);
    }

    [Fact]
    public void CrossServiceDeployments_AreIgnored()
    {
        // Builder receives the full event list but is asked to compute a
        // DAG for one service only; rows from other services must not
        // contribute edges.
        var deployments = new[]
        {
            D("p", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0), service: "svc-a"),
            D("q", "qa",  "v1", new DateTime(2026, 5, 14, 11, 0, 0), service: "svc-b", parents: new[] { "p" }),
        };

        var topologyA = NewBuilder().Build("svc-a", deployments, CorrelationAttribute.Version);
        var topologyB = NewBuilder().Build("svc-b", deployments, CorrelationAttribute.Version);

        Assert.Empty(topologyA.Edges);
        // svc-b's explicit parent points to a deployment_id that belongs to
        // svc-a — it is "dangling" from svc-b's perspective (the builder
        // only looks up deployment_ids inside its own service), so no edge.
        Assert.Empty(topologyB.Edges);
    }

    [Fact]
    public void Pass3_ClosestInTime_BothSidesOnly_StrictlyPrior()
    {
        // SAD pass 3: "P.deployed_at < D.deployed_at" — equal timestamps
        // do not correlate, and a candidate older than the closest hit
        // does not produce a second edge.
        var deployments = new[]
        {
            D("dev1", "dev", "v1", new DateTime(2026, 5, 14, 8, 0, 0)),
            D("dev2", "dev", "v1", new DateTime(2026, 5, 14, 9, 0, 0)),
            D("qa",   "qa",  "v1", new DateTime(2026, 5, 14, 9, 0, 0)), // same time as dev2
        };

        var topology = NewBuilder().Build("svc", deployments, CorrelationAttribute.Version);

        // qa shares dev2's timestamp; the only strictly-prior candidate in
        // dev is dev1, so the edge dev -> qa is correlated to that.
        var edge = Assert.Single(topology.Edges);
        Assert.Equal("dev", edge.From);
        Assert.Equal("qa", edge.To);
        Assert.Equal(TopologyEdge.SourceCorrelated, edge.Source);
    }
}
