using Dashboard.Shared.Entities;

namespace Dashboard.Read.Models;

/// <summary>
/// Response body for <c>GET /api/matrix</c>.
/// Serialised with the global snake_case policy:
/// <c>generated_at</c>, <c>environments</c>, <c>rows</c>.
/// </summary>
public sealed record MatrixResponse(
    DateTimeOffset GeneratedAt,
    IReadOnlyList<string> Environments,
    IReadOnlyList<MatrixRow> Rows);

/// <summary>
/// One row in the matrix — one service and its deployment slots per environment.
/// </summary>
public sealed record MatrixRow(
    string Service,
    IReadOnlyDictionary<string, MatrixSlot> Slots);

/// <summary>
/// One cell in the matrix — the current event and (when applicable) the last successful event.
/// <see cref="LastSuccessful"/> is omitted from JSON when <c>null</c> (global WhenWritingNull policy).
/// </summary>
public sealed record MatrixSlot(
    DeploymentEvent Current,
    DeploymentEvent? LastSuccessful);
