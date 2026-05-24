using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Resolves the live Read/Write API URLs, the API key, the mock-gha admin
/// base URL, and the fetcher's configured source-ids strictly from
/// environment variables set by <c>testing/integration/run-tests.ps1</c>,
/// which loads them from a declarative JSON config file under
/// <c>testing/config/</c> (default <c>testing/config/integration.json</c>).
///
/// <para>Per the project's "Engineering principles" (CLAUDE.md):
/// configuration is declarative and never lives as literals in test source.
/// If an env var is missing the run fails fast with a clear pointer at the
/// runner rather than silently targeting the wrong stack.</para>
///
/// <para>Hard rule (per WBS §3.2 + CR-0012 § 3b): no
/// <c>WebApplicationFactory</c>, no in-process mocks for the dashboard
/// stack. These tests speak HTTP to the real binaries; the only mocked
/// surface is the upstream GHA API, replaced by the <c>mock-gha</c>
/// JVM WireMock service under the <c>integration</c> compose profile.</para>
/// </summary>
internal static class TestEnvironment
{
    public static string ReadBaseUrl => Required("DASHBOARD_READ_BASE_URL");

    public static string WriteBaseUrl => Required("DASHBOARD_WRITE_BASE_URL");

    public static string ApiKey => Required("DASHBOARD_API_KEY");

    /// <summary>
    /// Host-published base URL of the JVM WireMock admin API
    /// (e.g. <c>http://localhost:18080</c>). Strict per CR-0012 § Profile-
    /// gating contract: published ONLY under the <c>integration</c> compose
    /// profile; never in production.
    /// </summary>
    public static string MockGhaAdminBaseUrl => Required("MOCK_GHA_ADMIN_BASE_URL");

    /// <summary>
    /// The <c>owner/repo</c> source-ids the fetcher polls under the
    /// integration profile, parsed from the <c>FETCHER_SOURCE_IDS</c> env
    /// var (JSON array of strings — matches the
    /// <c>fetcherSourceIds</c> key in <c>integration.json</c>). Scenario
    /// mappings whose URL pattern targets a specific <c>owner/repo</c> must
    /// match one of these entries.
    /// </summary>
    public static IReadOnlyList<string> FetcherSourceIds
    {
        get
        {
            var raw = Required("FETCHER_SOURCE_IDS");
            try
            {
                using var doc = JsonDocument.Parse(raw);
                if (doc.RootElement.ValueKind != JsonValueKind.Array)
                {
                    throw new InvalidOperationException(
                        $"FETCHER_SOURCE_IDS must be a JSON array of strings; got '{raw}'.");
                }
                var ids = new List<string>(doc.RootElement.GetArrayLength());
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    if (el.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(el.GetString()))
                    {
                        throw new InvalidOperationException(
                            "FETCHER_SOURCE_IDS array entries must be non-empty strings.");
                    }
                    ids.Add(el.GetString()!);
                }
                if (ids.Count == 0)
                {
                    throw new InvalidOperationException(
                        "FETCHER_SOURCE_IDS must contain at least one source-id.");
                }
                return ids;
            }
            catch (JsonException ex)
            {
                throw new InvalidOperationException(
                    $"FETCHER_SOURCE_IDS is not valid JSON: '{raw}'.", ex);
            }
        }
    }

    /// <summary>
    /// First (typically only) source-id from <see cref="FetcherSourceIds"/>.
    /// Convenience for scenarios that target the canonical single repo.
    /// </summary>
    public static string PrimarySourceId => FetcherSourceIds[0];

    /// <summary>
    /// Split <see cref="PrimarySourceId"/> into <c>(owner, repo)</c>.
    /// Mirrors <c>GitHubActionsAdapter.TrySplitOwnerRepo</c> semantics so
    /// fixture mappings can be templated against the same shape.
    /// </summary>
    public static (string Owner, string Repo) PrimaryOwnerRepo
    {
        get
        {
            var id = PrimarySourceId;
            var idx = id.IndexOf('/');
            if (idx <= 0 || idx == id.Length - 1)
            {
                throw new InvalidOperationException(
                    $"FETCHER_SOURCE_IDS[0] '{id}' is not in the canonical 'owner/repo' shape.");
            }
            return (id[..idx], id[(idx + 1)..]);
        }
    }

    private static string Required(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException(
                $"{name} is not set — run tests via testing/integration/run-tests.ps1, not bare 'dotnet test'.");
        }
        return value;
    }

    /// <summary>
    /// Build an <see cref="HttpClient"/> pointed at the Read API and
    /// configured to accept JSON (no API key — read endpoints are
    /// unauthenticated per Decision §10 #1).
    /// </summary>
    public static HttpClient CreateReadClient()
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri(ReadBaseUrl),
            Timeout = TimeSpan.FromSeconds(15),
        };
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }

    /// <summary>
    /// Build an <see cref="HttpClient"/> pointed at the Write API with the
    /// <c>X-Api-Key</c> header pre-applied. Integration tests rarely need
    /// this — the fetcher is the writer — but a few cross-cutting
    /// scenarios poke the write surface directly.
    /// </summary>
    public static HttpClient CreateWriteClient()
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri(WriteBaseUrl),
            Timeout = TimeSpan.FromSeconds(15),
        };
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        client.DefaultRequestHeaders.Add("X-Api-Key", ApiKey);
        return client;
    }

    /// <summary>
    /// Build an <see cref="HttpClient"/> pointed at the JVM WireMock admin API.
    /// No auth — the WireMock admin surface is unauthenticated by design
    /// and reachable only under the integration profile (NFR-04 is
    /// preserved by the compose profile gate, not by admin-API auth).
    /// </summary>
    public static HttpClient CreateMockGhaAdminClient()
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri(MockGhaAdminBaseUrl),
            Timeout = TimeSpan.FromSeconds(15),
        };
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }
}
