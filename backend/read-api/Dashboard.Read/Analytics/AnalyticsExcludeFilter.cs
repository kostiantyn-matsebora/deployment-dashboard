using Dashboard.Shared.Data;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Analytics;

/// <summary>
/// Encapsulates the SERVICE_EXCLUDE predicate for analytics queries.
/// Resolved once per instance (one scoped DI lifetime = one HTTP request) via a
/// cheap DISTINCT scan; subsequent calls reuse the cached result.
/// </summary>
internal sealed class AnalyticsExcludeFilter(ServiceFilter serviceFilter)
{
    private List<string>? _noNamespace;   // service names matched without a namespace
    private List<string>? _withNamespace; // "service|namespace" composite keys
    private bool _resolved;

    /// <summary>
    /// Returns <paramref name="source"/> unchanged when SERVICE_EXCLUDE is empty (fast path).
    /// Otherwise applies an EF-translatable predicate that keeps only events whose
    /// <c>(Service, Namespace)</c> pair is not excluded.
    /// </summary>
    internal IQueryable<Shared.Entities.DeploymentEvent> Apply(
        IQueryable<Shared.Entities.DeploymentEvent> source,
        DashboardDbContext db)
    {
        if (serviceFilter.IsEmpty)
            return source;

        EnsureResolved(db);

        if (_noNamespace!.Count == 0 && _withNamespace!.Count == 0)
            return source;

        return ApplyPredicate(source, _noNamespace!, _withNamespace!);
    }

    /// <summary>
    /// Applies an EF-translatable WHERE predicate that excludes the supplied pairs.
    /// Each non-empty branch is applied separately to avoid emitting untranslatable
    /// string-concatenation expressions on the SQLite test provider for empty lists.
    /// </summary>
    private static IQueryable<Shared.Entities.DeploymentEvent> ApplyPredicate(
        IQueryable<Shared.Entities.DeploymentEvent> source,
        List<string> noNs,
        List<string> withNs)
    {
        source = ApplyNoNamespacePredicate(source, noNs);
        source = ApplyWithNamespacePredicate(source, withNs);
        return source;
    }

    private static IQueryable<Shared.Entities.DeploymentEvent> ApplyNoNamespacePredicate(
        IQueryable<Shared.Entities.DeploymentEvent> source,
        List<string> noNs)
    {
        if (noNs.Count == 0)
            return source;

        return source.Where(e =>
            !(noNs.Contains(e.Service) && (e.Namespace == null || e.Namespace == "")));
    }

    private static IQueryable<Shared.Entities.DeploymentEvent> ApplyWithNamespacePredicate(
        IQueryable<Shared.Entities.DeploymentEvent> source,
        List<string> withNs)
    {
        if (withNs.Count == 0)
            return source;

        return source.Where(e => !withNs.Contains(e.Service + "|" + e.Namespace));
    }

    private void EnsureResolved(DashboardDbContext db)
    {
        if (_resolved)
            return;

        // Single DISTINCT scan over all (Service, Namespace) pairs — reads only those
        // two columns and deduplicates in the database engine.
        var excluded = db.DeploymentEvents
            .Select(e => new { e.Service, e.Namespace })
            .Distinct()
            .AsEnumerable()
            .Where(p => serviceFilter.IsExcluded(p.Service, p.Namespace))
            .ToList();

        _noNamespace = excluded
            .Where(p => string.IsNullOrEmpty(p.Namespace))
            .Select(p => p.Service)
            .ToList();

        _withNamespace = excluded
            .Where(p => !string.IsNullOrEmpty(p.Namespace))
            .Select(p => p.Service + "|" + p.Namespace)
            .ToList();

        _resolved = true;
    }
}
