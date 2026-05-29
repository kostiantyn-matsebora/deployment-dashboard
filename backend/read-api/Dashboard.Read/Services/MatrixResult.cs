using Dashboard.Read.Models;

namespace Dashboard.Read.Services;

/// <summary>
/// Holds the computed matrix snapshot and its associated weak ETag.
/// </summary>
internal sealed record MatrixResult(MatrixResponse Matrix, string ETag);
