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
        var currentPerSlot = await repository.GetCurrentPerSlotAsync(serviceFilter, ct);
        var lastSuccessfulPerSlot = await repository.GetLastSuccessfulPerSlotAsync(serviceFilter, ct);

        var successLookup = lastSuccessfulPerSlot
            .ToDictionary(e => (e.Service, e.Environment));

        var rows = currentPerSlot
            .GroupBy(e => e.Service)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => new MatrixRow(
                Service: g.Key,
                Slots: g.ToDictionary(
                    e => e.Environment,
                    e => BuildSlot(e, successLookup),
                    StringComparer.Ordinal)))
            .ToList<MatrixRow>();

        var environments = currentPerSlot
            .Select(e => e.Environment)
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
        DeploymentEvent current,
        Dictionary<(string Service, string Environment), DeploymentEvent> successLookup)
    {
        // Spec: last_successful is omitted when current IS already the last success.
        if (current.Status == DeploymentStatus.Success)
            return new MatrixSlot(current, LastSuccessful: null);

        successLookup.TryGetValue((current.Service, current.Environment), out var lastSuccessful);
        return new MatrixSlot(current, lastSuccessful);
    }

    /// <summary>
    /// Computes a stable SHA-256 fingerprint of the slot contents (current and last_successful
    /// event IDs, sorted deterministically). Does NOT include <c>generated_at</c>, which changes
    /// on every request. This ensures the ETag is stable for unchanged data.
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
                        $"{r.Service}/{kv.Key}={kv.Value.Current.Id}:{kv.Value.LastSuccessful?.Id}\n")));

        var fingerprint = envPart + rowPart;
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint));
        return $"W/\"{Convert.ToHexString(hash)[..16].ToLowerInvariant()}\"";
    }
}
