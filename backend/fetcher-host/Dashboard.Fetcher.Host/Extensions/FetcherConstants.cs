namespace Dashboard.Fetcher.Host.Extensions;

/// <summary>
/// Named constants for header names, GitHub API values, and other magic strings used
/// throughout the host's HTTP-client and health-endpoint wiring.
/// </summary>
internal static class FetcherConstants
{
    // ── API header names ──────────────────────────────────────────────────────

    /// <summary>API key header sent to the Dashboard API on ingest and ack requests.</summary>
    internal const string HeaderApiKey = "X-Api-Key";

    /// <summary>Control-plane API key header sent on the control-stream subscription.</summary>
    internal const string HeaderControlApiKey = "X-Control-API-Key";

    /// <summary>Component identity header included on every control-event POST.</summary>
    internal const string HeaderComponentId = "X-Component-Id";

    // ── GitHub API header names ───────────────────────────────────────────────

    /// <summary>Authorization header (Bearer token) for GitHub REST requests.</summary>
    internal const string HeaderAuthorization = "Authorization";

    /// <summary>Accept header value required by GitHub REST API v3.</summary>
    internal const string HeaderAccept = "Accept";

    /// <summary>GitHub API version header (X-GitHub-Api-Version).</summary>
    internal const string HeaderGitHubApiVersion = "X-GitHub-Api-Version";

    /// <summary>User-Agent header required by GitHub REST API.</summary>
    internal const string HeaderUserAgent = "User-Agent";

    // ── GitHub API values ─────────────────────────────────────────────────────

    /// <summary>GitHub REST API v3 media type required by the Accept header.</summary>
    internal const string GitHubAcceptValue = "application/vnd.github+json";

    /// <summary>GitHub REST API version pinned per spec §5 (§5.1).</summary>
    internal const string GitHubApiVersion = "2022-11-28";

    /// <summary>User-Agent value sent to GitHub (must identify the application).</summary>
    internal const string GitHubUserAgent = "deployment-dashboard-fetcher";

    // ── Named HTTP client ─────────────────────────────────────────────────────

    /// <summary>Named <see cref="System.Net.Http.HttpClient"/> key for the GitHub REST client.</summary>
    internal const string GitHubHttpClientName = "github";
}
