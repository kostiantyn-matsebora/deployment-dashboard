using System;
using System.Net.Http;
using System.Net.Http.Headers;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Resolves the live Read/Write API URLs and the API key strictly from
/// environment variables set by <c>testing/functional/run-tests.ps1</c>,
/// which loads them from a declarative JSON config file under
/// <c>testing/config/</c> (default <c>testing/config/local.json</c>).
///
/// <para>Per the project's "Engineering principles" (CLAUDE.md):
/// configuration is declarative and never lives as literals in test source.
/// If an env var is missing the run fails fast with a clear pointer at the
/// runner rather than silently targeting the wrong stack.</para>
///
/// <para>Hard rule (per WBS §3.2 + qa-engineer agent definition): no
/// <c>WebApplicationFactory</c>, no mocks. These tests speak HTTP to the
/// real binaries.</para>
/// </summary>
internal static class TestEnvironment
{
    public static string ReadBaseUrl => Required("DASHBOARD_READ_BASE_URL");

    public static string WriteBaseUrl => Required("DASHBOARD_WRITE_BASE_URL");

    public static string ApiKey => Required("DASHBOARD_API_KEY");

    private static string Required(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException(
                $"{name} is not set — run tests via testing/functional/run-tests.ps1, not bare 'dotnet test'.");
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
    /// <c>X-Api-Key</c> header pre-applied. Tests that exercise auth
    /// rejection should build their own bare client instead.
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
    /// Build an <see cref="HttpClient"/> for the Write API with NO
    /// authentication. Use this for the 401-path test cases.
    /// </summary>
    public static HttpClient CreateUnauthenticatedWriteClient()
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri(WriteBaseUrl),
            Timeout = TimeSpan.FromSeconds(15),
        };
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return client;
    }
}
