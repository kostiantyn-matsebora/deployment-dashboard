namespace Dashboard.Read.Services;

internal interface IMatrixService
{
    /// <summary>
    /// Builds the full matrix snapshot (one slot per <c>service × environment</c>) and
    /// computes a stable weak ETag for <c>If-None-Match</c> short-circuiting.
    /// </summary>
    Task<MatrixResult> GetMatrixAsync(string? serviceFilter, CancellationToken ct);
}
