namespace Dashboard.Shared.Fetcher;

/// <summary>
/// In-memory store for the most recent rate-limit usage snapshot per
/// <c>(adapter_id, source_id)</c> pair (CR-0011 § 3c). Singleton —
/// populated by <c>POST /api/fetcher/usage</c>, served by
/// <c>GET /api/fetcher/usage</c>; no EF entity, no migration, no
/// persistence (re-publish-on-tick recovers the cache after replica
/// restart per ADR-0008 Decision 2).
///
/// <para>NFR-05 preserved because:</para>
/// <list type="bullet">
///   <item>The cache is rebuildable from external input — every fetcher
///   tick re-publishes; not durable state any API replica uniquely holds.</item>
///   <item>Single-writer in practice (fetcher runs <c>minReplicas == maxReplicas == 1</c>
///   per ADR-0004 Decision 3); no cross-fetcher write contention.</item>
///   <item>Per-replica transient inconsistency during the first poll
///   interval after a restart is acceptable — usage is a "now gauge",
///   not a transactional record.</item>
/// </list>
///
/// <para>Key shape: ordinal case-sensitive tuple. GHA repo paths and
/// adapter identifiers are both case-sensitive on the wire; <c>github-actions</c>
/// and <c>GitHub-Actions</c> must NOT collide as the same bucket.</para>
/// </summary>
public interface IFetcherUsageCache
{
    /// <summary>
    /// Upsert the snapshot for the supplied
    /// <see cref="FetcherUsageSnapshotRequest"/>. Returns the freshly
    /// stored <see cref="FetcherUsageSnapshotResponse"/> (with
    /// <c>ReceivedAt</c> stamped from the backend's wall-clock).
    /// Thread-safe; concurrent upserts to the same key resolve
    /// last-write-wins on <see cref="FetcherUsageSnapshotResponse.ReceivedAt"/>.
    /// </summary>
    FetcherUsageSnapshotResponse Upsert(FetcherUsageSnapshotRequest request);

    /// <summary>
    /// Snapshot of every cached entry. Order is unspecified; callers must
    /// not depend on insertion / alphabetical ordering. Returns an empty
    /// list when nothing has been pushed yet (NEVER 404 — CR-0011 § 3b).
    /// </summary>
    IReadOnlyList<FetcherUsageSnapshotResponse> GetAll();
}
