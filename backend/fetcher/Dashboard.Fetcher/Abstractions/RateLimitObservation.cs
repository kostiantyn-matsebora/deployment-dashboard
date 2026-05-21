namespace Dashboard.Fetcher.Abstractions;

/// <summary>
/// One point-in-time observation of an upstream CI/CD tool's rate-limit
/// window — emitted by the adapter inside <see cref="FetchPage"/> and
/// consumed by the host (<c>FetcherWorker</c>) to drive the self-imposed
/// leaky-bucket gate (CR-0011 + ADR-0008 Decision 1).
///
/// <para>The host treats this as the single source of truth for "how much
/// of the upstream budget have we used this window?" — there is no
/// fetcher-side counter. On restart we lose nothing because the very next
/// upstream response re-populates <see cref="UpstreamRemaining"/>.</para>
///
/// <para>All fields are <strong>provider-reported</strong> values except
/// <see cref="ObservedAt"/>, which is the fetcher wall-clock at the
/// moment the response headers were read. Adapters are expected to:</para>
/// <list type="bullet">
///   <item>Parse <see cref="UpstreamLimit"/> and <see cref="UpstreamRemaining"/>
///   from the provider's rate-limit response headers (GHA:
///   <c>X-RateLimit-Limit</c> / <c>X-RateLimit-Remaining</c>).</item>
///   <item>Convert the provider's reset timestamp to UTC
///   (<see cref="UpstreamResetAt"/>) — GHA's epoch-seconds
///   <c>X-RateLimit-Reset</c> becomes a <see cref="DateTime"/> with
///   <c>Kind == Utc</c>.</item>
///   <item>Stamp <see cref="ObservedAt"/> at <c>DateTime.UtcNow</c> the
///   moment the headers are observed (NOT at <c>FetchPage</c> construction
///   time — keeps the value-honest for clock-skew reasoning).</item>
/// </list>
///
/// <para>When the upstream API does not expose rate-limit headers (or
/// parsing fails), the adapter omits the observation by leaving
/// <see cref="FetchPage.RateLimit"/> <c>null</c>; the host then does not
/// gate that tick — same posture as today (CR-0009 baseline).</para>
/// </summary>
public sealed record RateLimitObservation(
    int UpstreamLimit,
    int UpstreamRemaining,
    DateTime UpstreamResetAt,
    DateTime ObservedAt);
