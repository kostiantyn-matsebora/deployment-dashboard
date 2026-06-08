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
        var effectivePerSlot = await repository.GetEffectivePerSlotAsync(serviceFilter, ct);
        var nonEffectivePerSlot = await repository.GetLatestNonEffectivePerSlotAsync(serviceFilter, ct);
        var lastSuccessfulPerSlot = await repository.GetLastSuccessfulPerSlotAsync(serviceFilter, ct);
        var latestTerminalBeforeCurrent = await repository.GetLatestTerminalBeforeCurrentPerSlotAsync(serviceFilter, ct);

        var effectiveLookup = effectivePerSlot
            .ToDictionary(e => (e.Service, e.Environment));
        var nonEffectiveLookup = nonEffectivePerSlot
            .ToDictionary(e => (e.Service, e.Environment));
        var successLookup = lastSuccessfulPerSlot
            .ToDictionary(e => (e.Service, e.Environment));
        var prevTerminalLookup = latestTerminalBeforeCurrent
            .ToDictionary(e => (e.Service, e.Environment));

        // All slots visible in the matrix: every slot that has at least one event of any kind.
        // Effective events are the primary source; non-effective events surface slots where
        // no effective event has ever been recorded (edge-case fallback).
        var allSlotKeys = effectiveLookup.Keys
            .Union(nonEffectiveLookup.Keys)
            .ToHashSet();

        var rows = allSlotKeys
            .GroupBy(k => k.Service)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => new MatrixRow(
                Service: g.Key,
                Slots: g.ToDictionary(
                    k => k.Environment,
                    k => BuildSlot(k, effectiveLookup, nonEffectiveLookup, successLookup, prevTerminalLookup),
                    StringComparer.Ordinal)))
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

    private static MatrixSlot BuildSlot(
        (string Service, string Environment) key,
        Dictionary<(string, string), DeploymentEvent> effectiveLookup,
        Dictionary<(string, string), DeploymentEvent> nonEffectiveLookup,
        Dictionary<(string, string), DeploymentEvent> successLookup,
        Dictionary<(string, string), DeploymentEvent> prevTerminalLookup)
    {
        effectiveLookup.TryGetValue(key, out var effective);
        nonEffectiveLookup.TryGetValue(key, out var nonEffective);

        DeploymentEvent current;
        DeploymentEvent? next;

        if (effective is not null)
        {
            current = effective;
            // Include next only when the non-effective event is strictly newer than the effective one.
            next = nonEffective is not null && nonEffective.HappenedAt > effective.HappenedAt
                ? nonEffective
                : null;
        }
        else
        {
            // Edge case: no effective deployment has ever been recorded for this slot.
            // The contract requires current to be populated, so fall back to the latest
            // non-effective event. next is omitted because there is no effective baseline
            // to compare against, and emitting current == next would be misleading.
            current = nonEffective!;
            next = null;
        }

        // Spec: last_successful is omitted when current IS already the last success.
        successLookup.TryGetValue(key, out var lastSuccessful);
        var resolvedLastSuccessful = current.Status == DeploymentStatus.Success ? null : lastSuccessful;

        // prev_failed: true when current is in-progress AND the latest terminal event
        // (success|failure) strictly older than current is a failure.
        // The guard on current.Status ensures semantics are preserved even if the
        // repository returns results for non-in-progress slots (defensive).
        prevTerminalLookup.TryGetValue(key, out var prevTerminal);
        var prevFailed = current.Status == DeploymentStatus.InProgress
                         && prevTerminal?.Status == DeploymentStatus.Failure;

        return new MatrixSlot(current, resolvedLastSuccessful, next, prevFailed);
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
            rows.OrderBy(r => r.Service, StringComparer.Ordinal)
                .SelectMany(r => r.Slots
                    .OrderBy(kv => kv.Key, StringComparer.Ordinal)
                    .Select(kv =>
                        $"{r.Service}/{kv.Key}={kv.Value.Current.Id}:{kv.Value.LastSuccessful?.Id}:{kv.Value.Next?.Id}\n")));

        var fingerprint = envPart + rowPart;
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint));
        return $"W/\"{Convert.ToHexString(hash)[..16].ToLowerInvariant()}\"";
    }
}
