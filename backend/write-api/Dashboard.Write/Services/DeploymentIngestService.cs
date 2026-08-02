using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Dashboard.Shared.Identifiers;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Write.Services;

/// <summary>
/// Result of a single ingest call: the persisted (or pre-existing) event and whether it
/// was newly created (<c>true</c>) or was a duplicate replay (<c>false</c>).
/// </summary>
internal sealed record IngestResult(DeploymentEvent Event, bool Created);

/// <summary>
/// Application service that persists one ingest body as a new <see cref="DeploymentEvent"/>
/// row and triggers the post-commit notification.
///
/// Idempotent: if the natural key (deployment_id, status, happened_at) already exists the
/// unique-constraint violation is caught, the pre-existing row is returned, and no SSE
/// notification is emitted (the subscriber already received it on the first ingest).
/// </summary>
internal sealed class DeploymentIngestService(
    DashboardDbContext dbContext,
    IDeploymentNotifier notifier) : IDeploymentIngestService
{
    public async Task<IngestResult> IngestAsync(
        DeploymentEventIngest body,
        string? progressReporter,
        CancellationToken ct)
    {
        var ev = MapToEntity(body, progressReporter);
        dbContext.DeploymentEvents.Add(ev);
        try
        {
            await dbContext.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Duplicate ingest: detach the tracked-but-not-saved entity and return the
            // pre-existing row.  No SSE notification — the subscriber already has it.
            dbContext.Entry(ev).State = EntityState.Detached;
            var existing = await dbContext.DeploymentEvents
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    e => e.DeploymentId == body.DeploymentId
                         && e.Status == body.Status
                         && e.HappenedAt == body.HappenedAt,
                    ct);
            return new IngestResult(existing ?? ev, Created: false);
        }

        await notifier.NotifyAsync(ev.Id, ct);
        return new IngestResult(ev, Created: true);
    }

    /// <summary>
    /// Returns true when <paramref name="ex"/> represents a unique-constraint violation.
    /// Inspects the inner exception without taking a direct provider dependency so the
    /// Write project stays provider-agnostic (neither Npgsql nor SQLite is referenced here).
    ///
    /// Detection strategy:
    /// <list type="bullet">
    ///   <item>Npgsql (<c>PostgresException</c>): <c>SqlState == "23505"</c> (UNIQUE_VIOLATION).</item>
    ///   <item>SQLite (<c>SqliteException</c>): <c>SqliteExtendedErrorCode == 2067</c>
    ///         (SQLITE_CONSTRAINT_UNIQUE); falls back to <c>SqliteErrorCode == 19</c>
    ///         (SQLITE_CONSTRAINT) when the extended property is absent.</item>
    /// </list>
    /// </summary>
    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        var inner = ex.InnerException;
        if (inner is null) return false;

        var type = inner.GetType();

        // Npgsql: PostgresException.SqlState "23505" = UNIQUE_VIOLATION
        var sqlStateProp = type.GetProperty("SqlState");
        if (sqlStateProp?.GetValue(inner) is string sqlState)
            return sqlState == "23505";

        // SQLite: SqliteException.SqliteExtendedErrorCode 2067 = SQLITE_CONSTRAINT_UNIQUE
        var extCodeProp = type.GetProperty("SqliteExtendedErrorCode");
        if (extCodeProp?.GetValue(inner) is int extCode)
            return extCode == 2067;

        // SQLite fallback: SqliteErrorCode 19 = SQLITE_CONSTRAINT (any constraint violation)
        var errCodeProp = type.GetProperty("SqliteErrorCode");
        if (errCodeProp?.GetValue(inner) is int errCode)
            return errCode == 19;

        return false;
    }

    private static DeploymentEvent MapToEntity(DeploymentEventIngest body, string? progressReporter) =>
        new()
        {
            Id = MonotonicGuid.CreateVersion7(),
            DeploymentId = body.DeploymentId,
            Service = body.Service,
            Namespace = body.Namespace,
            Environment = body.Environment,
            Version = body.Version,
            Status = body.Status,
            HappenedAt = body.HappenedAt,
            RunUrl = body.RunUrl,
            RunNumber = body.RunNumber,
            Actor = body.Actor,
            Ref = body.Ref,
            Sha = body.Sha,
            ParentDeployments = body.ParentDeployments,
            ProgressReporter = progressReporter,
        };
}
