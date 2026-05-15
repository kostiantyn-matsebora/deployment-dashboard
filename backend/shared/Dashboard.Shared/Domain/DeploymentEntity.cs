using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Dashboard.Shared.Domain;

/// <summary>
/// EF Core entity for the <c>deployments</c> table (SAD §7 "Data Model").
/// Append-only: every successful ingest produces exactly one new row; old
/// rows are removed only by the daily retention job.
///
/// <para><see cref="DeploymentId"/> is the CI/CD-side identifier (e.g. run
/// id, build number, guid) — the referent for <see cref="ParentDeployments"/>
/// and the deduplication key enforced by the
/// <c>UNIQUE (service, deployment_id)</c> index. It is intentionally distinct
/// from the internal surrogate <see cref="Id"/>.</para>
///
/// <para><see cref="ParentDeployments"/> holds zero or more
/// <c>deployment_id</c> values of upstream deployments in the same
/// <see cref="Service"/>. The Read API's topology builder resolves each
/// entry to its source row on every matrix read (SAD §5 "Topology
/// Derivation"). The persistence shape differs by provider —
/// <c>text[]</c> on PostgreSQL, JSON-encoded array on SQLite — so the
/// <c>DashboardDbContext</c> configures the column conditionally.</para>
/// </summary>
[Table("deployments")]
public sealed class DeploymentEntity
{
    [Column("id")]
    public long Id { get; set; }

    [Column("deployment_id")]
    public string DeploymentId { get; set; } = string.Empty;

    [Column("service")]
    public string Service { get; set; } = string.Empty;

    [Column("environment")]
    public string Environment { get; set; } = string.Empty;

    [Column("version")]
    public string Version { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("run_url")]
    public string RunUrl { get; set; } = string.Empty;

    [Column("run_number")]
    public long RunNumber { get; set; }

    [Column("actor")]
    public string Actor { get; set; } = string.Empty;

    [Column("deployed_at")]
    public DateTime DeployedAt { get; set; }

    /// <summary>
    /// Optional source identifier (SAD §7 data model row <c>ref</c> + FR-05).
    /// Free-form string — branch name, PR number, tag, or any human-readable
    /// git ref. Independently nullable; <c>null</c> when the caller omitted
    /// or explicitly null-ed the property on ingest. No length or format
    /// constraint at this stage; stricter validation is a deferred follow-up
    /// (SAD §10 Decision 10).
    /// </summary>
    [Column("ref")]
    public string? Ref { get; set; }

    /// <summary>
    /// Optional commit SHA (SAD §7 data model row <c>sha</c> + FR-05). Free-form
    /// string. Independently nullable; <c>null</c> when the caller omitted or
    /// explicitly null-ed the property on ingest. No length or format
    /// constraint at this stage (not required to be hex, not bounded to 7/40
    /// chars); stricter validation is a deferred follow-up (SAD §10
    /// Decision 10).
    /// </summary>
    [Column("sha")]
    public string? Sha { get; set; }

    /// <summary>
    /// Explicit topology references (SAD §5 "Topology Derivation"). Each
    /// element is a <c>deployment_id</c> within the same <see cref="Service"/>.
    /// Empty (never null on the wire) means "fall back to the correlation
    /// pass". Stored as <c>text[]</c> on PostgreSQL and as a JSON-encoded
    /// array on SQLite — see <c>DashboardDbContext.OnModelCreating</c>.
    /// </summary>
    [Column("parent_deployments")]
    public List<string> ParentDeployments { get; set; } = new();
}
