using Dashboard.Shared.Domain;

namespace Dashboard.Shared.Topology;

/// <summary>
/// Data-driven extractor for the value of a correlation attribute on a
/// <see cref="DeploymentEntity"/>. SAD §5 "Topology Derivation" pass 3
/// requires comparing <c>P.&lt;correlation-attribute&gt;</c> against
/// <c>D.&lt;correlation-attribute&gt;</c> as case-sensitive string equality;
/// this class is the single source of truth for that lookup.
///
/// <para>Allowed names per SAD §7 "Configuration — Read API topology":
/// <c>version</c>, <c>ref</c>, <c>sha</c>, <c>actor</c>, <c>run</c>,
/// <c>ago</c>. <c>id</c> is explicitly rejected (using it as a correlation
/// attribute would degenerate to "explicit only" — a contract violation).</para>
///
/// <para>For MVP the resolvable set is the subset that exists on the
/// entity today: <c>version</c>, <c>actor</c>, <c>run</c>, <c>ref</c>,
/// <c>sha</c>. The <c>ref</c> and <c>sha</c> columns are nullable strings;
/// a deployment whose chosen attribute is <c>null</c> resolves to
/// <see cref="UnresolvableValue"/>, which never matches any candidate
/// parent — the resulting topology degenerates to "explicit only" for
/// that deployment, which is the safe failure mode. The remaining key
/// (<c>ago</c>) is a SAD-allowed name whose semantics are not yet
/// defined; requests to use it return <see cref="UnresolvableValue"/> for
/// every deployment.</para>
/// </summary>
public static class CorrelationAttribute
{
    public const string Version = "version";
    public const string Ref = "ref";
    public const string Sha = "sha";
    public const string Actor = "actor";
    public const string Run = "run";
    public const string Ago = "ago";

    /// <summary>Reserved sentinel — never equal to any real value.</summary>
    public const string UnresolvableValue = "\0__unresolvable__\0";

    /// <summary>
    /// Names accepted by <c>PATCH /api/config/topology</c> (SAD §7). The
    /// SAD-allowed set; <c>id</c> is excluded by design.
    /// </summary>
    public static readonly IReadOnlySet<string> Allowed =
        new HashSet<string>(StringComparer.Ordinal) { Version, Ref, Sha, Actor, Run, Ago };

    /// <summary>True when <paramref name="name"/> is allowed by the SAD.</summary>
    public static bool IsAllowed(string? name) =>
        !string.IsNullOrWhiteSpace(name) && Allowed.Contains(name);

    /// <summary>
    /// Return the correlation value for the given deployment. Unsupported
    /// (but SAD-allowed) attributes return <see cref="UnresolvableValue"/>;
    /// unknown attributes throw <see cref="ArgumentOutOfRangeException"/>
    /// so misconfiguration surfaces at boot time, not silently as missing
    /// edges.
    /// </summary>
    public static string Resolve(DeploymentEntity e, string attribute) => attribute switch
    {
        Version => e.Version,
        Actor => e.Actor,
        // run_number is the GitHub Actions integer; SAD pass 3 stringifies.
        Run => e.RunNumber.ToString(System.Globalization.CultureInfo.InvariantCulture),

        // FR-05: ref and sha are stored as nullable strings on the entity.
        // A deployment whose chosen attribute is null cannot match any
        // candidate parent — we return the sentinel so the correlation pass
        // emits no edge for it (safe failure mode), exactly as it would for
        // a still-unresolved attribute.
        Ref => string.IsNullOrEmpty(e.Ref) ? UnresolvableValue : e.Ref,
        Sha => string.IsNullOrEmpty(e.Sha) ? UnresolvableValue : e.Sha,

        // ago is a SAD-allowed name whose semantics are not yet defined
        // (no backing field on the wire); returning the sentinel ensures the
        // correlation pass produces no edges for it (safe failure mode)
        // rather than crashing.
        Ago => UnresolvableValue,

        _ => throw new ArgumentOutOfRangeException(
            nameof(attribute), attribute, $"Unknown correlation attribute '{attribute}'."),
    };
}
