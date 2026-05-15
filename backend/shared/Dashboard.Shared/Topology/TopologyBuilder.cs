using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Microsoft.Extensions.Logging;

namespace Dashboard.Shared.Topology;

/// <summary>
/// Read-side per-service env DAG builder. Implements the 5-pass algorithm
/// from SAD §5 "Topology Derivation":
///
/// <list type="number">
///   <item>Bucket by env.</item>
///   <item>Explicit-first pass — resolve <c>parent_deployments</c> ids to
///   their source rows; emit one edge per resolved parent with
///   <c>source = "explicit"</c>. Skip self-edges and duplicate
///   <c>(from, to)</c> within the explicit pass.</item>
///   <item>Correlation fallback pass — for deployments without
///   <c>parent_deployments</c>, find candidate parents in other envs of the
///   same service whose correlation attribute matches and whose
///   <c>deployed_at</c> is strictly earlier; closest-in-time per parent env
///   wins.</item>
///   <item>Merge — union explicit + correlated edges; explicit wins on
///   <c>(from, to)</c> collisions.</item>
///   <item>Dangling references — references to a <c>deployment_id</c> not
///   yet ingested contribute no edge in this pass; the next read after the
///   missing source lands resolves them automatically.</item>
/// </list>
///
/// <para>Defensive read-side cycle drop runs after the merge — any edge
/// whose addition would close a directed cycle is dropped and logged at
/// <see cref="LogLevel.Warning"/> (SAD §5 "Cycle handling at read time").</para>
///
/// <para>Pure logic: this class owns no state beyond the
/// <see cref="ILogger"/>; callers pass the deployment list and the
/// (resolved) correlation attribute for the service. Database access is
/// the caller's concern so the same builder can be exercised from unit
/// tests with in-memory entities.</para>
/// </summary>
public sealed class TopologyBuilder
{
    private readonly ILogger<TopologyBuilder> _logger;

    public TopologyBuilder(ILogger<TopologyBuilder> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Build the per-service DAG. <paramref name="deployments"/> may be in
    /// any order — the builder sorts internally where ordering matters.
    /// </summary>
    public TopologySnapshot Build(
        string service,
        IReadOnlyList<DeploymentEntity> deployments,
        string correlationAttribute)
    {
        if (!CorrelationAttribute.IsAllowed(correlationAttribute))
        {
            // Defensive: a malformed override should not crash the read.
            // Drop back to the global default semantics (no correlation
            // edges) and log.
            _logger.LogWarning(
                "Topology builder for service '{Service}' received unsupported correlation attribute '{Attribute}'; correlation pass will produce no edges.",
                service, correlationAttribute);
        }

        // Pass 1 — bucket by env. We do not need the buckets explicitly
        // (the passes below iterate the full list and look up by env on
        // the fly), but we surface them via the helper map for clarity in
        // future passes (e.g. ordering within an env).
        var perDeploymentId = new Dictionary<string, DeploymentEntity>(StringComparer.Ordinal);
        foreach (var d in deployments)
        {
            if (d.Service != service) continue;
            if (string.IsNullOrEmpty(d.DeploymentId)) continue;
            // Last writer wins on duplicate deployment_id within the input.
            // The DB unique constraint makes this a defensive no-op.
            perDeploymentId[d.DeploymentId] = d;
        }

        // Pass 2 — explicit edges.
        var explicitEdges = new Dictionary<(string From, string To), TopologyEdge>();
        foreach (var d in deployments)
        {
            if (d.Service != service) continue;
            if (d.ParentDeployments is not { Count: > 0 }) continue;

            foreach (var parentId in d.ParentDeployments)
            {
                if (string.IsNullOrEmpty(parentId)) continue;
                if (!perDeploymentId.TryGetValue(parentId, out var parent))
                {
                    // Dangling — pass 5; contributes no edge this read.
                    continue;
                }
                if (string.Equals(parent.Environment, d.Environment, StringComparison.Ordinal))
                {
                    // Skip self-edges per SAD pass 2.
                    continue;
                }
                var key = (parent.Environment, d.Environment);
                if (!explicitEdges.ContainsKey(key))
                {
                    explicitEdges[key] = new TopologyEdge
                    {
                        From = parent.Environment,
                        To = d.Environment,
                        Source = TopologyEdge.SourceExplicit,
                    };
                }
            }
        }

        // Pass 3 — correlation fallback. Only fires for deployments whose
        // parent_deployments is null/empty (per SAD wording: "For each
        // deployment D *without* parent_deployments").
        var correlatedEdges = new Dictionary<(string From, string To), TopologyEdge>();
        if (CorrelationAttribute.IsAllowed(correlationAttribute))
        {
            // Materialise once for the inner candidate loop.
            var serviceDeployments = deployments
                .Where(x => x.Service == service)
                .ToList();

            foreach (var d in serviceDeployments)
            {
                if (d.ParentDeployments is { Count: > 0 }) continue;

                var dValue = CorrelationAttribute.Resolve(d, correlationAttribute);
                if (string.Equals(dValue, CorrelationAttribute.UnresolvableValue, StringComparison.Ordinal))
                {
                    continue;
                }

                // For each candidate parent env, keep only the candidate
                // with the greatest deployed_at strictly less than D's
                // deployed_at (SAD pass 3 "closest in time").
                var bestPerEnv = new Dictionary<string, DeploymentEntity>(StringComparer.Ordinal);
                foreach (var p in serviceDeployments)
                {
                    if (ReferenceEquals(p, d)) continue;
                    if (string.Equals(p.Environment, d.Environment, StringComparison.Ordinal)) continue;
                    if (p.DeployedAt >= d.DeployedAt) continue;

                    var pValue = CorrelationAttribute.Resolve(p, correlationAttribute);
                    if (!string.Equals(pValue, dValue, StringComparison.Ordinal)) continue;

                    if (!bestPerEnv.TryGetValue(p.Environment, out var current) ||
                        p.DeployedAt > current.DeployedAt)
                    {
                        bestPerEnv[p.Environment] = p;
                    }
                }

                foreach (var (env, parent) in bestPerEnv)
                {
                    var key = (env, d.Environment);
                    if (!correlatedEdges.ContainsKey(key))
                    {
                        correlatedEdges[key] = new TopologyEdge
                        {
                            From = parent.Environment,
                            To = d.Environment,
                            Source = TopologyEdge.SourceCorrelated,
                        };
                    }
                }
            }
        }

        // Pass 4 — merge. Explicit wins on (from, to) collisions.
        var merged = new Dictionary<(string From, string To), TopologyEdge>(correlatedEdges);
        foreach (var (k, v) in explicitEdges)
        {
            merged[k] = v;
        }

        // Defensive read-side cycle drop. SAD §5 "Cycle handling at read time".
        var safeEdges = DropCycles(service, merged.Values);

        return new TopologySnapshot { Edges = safeEdges };
    }

    /// <summary>
    /// Add edges one at a time. Each edge is dropped if its insertion
    /// would close a directed cycle (BFS from <c>to</c> in the current
    /// graph back to <c>from</c>). Insertion order is stable so the
    /// explicit-then-correlated merge result is deterministic.
    /// </summary>
    private IReadOnlyList<TopologyEdge> DropCycles(
        string service,
        IEnumerable<TopologyEdge> candidates)
    {
        // Adjacency list keyed by "from".
        var adjacency = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var accepted = new List<TopologyEdge>();

        // Explicit edges first (SAD merge rule: explicit wins), then
        // correlated. Inside each bucket we keep the natural ordering of
        // the dictionary enumeration, which is insertion order for
        // Dictionary<>.
        var ordered = candidates
            .OrderBy(e => e.Source == TopologyEdge.SourceExplicit ? 0 : 1)
            .ToList();

        foreach (var edge in ordered)
        {
            if (WouldCreateCycle(adjacency, edge.From, edge.To))
            {
                _logger.LogWarning(
                    "Dropping topology edge '{From}' -> '{To}' for service '{Service}' because it would form a cycle.",
                    edge.From, edge.To, service);
                continue;
            }

            if (!adjacency.TryGetValue(edge.From, out var children))
            {
                children = new HashSet<string>(StringComparer.Ordinal);
                adjacency[edge.From] = children;
            }
            children.Add(edge.To);
            accepted.Add(edge);
        }

        // Return in the SAD-defined order: explicit first, then correlated,
        // each in stable insertion order.
        return accepted;
    }

    private static bool WouldCreateCycle(
        IReadOnlyDictionary<string, HashSet<string>> adjacency,
        string from,
        string to)
    {
        // A new edge from -> to closes a cycle iff there is already a path
        // from `to` back to `from`. BFS from `to` and see whether we ever
        // touch `from`.
        if (string.Equals(from, to, StringComparison.Ordinal)) return true;
        if (!adjacency.ContainsKey(to)) return false;

        var visited = new HashSet<string>(StringComparer.Ordinal);
        var queue = new Queue<string>();
        queue.Enqueue(to);
        visited.Add(to);

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
}
