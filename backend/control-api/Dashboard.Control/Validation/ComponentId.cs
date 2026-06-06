using System.Text.RegularExpressions;

namespace Dashboard.Control.Validation;

/// <summary>
/// Rules for the <c>X-Component-Id</c> header (D9): an identity token (not a secret)
/// stored verbatim as <c>component_id</c>. Pattern per the OpenAPI contract.
/// </summary>
internal static partial class ComponentId
{
    public const string HeaderName = "X-Component-Id";

    /// <summary>Optional correlation-id header; opaque ≤ 128 chars (D9, §5.10.4).</summary>
    public const string CorrelationIdHeaderName = "X-Correlation-Id";

    /// <summary>Max allowed length for the <c>X-Correlation-Id</c> header value.</summary>
    public const int MaxCorrelationIdLength = 128;

    [GeneratedRegex("^[a-z0-9][a-z0-9.-]{0,127}$")]
    private static partial Regex Pattern();

    public static bool IsValid(string? value) => value is not null && Pattern().IsMatch(value);
}
