namespace Dashboard.Fetcher.Hosting;

/// <summary>
/// Bound from env vars by <see cref="DependencyInjection.ServiceCollectionExtensions"/>:
///
/// <list type="bullet">
///   <item><c>DASHBOARD_WRITE_API_URL</c> — required, used as the
///   <c>HttpClient</c> base address.</item>
///   <item><c>DASHBOARD_WRITE_API_KEY</c> — required, sent as
///   <c>X-Api-Key</c> on every call.</item>
///   <item><c>FETCHER_POLL_INTERVAL_SECONDS</c> — default 30, min 5.</item>
///   <item><c>INITIAL_FETCH_LIMIT</c> — default 50, ceiling 500.</item>
///   <item><c>FETCHER_ADAPTERS</c> — MVP fixed to <c>github-actions</c>.</item>
///   <item><c>PROGRESS_REPORTER</c> — optional override; default is
///   <c>dashboard-fetcher/{AdapterId}</c> per adapter.</item>
/// </list>
///
/// <para>The host validates these at startup and refuses to run with
/// missing required values so failure is loud and immediate.</para>
/// </summary>
public sealed class FetcherOptions
{
    public string WriteApiUrl { get; init; } = string.Empty;
    public string WriteApiKey { get; init; } = string.Empty;
    public int PollIntervalSeconds { get; init; } = 30;
    public int InitialFetchLimit { get; init; } = 50;
    public IReadOnlyList<string> AdapterIds { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Optional caller-override for the <c>X-Progress-Reporter</c> value.
    /// When null the worker uses <c>dashboard-fetcher/{adapter.AdapterId}</c>
    /// per adapter.
    /// </summary>
    public string? ProgressReporterOverride { get; init; }

    /// <summary>
    /// Per-(adapter-id) list of source-ids the worker should poll.
    /// Adapter-host-specific: the GHA adapter expects <c>owner/repo</c>
    /// strings; other adapters pick their own shape.
    /// </summary>
    public IReadOnlyDictionary<string, IReadOnlyList<string>> SourceIdsByAdapter { get; init; }
        = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
}
