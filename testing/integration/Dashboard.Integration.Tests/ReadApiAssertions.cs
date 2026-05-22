using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Helpers for polling the Read API until a scenario-driven matrix
/// invariant holds. The integration suite asserts the write path via the
/// Read-side echo (CR-0012 FR-06 assertion seam — Option b); these
/// helpers encapsulate the "poll-with-deadline" idiom shared by every
/// state test.
///
/// <para>The poll cadence is intentionally tight (250 ms) — the fetcher
/// poll-interval under the integration profile is <c>1 s</c> per CR-0012
/// § 3b, so a 250 ms read-side poll guarantees the matrix view is
/// observed within one fetcher-tick boundary.</para>
/// </summary>
public static class ReadApiAssertions
{
    private static readonly TimeSpan DefaultPollInterval = TimeSpan.FromMilliseconds(250);

    /// <summary>
    /// Poll <c>GET /api/deployments</c> until the matrix slot at
    /// <c>matrix[service].envs[environment]</c> satisfies
    /// <paramref name="predicate"/>, or <paramref name="budget"/> expires.
    /// Returns the matching slot JSON envelope on success; null on
    /// timeout.
    /// </summary>
    public static async Task<JsonElement?> WaitForSlotAsync(
        string service,
        string environment,
        Func<JsonElement, bool> predicate,
        TimeSpan budget,
        CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + budget;
        using var client = TestEnvironment.CreateReadClient();
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            try
            {
                using var resp = await client.GetAsync("/api/deployments", ct);
                if (resp.IsSuccessStatusCode)
                {
                    var body = await resp.Content.ReadAsStringAsync(ct);
                    using var doc = JsonDocument.Parse(body);
                    if (TryGetSlot(doc.RootElement, service, environment, out var slot))
                    {
                        if (predicate(slot))
                        {
                            // Re-parse so the returned JsonElement outlives
                            // the using-scoped JsonDocument.
                            return JsonDocument.Parse(slot.GetRawText()).RootElement;
                        }
                    }
                }
            }
            catch (HttpRequestException) { /* swallow and retry */ }

            var remaining = deadline - DateTime.UtcNow;
            var wait = remaining < DefaultPollInterval ? remaining : DefaultPollInterval;
            if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
        }
        return null;
    }

    /// <summary>
    /// Fetch the history (newest-first) for one slot via
    /// <c>GET /api/deployments/{service}/{environment}/history?limit={N}</c>.
    /// Returns the parsed array element. Throws on non-2xx.
    /// </summary>
    public static async Task<JsonDocument> GetHistoryAsync(
        string service, string environment, int limit = 50, CancellationToken ct = default)
    {
        using var client = TestEnvironment.CreateReadClient();
        var path = $"/api/deployments/{Uri.EscapeDataString(service)}/{Uri.EscapeDataString(environment)}/history?limit={limit}";
        using var resp = await client.GetAsync(path, ct);
        resp.EnsureSuccessStatusCode();
        var stream = await resp.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }

    /// <summary>
    /// Convenience around <see cref="WaitForSlotAsync"/> — wait for the
    /// slot to exist (any predicate-passing value). Useful for "fetcher
    /// has produced at least one event for this slot" assertions.
    /// </summary>
    public static Task<JsonElement?> WaitForSlotPresenceAsync(
        string service, string environment, TimeSpan budget, CancellationToken ct = default)
        => WaitForSlotAsync(service, environment, _ => true, budget, ct);

    private static bool TryGetSlot(
        JsonElement root, string service, string environment, out JsonElement slot)
    {
        slot = default;
        if (root.ValueKind != JsonValueKind.Object) return false;
        if (!root.TryGetProperty(service, out var svc) || svc.ValueKind != JsonValueKind.Object) return false;
        if (!svc.TryGetProperty("envs", out var envs) || envs.ValueKind != JsonValueKind.Object) return false;
        if (!envs.TryGetProperty(environment, out var s) || s.ValueKind != JsonValueKind.Object) return false;
        slot = s;
        return true;
    }
}
