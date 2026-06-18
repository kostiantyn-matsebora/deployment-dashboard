using System.Security.Cryptography;
using System.Text;
using Dashboard.Read.Models;
using Dashboard.Read.Repositories;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Entities;

namespace Dashboard.Read.Services;

/// <summary>
/// Assembles the matrix response from repository data and computes its weak ETag.
/// Pure application logic — no direct DB access.
/// </summary>
internal sealed class MatrixService(IDeploymentReadRepository repository) : IMatrixService
{
    public async Task<MatrixResult> GetMatrixAsync(string? serviceFilter, CancellationToken ct)
    {
        var lookups = await FetchLookupsAsync(serviceFilter, ct);

        // All slots visible in the matrix: every slot that has at least one event of any kind.
        // Effective events are the primary source; non-effective events surface slots where
        // no effective event has ever been recorded (edge-case fallback).
        // Slot identity is (Namespace, Service, Environment) — the same namespace+service
        // combination in two namespaces produces two distinct rows.
        var allSlotKeys = lookups.Effective.Keys
            .Union(lookups.NonEffective.Keys)
            .ToHashSet();

        var rows = allSlotKeys
            .GroupBy(k => (k.Namespace, k.Service))
            .OrderBy(g => g.Key.Namespace, StringComparer.Ordinal)
            .ThenBy(g => g.Key.Service, StringComparer.Ordinal)
            .Select(g => new MatrixRow(
                Service: g.Key.Service,
                Slots: g.ToDictionary(
                    k => k.Environment,
                    k => BuildSlot(k, lookups),
                    StringComparer.Ordinal),
                Namespace: g.Key.Namespace))
            .ToList<MatrixRow>();

        var environments = allSlotKeys
            .Select(k => k.Environment)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();

        var etag = ComputeETag(rows, environments);

        var matrix = new MatrixResponse(
            GeneratedAt: DateTimeOffset.UtcNow,
            Environments: environments,
            Rows: rows);

        return new MatrixResult(matrix, etag);
    }

    private async Task<SlotLookups> FetchLookupsAsync(string? serviceFilter, CancellationToken ct)
    {
        var effectivePerSlot = await repository.GetEffectivePerSlotAsync(serviceFilter, ct);
        var nonEffectivePerSlot = await repository.GetLatestNonEffectivePerSlotAsync(serviceFilter, ct);
        var lastSuccessfulPerSlot = await repository.GetLastSuccessfulPerSlotAsync(serviceFilter, ct);
        var latestTerminalBeforeCurrent = await repository.GetLatestTerminalBeforeCurrentPerSlotAsync(serviceFilter, ct);

        return new SlotLookups(
            Effective: effectivePerSlot.ToDictionary(e => (e.Namespace, e.Service, e.Environment)),
            NonEffective: nonEffectivePerSlot.ToDictionary(e => (e.Namespace, e.Service, e.Environment)),
            Success: lastSuccessfulPerSlot.ToDictionary(e => (e.Namespace, e.Service, e.Environment)),
            PrevTerminal: latestTerminalBeforeCurrent.ToDictionary(e => (e.Namespace, e.Service, e.Environment)));
    }

    private static MatrixSlot BuildSlot(
        (string? Namespace, string Service, string Environment) key,
        SlotLookups lookups)
    {
        var (current, next) = ResolveCurrentAndNext(key, lookups.Effective, lookups.NonEffective);
        var lastSuccessful = ResolveLastSuccessful(key, current, lookups.Success);
        var prevFailed = ResolvePrevFailed(key, current, lookups.PrevTerminal);

        return new MatrixSlot(current, lastSuccessful, next, prevFailed);
    }

    private static (DeploymentEvent Current, DeploymentEvent? Next) ResolveCurrentAndNext(
        (string? Namespace, string Service, string Environment) key,
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> effectiveLookup,
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> nonEffectiveLookup)
    {
        effectiveLookup.TryGetValue(key, out var effective);
        nonEffectiveLookup.TryGetValue(key, out var nonEffective);

        if (effective is not null)
        {
            // Include next only when the non-effective event is strictly newer than the effective one.
            var next = nonEffective is not null && nonEffective.HappenedAt > effective.HappenedAt
                ? nonEffective
                : null;
            return (effective, next);
        }

        // Edge case: no effective deployment has ever been recorded for this slot.
        // The contract requires current to be populated, so fall back to the latest
        // non-effective event. next is omitted because there is no effective baseline
        // to compare against, and emitting current == next would be misleading.
        return (nonEffective!, null);
    }

    private static DeploymentEvent? ResolveLastSuccessful(
        (string? Namespace, string Service, string Environment) key,
        DeploymentEvent current,
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> successLookup)
    {
        // Spec: last_successful is omitted when current IS already the last success.
        successLookup.TryGetValue(key, out var lastSuccessful);
        return current.Status == DeploymentStatus.Success ? null : lastSuccessful;
    }

    private static bool ResolvePrevFailed(
        (string? Namespace, string Service, string Environment) key,
        DeploymentEvent current,
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> prevTerminalLookup)
    {
        // prev_failed: true when current is in-progress AND the latest terminal event
        // (success|failure) strictly older than current is a failure.
        // The guard on current.Status ensures semantics are preserved even if the
        // repository returns results for non-in-progress slots (defensive).
        prevTerminalLookup.TryGetValue(key, out var prevTerminal);
        return current.Status == DeploymentStatus.InProgress
               && prevTerminal?.Status == DeploymentStatus.Failure;
    }

    /// <summary>
    /// Computes a stable SHA-256 fingerprint of the slot contents (current, last_successful,
    /// and next event IDs, sorted deterministically). Does NOT include <c>generated_at</c>,
    /// which changes on every request. This ensures the ETag is stable for unchanged data.
    /// </summary>
    private static string ComputeETag(
        IReadOnlyList<MatrixRow> rows,
        IReadOnlyList<string> environments)
    {
        var envPart = string.Concat(
            environments.OrderBy(e => e, StringComparer.Ordinal)
                .Select(e => e + "|"));

        var rowPart = string.Concat(
            rows.OrderBy(r => r.Namespace, StringComparer.Ordinal)
                .ThenBy(r => r.Service, StringComparer.Ordinal)
                .SelectMany(r => r.Slots
                    .OrderBy(kv => kv.Key, StringComparer.Ordinal)
                    .Select(kv =>
                        $"{r.Namespace}/{r.Service}/{kv.Key}={kv.Value.Current.Id}:{kv.Value.LastSuccessful?.Id}:{kv.Value.Next?.Id}\n")));

        var fingerprint = envPart + rowPart;
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint));
        return $"W/\"{Convert.ToHexString(hash)[..16].ToLowerInvariant()}\"";
    }

    private readonly record struct SlotLookups(
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> Effective,
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> NonEffective,
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> Success,
        Dictionary<(string? Namespace, string Service, string Environment), DeploymentEvent> PrevTerminal);
}
