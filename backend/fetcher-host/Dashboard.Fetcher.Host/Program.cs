using System.Text.Json;
using Dashboard.Fetcher.DependencyInjection;
using Dashboard.Fetcher.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Fetcher.Host;

/// <summary>
/// Composition root for the opt-in <c>dashboard-fetcher</c> container
/// (CR-0009 + ADR-0004 Decision 3 — separate process, separate image).
/// Strict <c>HostBuilder</c> only — no <c>WebApplication</c>, no HTTP
/// listener, no inbound network surface (NFR-04).
///
/// <para>Env-var contract (CR-0009 § 3d):</para>
/// <list type="bullet">
///   <item><c>DASHBOARD_WRITE_API_URL</c> — required.</item>
///   <item><c>DASHBOARD_WRITE_API_KEY</c> — required (same key as any push caller).</item>
///   <item><c>FETCHER_POLL_INTERVAL_SECONDS</c> — default 30, min 5.</item>
///   <item><c>INITIAL_FETCH_LIMIT</c> — default 50, ceiling 500.</item>
///   <item><c>FETCHER_ADAPTERS</c> — MVP fixed to <c>github-actions</c>.</item>
///   <item><c>PROGRESS_REPORTER</c> — optional override; default computed
///   per adapter as <c>dashboard-fetcher/{AdapterId}</c>.</item>
///   <item><c>GHA_TOKEN</c> — required when the GHA adapter is active.</item>
///   <item><c>GHA_REPOSITORIES</c> — JSON array
///   <c>[{"owner":"o","repo":"r"}, …]</c>; mapped to <c>owner/repo</c>
///   strings passed as <c>source-id</c> to the GHA adapter.</item>
///   <item><c>GHA_API_BASE_URL</c> — default <c>https://api.github.com</c>;
///   override for GHE.</item>
/// </list>
/// </summary>
public sealed class Program
{
    public static int Main(string[] args)
    {
        var builder = Microsoft.Extensions.Hosting.Host.CreateApplicationBuilder(args);

        FetcherOptions options;
        try
        {
            options = BindOptionsFromEnvironment();
        }
        catch (InvalidOperationException ex)
        {
            // Fail fast and loud — env-var misconfig must not start the
            // worker and silently no-op.
            Console.Error.WriteLine($"dashboard-fetcher: invalid configuration — {ex.Message}");
            return 78; // EX_CONFIG
        }

        builder.Services.AddCiCdFetcher(options);

        var host = builder.Build();
        host.Run();
        return 0;
    }

    private static FetcherOptions BindOptionsFromEnvironment()
    {
        var writeUrl = Read("DASHBOARD_WRITE_API_URL")
                       ?? throw new InvalidOperationException("DASHBOARD_WRITE_API_URL is required");
        var writeKey = Read("DASHBOARD_WRITE_API_KEY")
                       ?? throw new InvalidOperationException("DASHBOARD_WRITE_API_KEY is required");

        var pollInterval = ReadInt("FETCHER_POLL_INTERVAL_SECONDS", defaultValue: 30, min: 5, max: int.MaxValue);
        var initialLimit = ReadInt("INITIAL_FETCH_LIMIT", defaultValue: 50, min: 1, max: 500);

        var adaptersRaw = Read("FETCHER_ADAPTERS");
        var adapters = string.IsNullOrWhiteSpace(adaptersRaw)
            ? new[] { "github-actions" }
            : adaptersRaw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var sourceIdsByAdapter = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);

        if (adapters.Any(a => string.Equals(a, "github-actions", StringComparison.Ordinal)))
        {
            // GHA adapter needs a PAT and a list of (owner, repo) pairs.
            if (string.IsNullOrWhiteSpace(Read("GHA_TOKEN")))
            {
                throw new InvalidOperationException(
                    "GHA_TOKEN is required when the github-actions adapter is active");
            }

            var ghaSources = ParseGhaRepositories();
            sourceIdsByAdapter["github-actions"] = ghaSources;
        }

        return new FetcherOptions
        {
            WriteApiUrl = writeUrl,
            WriteApiKey = writeKey,
            PollIntervalSeconds = pollInterval,
            InitialFetchLimit = initialLimit,
            AdapterIds = adapters,
            ProgressReporterOverride = Read("PROGRESS_REPORTER"),
            SourceIdsByAdapter = sourceIdsByAdapter,
        };
    }

    private static IReadOnlyList<string> ParseGhaRepositories()
    {
        var raw = Read("GHA_REPOSITORIES");
        if (string.IsNullOrWhiteSpace(raw)) return Array.Empty<string>();

        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidOperationException(
                    "GHA_REPOSITORIES must be a JSON array of {owner, repo} objects");
            }
            var result = new List<string>();
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("owner", out var ownerProp) || ownerProp.ValueKind != JsonValueKind.String ||
                    !item.TryGetProperty("repo", out var repoProp)  || repoProp.ValueKind  != JsonValueKind.String)
                {
                    throw new InvalidOperationException(
                        "Every GHA_REPOSITORIES entry must have string 'owner' and 'repo' properties");
                }
                var owner = ownerProp.GetString();
                var repo  = repoProp.GetString();
                if (string.IsNullOrWhiteSpace(owner) || string.IsNullOrWhiteSpace(repo))
                {
                    throw new InvalidOperationException("GHA_REPOSITORIES entries must have non-empty owner and repo");
                }
                result.Add($"{owner}/{repo}");
            }
            return result;
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException("GHA_REPOSITORIES is not valid JSON: " + ex.Message);
        }
    }

    private static string? Read(string envVar)
    {
        var value = Environment.GetEnvironmentVariable(envVar);
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static int ReadInt(string envVar, int defaultValue, int min, int max)
    {
        var raw = Read(envVar);
        if (raw is null) return defaultValue;
        if (!int.TryParse(raw, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var value))
        {
            throw new InvalidOperationException($"{envVar} must be an integer; got '{raw}'");
        }
        if (value < min) value = min;
        if (value > max) value = max;
        return value;
    }
}
