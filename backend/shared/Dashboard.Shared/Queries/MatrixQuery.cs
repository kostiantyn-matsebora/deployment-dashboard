using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Topology;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Shared.Queries;

/// <summary>
/// Builds the deployment matrix response from the <c>deployments</c> table.
///
/// <para>Per SAD §7 + Decision §10 #3:</para>
/// <list type="bullet">
///   <item>The matrix always shows the latest event per slot regardless of status.</item>
///   <item><c>lastSuccessful</c> is the most recent successful event for the
///   slot when it differs from <c>current</c>; otherwise <c>null</c>.
///   It is also <c>null</c> when no successful event has ever occurred.</item>
///   <item><c>previousFailed</c> is <c>true</c> only when the current event
///   is <c>in-progress</c> and the most recent <em>terminal</em> event
///   (success or failure) is a failure.</item>
///   <item>Per-service <c>topology.edges</c> are computed by
///   <see cref="TopologyBuilder"/> from the same row set on every read
///   (SAD §5 "Topology Derivation").</item>
/// </list>
///
/// Implementation: one full table read ordered DESC by <c>deployed_at</c>,
/// then an O(n) pass in memory to derive the three values per slot. The
/// topology builder runs once per service over the same buffered rows so
/// the matrix endpoint is a single SQL round-trip regardless of service
/// count.
/// </summary>
public static class MatrixQuery
{
    /// <summary>
    /// Build the full matrix as
    /// <c>{ service: { envs: { env: MatrixSlot }, topology: { edges } } }</c>
    /// per SAD §7 "Matrix response shape — per service".
    /// </summary>
    public static async Task<IReadOnlyDictionary<string, ServiceMatrix>> BuildAsync(
        DashboardDbContext db,
        TopologyBuilder topologyBuilder,
        Func<string, Task<string>> resolveAttributeForService,
        CancellationToken ct = default)
    {
        var events = await db.Deployments
            .AsNoTracking()
            .OrderByDescending(e => e.DeployedAt)
            .ThenByDescending(e => e.Id)
            .ToListAsync(ct);

        return await BuildFromEventsAsync(events, topologyBuilder, resolveAttributeForService);
    }

    /// <summary>
    /// Build the <see cref="ServiceMatrix"/> for a single service using one
    /// indexed SQL round-trip. Used by the SSE listener to derive both the
    /// per-slot view and the per-service topology snapshot for the affected
    /// service on every NOTIFY (SAD §7 "SSE slot-update data payload").
    /// </summary>
    /// <returns>
    /// A tuple of the matrix slot for <paramref name="environment"/> (or null
    /// when the slot has no history) and the per-service topology snapshot.
    /// </returns>
    public static async Task<(MatrixSlot? Slot, TopologySnapshot Topology)> BuildSlotAsync(
        DashboardDbContext db,
        string service,
        string environment,
        TopologyBuilder topologyBuilder,
        string correlationAttribute,
        CancellationToken ct = default)
    {
        var events = await db.Deployments
            .AsNoTracking()
            .Where(e => e.Service == service)
            .OrderByDescending(e => e.DeployedAt)
            .ThenByDescending(e => e.Id)
            .ToListAsync(ct);

        if (events.Count == 0)
        {
            return (null, new TopologySnapshot());
        }

        var matrixSlots = BuildSlotsFromEvents(events);
        MatrixSlot? slot = null;
        if (matrixSlots.TryGetValue(service, out var envs) &&
            envs.TryGetValue(environment, out var found))
        {
            slot = found;
        }

        var topology = topologyBuilder.Build(service, events, correlationAttribute);
        return (slot, topology);
    }

    /// <summary>
    /// Back-compat alias for <see cref="BuildSlotsFromEvents"/>: returns the
    /// per-service / per-env slot map without the topology block. Used by
    /// unit tests focused on slot derivation rules (six-box-states) where
    /// topology is orthogonal.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, MatrixSlot>>
        BuildFromEvents(IEnumerable<DeploymentEntity> eventsNewestFirst) =>
            BuildSlotsFromEvents(eventsNewestFirst);

    /// <summary>
    /// Pure derivation helper that works on an in-memory event list ordered
    /// most-recent-first. Returns the legacy "service -> env -> slot" shape
    /// used inside the wrapping <see cref="ServiceMatrix"/>; the topology
    /// block is added at the layer above.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, MatrixSlot>>
        BuildSlotsFromEvents(IEnumerable<DeploymentEntity> eventsNewestFirst)
    {
        // service -> environment -> derived slot, accumulated as we walk the
        // events newest -> oldest. We only update each (service, env) slot
        // when we encounter a row that fills in a missing piece.
        var accumulator = new Dictionary<string, Dictionary<string, SlotAccumulator>>(
            StringComparer.Ordinal);

        foreach (var e in eventsNewestFirst)
        {
            if (!accumulator.TryGetValue(e.Service, out var envs))
            {
                envs = new Dictionary<string, SlotAccumulator>(StringComparer.Ordinal);
                accumulator[e.Service] = envs;
            }

            if (!envs.TryGetValue(e.Environment, out var slot))
            {
                slot = new SlotAccumulator();
                envs[e.Environment] = slot;
            }

            // First event we see for this slot is the "current" deployment by
            // virtue of the input being sorted newest-first.
            if (slot.Current is null)
            {
                slot.Current = e;
                continue;
            }

            // Once current is fixed, we still need:
            //   - the first terminal event after current (to set previousFailed)
            //   - the first successful event after current (lastSuccessful)
            // Both can usually be filled by the same row.
            if (slot.MostRecentPriorTerminal is null && DeploymentStatus.IsTerminal(e.Status))
            {
                slot.MostRecentPriorTerminal = e;
            }

            if (slot.LastSuccessful is null && e.Status == DeploymentStatus.Success)
            {
                slot.LastSuccessful = e;
            }

            if (slot.MostRecentPriorTerminal is not null && slot.LastSuccessful is not null)
            {
                slot.Complete = true;
            }
        }

        return Project(accumulator);
    }

    /// <summary>
    /// Pure helper that assembles the full <see cref="ServiceMatrix"/> per
    /// service, including the topology block, given an in-memory event
    /// list. The topology attribute resolver is invoked once per service so
    /// the per-service override (SAD §7 "Configuration") is honoured.
    /// </summary>
    public static async Task<IReadOnlyDictionary<string, ServiceMatrix>> BuildFromEventsAsync(
        IReadOnlyList<DeploymentEntity> eventsNewestFirst,
        TopologyBuilder topologyBuilder,
        Func<string, Task<string>> resolveAttributeForService)
    {
        var slotsPerService = BuildSlotsFromEvents(eventsNewestFirst);
        var byService = eventsNewestFirst
            .GroupBy(e => e.Service, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        var result = new Dictionary<string, ServiceMatrix>(StringComparer.Ordinal);
        foreach (var (service, envs) in slotsPerService)
        {
            var attribute = await resolveAttributeForService(service);
            var serviceDeployments = byService.TryGetValue(service, out var list) ? list : new();
            var topology = topologyBuilder.Build(service, serviceDeployments, attribute);

            result[service] = new ServiceMatrix
            {
                Envs = envs,
                Topology = topology,
            };
        }

        return result;
    }

    private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, MatrixSlot>>
        Project(Dictionary<string, Dictionary<string, SlotAccumulator>> accumulator)
    {
        var result = new Dictionary<string, IReadOnlyDictionary<string, MatrixSlot>>(
            StringComparer.Ordinal);

        foreach (var (service, envs) in accumulator)
        {
            var projectedEnvs = new Dictionary<string, MatrixSlot>(StringComparer.Ordinal);
            foreach (var (env, slot) in envs)
            {
                if (slot.Current is null) continue; // defensive — shouldn't happen
                projectedEnvs[env] = Project(slot);
            }
            result[service] = projectedEnvs;
        }

        return result;
    }

    private static MatrixSlot Project(SlotAccumulator slot)
    {
        var current = slot.Current!;
        var isCurrentSuccess = current.Status == DeploymentStatus.Success;

        // lastSuccessful is null when:
        //   - current itself is the most recent success (matches the SAD's
        //     "they are the same event" rule), OR
        //   - no successful event has ever happened for the slot.
        var lastSuccessful = isCurrentSuccess || slot.LastSuccessful is null
            ? null
            : LastSuccessfulDeployment.FromEntity(slot.LastSuccessful);

        // previousFailed is true only when:
        //   - current is in-progress, AND
        //   - the most recent prior *terminal* event was a failure.
        var previousFailed =
            current.Status == DeploymentStatus.InProgress &&
            slot.MostRecentPriorTerminal is { Status: DeploymentStatus.Failure };

        return new MatrixSlot
        {
            Current = CurrentDeployment.FromEntity(current),
            LastSuccessful = lastSuccessful,
            PreviousFailed = previousFailed,
        };
    }

    private sealed class SlotAccumulator
    {
        public DeploymentEntity? Current;
        public DeploymentEntity? MostRecentPriorTerminal;
        public DeploymentEntity? LastSuccessful;
        public bool Complete;
    }
}
