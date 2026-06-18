namespace Dashboard.Shared.Entities;

/// <summary>
/// One row in the append-only <c>deployment_events</c> log.
/// Multiple rows may share <c>DeploymentId</c> (one per status transition).
/// </summary>
public sealed class DeploymentEvent
{
    /// <summary>Server-assigned UUIDv7 surrogate — also the SSE resume cursor.</summary>
    public Guid Id { get; set; }

    /// <summary>Emitter-supplied correlation key grouping all events of one logical deployment.</summary>
    public required string DeploymentId { get; set; }

    public required string Service { get; set; }

    /// <summary>CI/CD-agnostic grouping prefix. For GitHub, the repository short name (owner/repo → repo). Max 128 chars. Null when not supplied by the emitter.</summary>
    public string? Namespace { get; set; }

    public required string Environment { get; set; }

    /// <summary>Free-form version string (semver, SHA, build number). Max 50 chars.</summary>
    public string? Version { get; set; }

    /// <summary>One of <see cref="DeploymentStatus"/> constants.</summary>
    public required string Status { get; set; }

    /// <summary>Emitter-supplied UTC wall-clock at which the deployment transitioned to <see cref="Status"/>.</summary>
    public required DateTimeOffset HappenedAt { get; set; }

    /// <summary>Link to the CI/CD run. Max 2048 chars.</summary>
    public string? RunUrl { get; set; }

    /// <summary>CI/CD run identifier. Tool-specific format; stored verbatim, never parsed. Max 128 chars.</summary>
    public string? RunNumber { get; set; }

    /// <summary>Identity of the actor who triggered the deployment. Max 128 chars.</summary>
    public string? Actor { get; set; }

    /// <summary>Opaque git ref (branch, tag, PR ref). Not parsed. Max 256 chars.</summary>
    public string? Ref { get; set; }

    /// <summary>Opaque commit SHA. Not parsed. Max 128 chars.</summary>
    public string? Sha { get; set; }

    /// <summary>
    /// Explicit upstream <c>deployment_id</c> correlation keys for client-side DAG rendering.
    /// Stored verbatim; not resolved at ingest time. Max 32 entries.
    /// </summary>
    public string[]? ParentDeployments { get; set; }

    /// <summary>Value of <c>X-Progress-Reporter</c> header, if supplied. Never treated as authoritative actor.</summary>
    public string? ProgressReporter { get; set; }
}
