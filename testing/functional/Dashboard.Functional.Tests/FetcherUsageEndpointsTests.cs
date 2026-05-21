using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Dashboard.Shared.Fetcher;
using Dashboard.Shared.Json;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// CR-0011 acceptance criteria — functional tests for the two new endpoints
/// against the running Deployment Dashboard stack:
///
/// <list type="bullet">
///   <item><c>POST /api/fetcher/usage</c> — Write group, <c>X-Api-Key</c> +
///   <c>X-Progress-Reporter</c> required, body validation per CR-0008
///   (length-only / range / non-whitespace), 422 on violation, 401 on
///   missing key.</item>
///   <item><c>GET /api/fetcher/usage</c> — Read group, no auth, returns
///   <c>{ "snapshots": [ ... ] }</c> with the latest snapshot per
///   <c>(adapter_id, source_id)</c>; empty array (NEVER 404) on cold
///   start / post-restart (ADR-0008 Decision 2 — re-publish-on-tick).</item>
/// </list>
///
/// <para>NFR-05 oracle (case 12) restarts the API container and asserts
/// the cache re-warms on the next push — exercises the
/// re-publish-on-tick recovery contract end-to-end against the running
/// stack. Only fires when <c>docker</c> is on PATH AND the target points
/// at the local stack; against a non-local target the test SKIPs.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class FetcherUsageEndpointsTests : IDisposable
{
    private const string UsagePath = "/api/fetcher/usage";
    private const string DefaultProgressReporter = "dashboard-fetcher/qa-bot";

    private readonly HttpClient _authed;
    private readonly HttpClient _read;

    public FetcherUsageEndpointsTests()
    {
        _authed = TestEnvironment.CreateWriteClient();
        _authed.DefaultRequestHeaders.Remove("X-Progress-Reporter");
        _authed.DefaultRequestHeaders.Add("X-Progress-Reporter", DefaultProgressReporter);
        _read = TestEnvironment.CreateReadClient();
    }

    public void Dispose()
    {
        _authed.Dispose();
        _read.Dispose();
    }

    // ──────────────────────────────────────────────────────────────────────
    // 1. POST 200 on valid payload
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_HappyPath_Returns200_WithEmptyBody()
    {
        var (adapterId, sourceId) = UniqueKey("happy");
        var body = NewValidSnapshot(adapterId, sourceId);

        var resp = await _authed.PostAsJsonAsync(UsagePath, body, DashboardJson.Options);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var raw = await resp.Content.ReadAsStringAsync();
        Assert.True(string.IsNullOrEmpty(raw) || raw.Trim() == "{}" || raw.Trim().Length == 0,
            $"POST /api/fetcher/usage MUST return 200 with an empty body; got: '{raw}'.");
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2. GET returns the same snapshot the POST pushed (round-trip)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostThenGet_ReturnsSameSnapshot()
    {
        var (adapterId, sourceId) = UniqueKey("round-trip");
        var body = NewValidSnapshot(adapterId, sourceId,
            upstreamLimit: 5000, upstreamRemaining: 3247);

        var postResp = await _authed.PostAsJsonAsync(UsagePath, body, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.OK, postResp.StatusCode);

        var getResp = await _read.GetAsync(UsagePath);
        Assert.Equal(HttpStatusCode.OK, getResp.StatusCode);
        var payload = await getResp.Content.ReadFromJsonAsync<FetcherUsageSnapshotsResponse>(DashboardJson.Options);
        Assert.NotNull(payload);
        Assert.NotNull(payload!.Snapshots);

        var ours = FindByKey(payload.Snapshots, adapterId, sourceId);
        Assert.NotNull(ours);
        Assert.Equal(5000, ours!.UpstreamLimit);
        Assert.Equal(3247, ours.UpstreamRemaining);
        Assert.Equal(1753, ours.UpstreamUsed);
        Assert.Equal(body.SelfImposedCap, ours.SelfImposedCap);
        // received_at is server-stamped and MUST be present (UTC).
        Assert.NotEqual(default, ours.ReceivedAt);
        Assert.Equal(DateTimeKind.Utc, ours.ReceivedAt.Kind);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 3. GET returns empty {"snapshots":[]} (NOT 404) on cold start
    //    — best-effort assertion. We cannot fully simulate cold-start in the
    //    presence of other tests, so this case asserts the SHAPE: the
    //    response is 200 with a (possibly empty) snapshots array. The
    //    "never 404" contract is the load-bearing piece.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_AlwaysReturns200WithSnapshotsArray_NeverReturns404()
    {
        var resp = await _read.GetAsync(UsagePath);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        // The contract: never 404. (200 OK is the only acceptable status
        // for cold start AND populated; ADR-0008 Decision 2.)
        Assert.NotEqual(HttpStatusCode.NotFound, resp.StatusCode);

        var payload = await resp.Content.ReadFromJsonAsync<FetcherUsageSnapshotsResponse>(DashboardJson.Options);
        Assert.NotNull(payload);
        // The Snapshots array property is always present (never null).
        Assert.NotNull(payload!.Snapshots);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 4. POST 401 on missing X-Api-Key
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_MissingApiKey_Returns401()
    {
        using var bare = TestEnvironment.CreateUnauthenticatedWriteClient();
        bare.DefaultRequestHeaders.Add("X-Progress-Reporter", DefaultProgressReporter);

        var (adapterId, sourceId) = UniqueKey("noauth");
        var body = NewValidSnapshot(adapterId, sourceId);

        var resp = await bare.PostAsJsonAsync(UsagePath, body, DashboardJson.Options);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 5. POST 401 on wrong X-Api-Key
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_WrongApiKey_Returns401()
    {
        using var bare = TestEnvironment.CreateUnauthenticatedWriteClient();
        bare.DefaultRequestHeaders.Add("X-Api-Key", "obviously-wrong");
        bare.DefaultRequestHeaders.Add("X-Progress-Reporter", DefaultProgressReporter);

        var (adapterId, sourceId) = UniqueKey("badkey");
        var body = NewValidSnapshot(adapterId, sourceId);

        var resp = await bare.PostAsJsonAsync(UsagePath, body, DashboardJson.Options);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 6. POST 422 on missing X-Progress-Reporter (CR-0011 § 3b — required)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_MissingProgressReporterHeader_Returns422()
    {
        using var noReporter = TestEnvironment.CreateWriteClient();
        // Remove the header pre-applied by CreateWriteClient — its job here
        // is to be ABSENT so we hit the required-header validation path.
        noReporter.DefaultRequestHeaders.Remove("X-Progress-Reporter");

        var (adapterId, sourceId) = UniqueKey("nopr");
        var body = NewValidSnapshot(adapterId, sourceId);

        var resp = await noReporter.PostAsJsonAsync(UsagePath, body, DashboardJson.Options);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 7. POST 422 on whitespace-only adapter_id (CR-0008 length-only + non-whitespace)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_WhitespaceAdapterId_Returns422()
    {
        var json = $@"{{
          ""adapter_id"":         ""   "",
          ""source_id"":          ""acme/widget-a"",
          ""upstream_limit"":     5000,
          ""upstream_remaining"": 3247,
          ""upstream_reset_at"":  ""2026-05-21T14:00:00Z"",
          ""self_imposed_cap"":   1500,
          ""upstream_used"":      1753,
          ""observed_at"":        ""2026-05-21T13:42:18.412Z""
        }}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync(UsagePath, content);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 8. POST 422 on over-cap upstream_limit (Range [1, 1_000_000])
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_OverCapUpstreamLimit_Returns422()
    {
        var json = $@"{{
          ""adapter_id"":         ""github-actions"",
          ""source_id"":          ""acme/widget-a-over-cap"",
          ""upstream_limit"":     50000000,
          ""upstream_remaining"": 100,
          ""upstream_reset_at"":  ""2026-05-21T14:00:00Z"",
          ""self_imposed_cap"":   1500,
          ""upstream_used"":      4900,
          ""observed_at"":        ""2026-05-21T13:42:18.412Z""
        }}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync(UsagePath, content);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 9. POST 422 on missing required field (e.g. observed_at)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_MissingObservedAt_Returns422()
    {
        var json = $@"{{
          ""adapter_id"":         ""github-actions"",
          ""source_id"":          ""acme/widget-a-miss-observed"",
          ""upstream_limit"":     5000,
          ""upstream_remaining"": 3247,
          ""upstream_reset_at"":  ""2026-05-21T14:00:00Z"",
          ""self_imposed_cap"":   1500,
          ""upstream_used"":      1753
        }}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync(UsagePath, content);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 10. POST returns ProblemDetails on 422 (CR-0008 contract reused)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_InvalidPayload_ReturnsRfc7807ProblemDetails()
    {
        var json = $@"{{
          ""adapter_id"":         """",
          ""source_id"":          ""acme/widget-a-pd"",
          ""upstream_limit"":     5000,
          ""upstream_remaining"": 3247,
          ""upstream_reset_at"":  ""2026-05-21T14:00:00Z"",
          ""self_imposed_cap"":   1500,
          ""upstream_used"":      1753,
          ""observed_at"":        ""2026-05-21T13:42:18.412Z""
        }}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync(UsagePath, content);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        var raw = await resp.Content.ReadAsStringAsync();
        // ValidationProblemDetails per RFC 7807 — must contain an "errors"
        // map plus the standard "title" / "status" fields.
        Assert.Contains("\"errors\"", raw, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("\"status\"", raw, StringComparison.OrdinalIgnoreCase);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 11. Last-write-wins — second POST for the same (adapter, source)
    //     overwrites the first, GET reflects the second snapshot only.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostTwice_SameKey_LastWriteWins_OnGet()
    {
        var (adapterId, sourceId) = UniqueKey("lww");

        // First snapshot — used = 1000.
        var first = NewValidSnapshot(adapterId, sourceId, upstreamLimit: 5000, upstreamRemaining: 4000);
        var p1 = await _authed.PostAsJsonAsync(UsagePath, first, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.OK, p1.StatusCode);

        // Tiny delay so the server-stamped received_at advances.
        await Task.Delay(50);

        // Second snapshot — used = 4900 (cap-reached state).
        var second = NewValidSnapshot(adapterId, sourceId, upstreamLimit: 5000, upstreamRemaining: 100);
        var p2 = await _authed.PostAsJsonAsync(UsagePath, second, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.OK, p2.StatusCode);

        var getResp = await _read.GetAsync(UsagePath);
        Assert.Equal(HttpStatusCode.OK, getResp.StatusCode);
        var payload = await getResp.Content.ReadFromJsonAsync<FetcherUsageSnapshotsResponse>(DashboardJson.Options);
        var ours = FindByKey(payload!.Snapshots, adapterId, sourceId);
        Assert.NotNull(ours);
        Assert.Equal(4900, ours!.UpstreamUsed);
        Assert.Equal(100, ours.UpstreamRemaining);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 12. NFR-05 oracle — re-publish-on-tick recovers cache after API restart
    //
    // Drives the cross-OS docker-compose-from-test pattern. Compose-restart
    // forces the cache to empty; the next POST re-warms it; GET reflects
    // the re-warmed state. SKIPped when docker is not on PATH or when the
    // target is not local (NoTeardown / dev / cloud configs).
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RePublishOnTick_RestoresCache_AfterApiRestart()
    {
        if (!IsLocalTarget())
        {
            // Skipping non-local — the docker-compose path is local-stack only.
            return;
        }
        if (!IsDockerAvailable())
        {
            // Skipping headless / restricted environment.
            return;
        }

        var (adapterId, sourceId) = UniqueKey("nfr05");

        // Seed: POST a snapshot we'll then look for after restart.
        var snapshot = NewValidSnapshot(adapterId, sourceId, upstreamLimit: 5000, upstreamRemaining: 3000);
        var seedResp = await _authed.PostAsJsonAsync(UsagePath, snapshot, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.OK, seedResp.StatusCode);

        // Verify seeded.
        var pre = await _read.GetAsync(UsagePath);
        var prePayload = await pre.Content.ReadFromJsonAsync<FetcherUsageSnapshotsResponse>(DashboardJson.Options);
        Assert.NotNull(FindByKey(prePayload!.Snapshots, adapterId, sourceId));

        // Restart the api container via the local-dev compose file. Path is
        // resolved relative to repo-root; the runner sets CWD to the test
        // project's bin dir, so we walk up to repo root deterministically.
        RestartApiContainer();
        await WaitForHealth(deadline: TimeSpan.FromSeconds(45));

        // After restart, the in-memory cache is empty: the snapshot we
        // seeded above MUST no longer appear (ADR-0008 Decision 2 — cache
        // is replica-local and rebuildable, not durable).
        var post = await _read.GetAsync(UsagePath);
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);
        var postPayload = await post.Content.ReadFromJsonAsync<FetcherUsageSnapshotsResponse>(DashboardJson.Options);
        Assert.Null(FindByKey(postPayload!.Snapshots, adapterId, sourceId));

        // Re-publish: the fetcher's next-tick push (we simulate by re-POSTing
        // the snapshot) re-warms the cache. After this, GET reflects the
        // snapshot again — proves the re-publish-on-tick recovery contract.
        var rewarmSnapshot = NewValidSnapshot(adapterId, sourceId, upstreamLimit: 5000, upstreamRemaining: 2500);
        var rewarmResp = await _authed.PostAsJsonAsync(UsagePath, rewarmSnapshot, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.OK, rewarmResp.StatusCode);

        var final = await _read.GetAsync(UsagePath);
        var finalPayload = await final.Content.ReadFromJsonAsync<FetcherUsageSnapshotsResponse>(DashboardJson.Options);
        var ours = FindByKey(finalPayload!.Snapshots, adapterId, sourceId);
        Assert.NotNull(ours);
        Assert.Equal(2500, ours!.UpstreamRemaining);
        Assert.Equal(2500, ours.UpstreamUsed);
    }

    // ──────────────────────────────────────────────────────────────────────
    // helpers
    // ──────────────────────────────────────────────────────────────────────

    private static (string adapterId, string sourceId) UniqueKey(string tag)
    {
        var suffix = Guid.NewGuid().ToString("N").Substring(0, 12);
        return ($"github-actions-fn-{tag}", $"qa-bot/fn-{tag}-{suffix}");
    }

    private static FetcherUsageSnapshotRequest NewValidSnapshot(
        string adapterId,
        string sourceId,
        int upstreamLimit = 5000,
        int upstreamRemaining = 3247)
    {
        var now = DateTime.UtcNow;
        return new FetcherUsageSnapshotRequest
        {
            AdapterId = adapterId,
            SourceId = sourceId,
            UpstreamLimit = upstreamLimit,
            UpstreamRemaining = upstreamRemaining,
            UpstreamResetAt = now.AddMinutes(30),
            SelfImposedCap = 1500,
            UpstreamUsed = upstreamLimit - upstreamRemaining,
            ObservedAt = now,
        };
    }

    private static FetcherUsageSnapshotResponse? FindByKey(
        IReadOnlyList<FetcherUsageSnapshotResponse> snapshots,
        string adapterId,
        string sourceId)
    {
        foreach (var s in snapshots)
        {
            if (string.Equals(s.AdapterId, adapterId, StringComparison.Ordinal) &&
                string.Equals(s.SourceId, sourceId, StringComparison.Ordinal))
            {
                return s;
            }
        }
        return null;
    }

    private static bool IsLocalTarget()
    {
        var url = TestEnvironment.WriteBaseUrl ?? string.Empty;
        return url.Contains("localhost", StringComparison.OrdinalIgnoreCase)
            || url.Contains("127.0.0.1", StringComparison.Ordinal);
    }

    private static bool IsDockerAvailable()
    {
        try
        {
            var psi = new ProcessStartInfo("docker", "version")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi);
            if (p == null) return false;
            p.WaitForExit(5_000);
            return p.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private static void RestartApiContainer()
    {
        var composeFile = FindRepoRelative("dev_env/docker-compose.local.yml");
        var psi = new ProcessStartInfo("docker", $"compose --file \"{composeFile}\" restart api")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var p = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start docker compose restart");
        if (!p.WaitForExit(60_000))
        {
            try { p.Kill(true); } catch { /* best effort */ }
            throw new InvalidOperationException("docker compose restart timed out after 60 s.");
        }
        if (p.ExitCode != 0)
        {
            var err = p.StandardError.ReadToEnd();
            throw new InvalidOperationException($"docker compose restart exited {p.ExitCode}: {err}");
        }
    }

    private static async Task WaitForHealth(TimeSpan deadline)
    {
        using var client = TestEnvironment.CreateReadClient();
        client.Timeout = TimeSpan.FromSeconds(5);
        var stopAt = DateTime.UtcNow + deadline;
        while (DateTime.UtcNow < stopAt)
        {
            try
            {
                var r = await client.GetAsync("/health");
                if ((int)r.StatusCode >= 200 && (int)r.StatusCode < 500)
                {
                    return;
                }
            }
            catch
            {
                // expected during restart window
            }
            await Task.Delay(500);
        }
        throw new InvalidOperationException(
            $"API /health did not become reachable within {deadline.TotalSeconds} s after restart.");
    }

    /// <summary>
    /// Walk up from the test assembly's directory to repo root (marked by
    /// the presence of <c>dev_env/</c>) and return the absolute path to
    /// the supplied repo-relative file.
    /// </summary>
    private static string FindRepoRelative(string relativePath)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "dev_env")))
            {
                return Path.Combine(dir.FullName, relativePath);
            }
            dir = dir.Parent;
        }
        throw new InvalidOperationException(
            "Could not locate repo root (dev_env/ marker) from " + AppContext.BaseDirectory);
    }
}
