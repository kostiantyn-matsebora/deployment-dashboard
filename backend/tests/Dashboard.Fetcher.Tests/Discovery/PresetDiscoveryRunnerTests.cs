using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Discovery;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.Ingest;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Discovery;

/// <summary>
/// Tests for <see cref="PresetDiscoveryRunner"/> — the slow-cadence preset-discovery step
/// (issue #391 — see FETCHER_SPECIFICATION.md "Preset discovery"; contract:
/// docs/api/openapi.yaml <c>presets</c> tag, docs/API_SPECIFICATION.md
/// <c>provided_presets</c>). Covers: discover→PUT for single-shape and
/// bundle-shape files (and aggregation across both in one directory), 304 → no re-PUT,
/// 403/404 → skip with no prune, and a per-file parse error aborting the WHOLE source
/// (no partial publish, no prune). No mocks — a fake in-memory HTTP handler and a fake
/// <see cref="IPresetIngestClient"/> PUT-capture.
/// </summary>
public sealed class PresetDiscoveryRunnerTests
{
    private const string Source = "acme/web";
    private const string DirPath = "/repos/acme/web/contents/.deployment-dashboard";

    // ── discover → PUT ───────────────────────────────────────────────────────

    [Fact]
    public async Task SingleShapeFile_Aggregates_AndPuts()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1",
            new GhContentEntry { Name = "a.json", Path = ".deployment-dashboard/a.json", Type = "file" });
        handler.SetFile(".deployment-dashboard/a.json",
            """{"version":1,"name":"Prod defaults","settings":{"theme":"dark"}}""");

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        var call = Assert.Single(ingest.Calls);
        Assert.Equal(Source, call.Source);
        var preset = Assert.Single(call.Presets);
        Assert.Equal("Prod defaults", preset.Name);
    }

    [Fact]
    public async Task BundleShapeFile_Aggregates_AndPuts()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1",
            new GhContentEntry { Name = "bundle.json", Path = ".deployment-dashboard/bundle.json", Type = "file" });
        handler.SetFile(".deployment-dashboard/bundle.json", """
            {"version":1,"presets":[
              {"version":1,"name":"A","settings":{"x":1}},
              {"version":1,"name":"B","settings":{"x":2}}
            ]}
            """);

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        var call = Assert.Single(ingest.Calls);
        Assert.Equal(2, call.Presets.Count);
        Assert.Contains(call.Presets, p => p.Name == "A");
        Assert.Contains(call.Presets, p => p.Name == "B");
    }

    [Fact]
    public async Task MixedSingleAndBundleFiles_AggregateAcrossFiles()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1",
            new GhContentEntry { Name = "a.json", Path = ".deployment-dashboard/a.json", Type = "file" },
            new GhContentEntry { Name = "bundle.json", Path = ".deployment-dashboard/bundle.json", Type = "file" },
            new GhContentEntry { Name = "readme.md", Path = ".deployment-dashboard/readme.md", Type = "file" },
            new GhContentEntry { Name = "sub", Path = ".deployment-dashboard/sub", Type = "dir" });
        handler.SetFile(".deployment-dashboard/a.json",
            """{"version":1,"name":"A","settings":{}}""");
        handler.SetFile(".deployment-dashboard/bundle.json", """
            {"version":1,"presets":[{"version":1,"name":"B","settings":{}},{"version":1,"name":"C","settings":{}}]}
            """);

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        var call = Assert.Single(ingest.Calls);
        // Non-.json and non-file (dir) entries must be ignored — 3 presets total (A, B, C).
        Assert.Equal(3, call.Presets.Count);
        Assert.Equal(["A", "B", "C"], call.Presets.Select(p => p.Name).OrderBy(n => n));
    }

    [Fact]
    public async Task EmptyDirectory_PutsEmptyPresets_Prunes()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1"); // zero entries

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        var call = Assert.Single(ingest.Calls);
        Assert.Empty(call.Presets);
    }

    // ── 304 → no re-PUT ──────────────────────────────────────────────────────

    [Fact]
    public async Task DirectoryListing304_NoRePut()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1",
            new GhContentEntry { Name = "a.json", Path = ".deployment-dashboard/a.json", Type = "file" });
        handler.SetFile(".deployment-dashboard/a.json",
            """{"version":1,"name":"A","settings":{}}""");

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default); // seeds ETag cache, 1 PUT
        await runner.RunOnceAsync(default); // directory unchanged → 304 → no re-PUT

        Assert.Single(ingest.Calls);
        Assert.True(handler.ReceivedIfNoneMatchFor(DirPath),
            "Second cycle must have sent If-None-Match for the directory listing");
    }

    // ── skip, never prune ────────────────────────────────────────────────────

    [Fact]
    public async Task DirectoryForbidden403_SkipsSource_NoPut()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectoryStatus(DirPath, HttpStatusCode.Forbidden);

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        Assert.Empty(ingest.Calls);
    }

    [Fact]
    public async Task DirectoryNotFound404_SkipsSource_NoPut()
    {
        var handler = new FakeGithubHandler();
        // No route registered for the directory path → 404 by default.

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        Assert.Empty(ingest.Calls);
    }

    [Fact]
    public async Task PerFileParseError_AbortsWholeSource_NoPartialPublish_NoPrune()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1",
            new GhContentEntry { Name = "a.json", Path = ".deployment-dashboard/a.json", Type = "file" },
            new GhContentEntry { Name = "bad.json", Path = ".deployment-dashboard/bad.json", Type = "file" });
        handler.SetFile(".deployment-dashboard/a.json",
            """{"version":1,"name":"A","settings":{}}""");
        handler.SetFile(".deployment-dashboard/bad.json", "{not-json"); // malformed

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        // Even though a.json parsed fine, bad.json's failure must skip the ENTIRE source.
        Assert.Empty(ingest.Calls);
    }

    [Fact]
    public async Task PerFileFetchNon2xx_AbortsWholeSource_NoPut()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1",
            new GhContentEntry { Name = "a.json", Path = ".deployment-dashboard/a.json", Type = "file" });
        // File route intentionally left unregistered → 404 on file fetch → parse-null → skip.

        var (runner, ingest) = Build(handler);

        await runner.RunOnceAsync(default);

        Assert.Empty(ingest.Calls);
    }

    // ── multi-repo ───────────────────────────────────────────────────────────

    [Fact]
    public async Task OneSourceFails_OtherSourceStillPublished()
    {
        const string otherDirPath = "/repos/acme/api/contents/.deployment-dashboard";
        var handler = new FakeGithubHandler();
        handler.SetDirectoryStatus(DirPath, HttpStatusCode.Forbidden);
        handler.SetDirectory(otherDirPath, etag: "dir-v1",
            new GhContentEntry { Name = "a.json", Path = ".deployment-dashboard/a.json", Type = "file" });
        handler.SetFile(".deployment-dashboard/a.json", """{"version":1,"name":"A","settings":{}}""",
            repoPrefix: "acme/api");

        var (runner, ingest) = Build(handler, repos: "acme/web,acme/api");

        await runner.RunOnceAsync(default);

        var call = Assert.Single(ingest.Calls);
        Assert.Equal("acme/api", call.Source);
    }

    // ── rate-limit budget ────────────────────────────────────────────────────

    [Fact]
    public async Task GithubCalls_RouteThroughRateLimitBudget()
    {
        var handler = new FakeGithubHandler();
        handler.SetDirectory(DirPath, etag: "dir-v1",
            new GhContentEntry { Name = "a.json", Path = ".deployment-dashboard/a.json", Type = "file" });
        handler.SetFile(".deployment-dashboard/a.json", """{"version":1,"name":"A","settings":{}}""");

        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
        var budget = await RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default);
        var github = new GithubClient(httpClient, budget);
        var ingest = new FakePresetIngestClient();
        var options = new GithubAdapterOptions { Repos = Source };
        var runner = new PresetDiscoveryRunner(
            github, ingest, options, NullLogger<PresetDiscoveryRunner>.Instance);

        Assert.Equal(0, budget.Used);
        await runner.RunOnceAsync(default);

        // Directory listing + file fetch = 2 quota-consuming requests.
        Assert.True(budget.Used >= 2, $"Expected >= 2 requests recorded, got {budget.Used}");
    }

    // ── infrastructure ───────────────────────────────────────────────────────

    private static (PresetDiscoveryRunner Runner, FakePresetIngestClient Ingest) Build(
        FakeGithubHandler handler, string repos = Source)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
        var budget = RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default).GetAwaiter().GetResult();
        var github = new GithubClient(httpClient, budget);
        var ingest = new FakePresetIngestClient();
        var options = new GithubAdapterOptions { Repos = repos };
        var runner = new PresetDiscoveryRunner(
            github, ingest, options, NullLogger<PresetDiscoveryRunner>.Instance);
        return (runner, ingest);
    }

    private sealed class FakePresetIngestClient : IPresetIngestClient
    {
        public List<(string Source, IReadOnlyList<PresetEntry> Presets)> Calls { get; } = [];

        public Task PutAsync(string source, IReadOnlyList<PresetEntry> presets, CancellationToken ct)
        {
            Calls.Add((source, presets));
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Minimal fake GitHub HTTP handler for directory-listing + file-content routes.
    /// Directory routes support ETag / If-None-Match (200→304 on matching ETag).
    /// Any unregistered path returns 404.
    /// </summary>
    private sealed class FakeGithubHandler : HttpMessageHandler
    {
        private readonly Dictionary<string, (HttpStatusCode Status, object? Body, string? ETag)> _directories = new();
        private readonly Dictionary<string, string> _files = new();
        private readonly HashSet<string> _ifNoneMatchReceived = [];

        public void SetDirectory(string path, string etag, params GhContentEntry[] entries) =>
            _directories[path] = (HttpStatusCode.OK, entries.ToList(), etag);

        public void SetDirectoryStatus(string path, HttpStatusCode status) =>
            _directories[path] = (status, null, null);

        public void SetFile(string relativePath, string json, string repoPrefix = "acme/web") =>
            _files[$"/repos/{repoPrefix}/contents/{relativePath}"] =
                Convert.ToBase64String(Encoding.UTF8.GetBytes(json));

        public bool ReceivedIfNoneMatchFor(string path) => _ifNoneMatchReceived.Contains(path);

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;

            if (request.Headers.IfNoneMatch.Count > 0)
                _ifNoneMatchReceived.Add(path);

            if (_directories.TryGetValue(path, out var dir))
            {
                if (dir.Status == HttpStatusCode.OK)
                {
                    var ifNoneMatch = request.Headers.IfNoneMatch.FirstOrDefault()?.ToString();
                    if (ifNoneMatch is not null && dir.ETag is not null &&
                        string.Equals(ifNoneMatch, $"\"{dir.ETag}\"", StringComparison.Ordinal))
                    {
                        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotModified));
                    }

                    var response = new HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new StringContent(
                            JsonSerializer.Serialize(dir.Body), Encoding.UTF8, "application/json"),
                    };
                    if (dir.ETag is not null)
                        response.Headers.ETag = new EntityTagHeaderValue($"\"{dir.ETag}\"");
                    return Task.FromResult(response);
                }

                return Task.FromResult(new HttpResponseMessage(dir.Status));
            }

            if (_files.TryGetValue(path, out var content))
            {
                var body = new GhWorkflowFileContent { Content = content, Encoding = "base64" };
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
                });
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}
