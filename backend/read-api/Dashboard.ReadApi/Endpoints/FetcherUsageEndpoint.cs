using Dashboard.Shared.Fetcher;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// <c>GET /api/fetcher/usage</c> — Read surface (CR-0011 § 3b). No auth
/// (matches every other Read endpoint per NFR-04). Returns the latest
/// cached snapshot per <c>(adapter_id, source_id)</c> the backend has
/// received, wrapped in <see cref="FetcherUsageSnapshotsResponse"/>.
///
/// <para><strong>Never 404.</strong> Empty array on cold start / replica
/// restart / "no fetcher deployed" — a 404 here would conflate
/// "no fetcher running" with "no such endpoint" and break the SPA's
/// empty-state rendering (CR-0011 § 3b explicit rule).</para>
///
/// <para>Re-publish-on-tick: after replica restart the cache is empty;
/// the next fetcher tick (≤ 30 s for the default poll interval)
/// re-warms it. Transient cross-replica inconsistency during the first
/// poll-interval after a restart is acceptable — usage is a "now gauge",
/// not a transactional record (ADR-0008 Decision 2).</para>
/// </summary>
public static class FetcherUsageEndpoint
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/fetcher/usage",
            (IFetcherUsageCache cache) =>
                Results.Ok(new FetcherUsageSnapshotsResponse
                {
                    Snapshots = cache.GetAll(),
                }))
        .WithName("GetFetcherUsage")
        .WithTags("Read")
        .WithSummary("Latest rate-limit usage snapshot per (adapter_id, source_id)")
        .WithDescription(
            "**Returns** every cached rate-limit usage snapshot the backend has received via " +
            "`POST /api/fetcher/usage` (CR-0011 § 3b) — one element per `(adapter_id, source_id)` " +
            "pair, keyed last-write-wins.\n\n" +
            "**Authentication.** None required.\n\n" +
            "**Cold start.** Returns `{ \"snapshots\": [] }` (NOT 404) when the fetcher has not " +
            "pushed yet, or when an API replica has just restarted and the next fetcher tick " +
            "has not arrived. The SPA renders its empty state from the empty array.\n\n" +
            "**Field semantics:**\n" +
            "- `upstream_used` is the *upstream-observed* `(limit − remaining)` value at " +
            "`observed_at` — not a fetcher-side counter (CR-0011 D3 + ADR-0008 Decision 1).\n" +
            "- `self_imposed_cap` is the fetcher-resolved cap for the current window " +
            "(`FETCHER_RATE_LIMIT_ABSOLUTE` if set, else `FETCHER_RATE_LIMIT_PERCENTAGE` of " +
            "`upstream_limit`).\n" +
            "- `received_at` is the server-side wall-clock at POST landing — lets clients " +
            "stale-out the cluster after `2 × poll_interval` without depending on the SSE wire.")
        .Produces<FetcherUsageSnapshotsResponse>(StatusCodes.Status200OK, contentType: "application/json");
    }
}
