namespace Dashboard.Shared.ServiceFiltering;

/// <summary>
/// Provider-agnostic API-tier service exclude filter (issue #348, <c>SERVICE_EXCLUDE</c>).
/// Matches against the opaque event identity <c>namespace/service</c>.
/// </summary>
/// <remarks>
/// <para><b>Pattern form (two variants):</b>
///   <list type="bullet">
///     <item>No <c>'/'</c> — glob-matched against <c>service</c> only (all namespaces).</item>
///     <item>Contains <c>'/'</c> — glob-matched against the composite <c>namespace/service</c>
///       identity; <c>'*'</c> spans <c>'/'</c> so <c>acme/*</c> matches <c>acme/api/checkout</c>.</item>
///   </list>
/// </para>
/// <para><b>Empty default:</b> empty <c>SERVICE_EXCLUDE</c> ⇒ exclude nothing.</para>
/// <para><b>Fast path:</b> when <see cref="IsEmpty"/> is true the matcher returns
///   <c>false</c> without any pattern evaluation (pass-all).</para>
/// </remarks>
public sealed class ServiceFilter
{
    // Each pattern is stored in its original form — no pre-splitting.
    // A pattern WITHOUT '/' is matched against `service` only (across all namespaces).
    // A pattern WITH '/' is matched against the composite identity `namespace/service`.
    private readonly IReadOnlyList<string> _patterns;

    /// <summary>A pass-all filter: no exclude patterns.</summary>
    public static readonly ServiceFilter PassAll = new([]);

    /// <summary>
    /// Returns <c>true</c> when this filter carries no patterns — every event passes and
    /// no in-memory matching is needed.
    /// </summary>
    public bool IsEmpty => _patterns.Count == 0;

    private ServiceFilter(IReadOnlyList<string> patterns)
    {
        _patterns = patterns;
    }

    /// <summary>
    /// Parses a CSV of <c>SERVICE_EXCLUDE</c> glob patterns.
    /// Each pattern is either:
    /// <list type="bullet">
    ///   <item><c>service</c> — no slash; glob-matched against the service name only (all namespaces).</item>
    ///   <item><c>namespace/service</c> — contains slash(es); glob-matched against the composite
    ///     <c>namespace/service</c> identity where <c>'*'</c> spans <c>'/'</c>.</item>
    /// </list>
    /// <c>null</c> or empty ⇒ <see cref="PassAll"/>.
    /// </summary>
    public static ServiceFilter Parse(string? serviceExcludeCsv)
    {
        if (string.IsNullOrWhiteSpace(serviceExcludeCsv))
            return PassAll;

        var patterns = serviceExcludeCsv
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        return patterns.Count == 0 ? PassAll : new ServiceFilter(patterns);
    }

    // ── Core exclude check ────────────────────────────────────────────────────

    /// <summary>
    /// Returns <c>true</c> when the event identified by the opaque
    /// <c>(namespace, service)</c> pair should be excluded.
    /// <list type="bullet">
    ///   <item>
    ///     Pattern WITHOUT <c>'/'</c> → glob-matched against <paramref name="service"/> only
    ///     (the event is excluded regardless of namespace).
    ///   </item>
    ///   <item>
    ///     Pattern WITH <c>'/'</c> → glob-matched against the composite identity
    ///     <c>namespace/service</c>; when <paramref name="namespace"/> is <c>null</c> or empty
    ///     the identity is just <paramref name="service"/> (leading slash omitted).
    ///   </item>
    /// </list>
    /// </summary>
    public bool IsExcluded(string service, string? @namespace)
    {
        if (IsEmpty) return false;

        // Build the composite identity: "namespace/service" or just "service" when namespace absent.
        var identity = string.IsNullOrEmpty(@namespace)
            ? service
            : $"{@namespace}/{service}";

        foreach (var pattern in _patterns)
        {
            if (pattern.Contains('/'))
            {
                // Pattern has a slash — match against the composite identity.
                if (Glob.Matches(pattern, identity))
                    return true;
            }
            else
            {
                // No slash — match against service name only.
                if (Glob.Matches(pattern, service))
                    return true;
            }
        }

        return false;
    }

    // ── Permits helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Returns <c>true</c> when the event should be visible (i.e., NOT excluded).
    /// </summary>
    public bool Permits(string service, string? @namespace) => !IsExcluded(service, @namespace);
}
