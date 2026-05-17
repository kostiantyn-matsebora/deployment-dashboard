using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Validation;

/// <summary>
/// Runs Data Annotations on a request DTO and converts failures into the
/// shape that ASP.NET Core's <c>ValidationProblemDetails</c> uses, so the
/// API can return <c>422 Unprocessable Entity</c> with a familiar body
/// (CR-0008 § "Standardised error response shape").
///
/// <para>FluentValidation is explicitly forbidden by the SAD; Data
/// Annotations alone cover every field on
/// <c>DeploymentEventRequest</c>.</para>
///
/// <para>Error-key naming (CR-0008 § "Standardised error response shape"):
/// the returned dictionary is keyed by the <strong>camelCase JSON field
/// name</strong> of the request body (e.g. <c>runUrl</c>,
/// <c>parentDeployments</c>) — not the C# property name and not the
/// snake_case wire form. This lets the SPA bind error keys to the same
/// field identifiers it already uses internally (the wire is snake_case
/// but the SPA stores fields as camelCase via the existing JSON contract).
/// The mapping derives the camelCase form from each property's
/// <c>[JsonPropertyName]</c> attribute (always the snake_case wire name)
/// by splitting on underscores and lower-camel-casing — so a single source
/// of truth (the property's annotation) drives both the wire form and the
/// error-key form.</para>
///
/// <para>Per-element messages produced by
/// <see cref="Dto.ParentDeploymentsElementsAttribute"/> are newline-joined
/// inside a single <see cref="ValidationResult.ErrorMessage"/>; this
/// translator splits them back into one error entry per element so the
/// emitted <c>errors</c> map matches the example in CR-0008 §
/// "Standardised error response shape" verbatim.</para>
/// </summary>
public static class DataAnnotationsValidator
{
    public static (bool IsValid, Dictionary<string, string[]> Errors) Validate(object instance)
    {
        ArgumentNullException.ThrowIfNull(instance);

        var results = new List<ValidationResult>();
        var context = new ValidationContext(instance);
        var isValid = Validator.TryValidateObject(
            instance, context, results, validateAllProperties: true);

        if (isValid) return (true, new Dictionary<string, string[]>());

        var keyMap = BuildErrorKeyMap(instance.GetType());

        var errors = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var r in results)
        {
            var members = r.MemberNames.Any() ? r.MemberNames : new[] { string.Empty };
            foreach (var member in members)
            {
                var key = ResolveErrorKey(keyMap, member);
                if (!errors.TryGetValue(key, out var list))
                {
                    list = new List<string>();
                    errors[key] = list;
                }
                // ValidationAttribute consumers (e.g. ParentDeploymentsElementsAttribute)
                // pack multiple per-element messages into a single newline-joined
                // ErrorMessage. Split so the wire form lists one violation per
                // element, matching CR-0008's example.
                var message = r.ErrorMessage ?? "invalid";
                foreach (var line in message.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                {
                    list.Add(line);
                }
            }
        }

        return (false, errors.ToDictionary(
            kv => kv.Key,
            kv => kv.Value.ToArray(),
            StringComparer.Ordinal));
    }

    /// <summary>
    /// Maps C# property names → camelCase JSON keys for the supplied type.
    /// The camelCase form is derived from each property's
    /// <c>[JsonPropertyName]</c> attribute (the snake_case wire name) so we
    /// have a single source of truth for "what the client called this field".
    /// Properties without the attribute fall back to camelCasing the C# name.
    /// </summary>
    private static Dictionary<string, string> BuildErrorKeyMap(Type t)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var prop in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var jsonName = prop.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name;
            map[prop.Name] = ToCamelCase(jsonName ?? prop.Name);
        }
        return map;
    }

    /// <summary>
    /// If the member name resolves via the keymap (a known DTO property)
    /// return the camelCase form; otherwise return the original member name
    /// untouched so caller-supplied error keys (e.g. cross-field validators)
    /// flow through verbatim.
    /// </summary>
    private static string ResolveErrorKey(Dictionary<string, string> map, string member) =>
        map.TryGetValue(member, out var camel) ? camel : member;

    /// <summary>
    /// Converts a snake_case or camelCase / PascalCase identifier to
    /// lower-camelCase: <c>deployment_id → deploymentId</c>,
    /// <c>run_url → runUrl</c>, <c>Service → service</c>. Single-segment
    /// inputs are lower-camel-cased; multi-segment inputs are joined with
    /// per-segment capitalisation.
    /// </summary>
    private static string ToCamelCase(string s)
    {
        if (string.IsNullOrEmpty(s)) return s;

        if (s.Contains('_'))
        {
            var parts = s.Split('_', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return s;
            var first = parts[0].ToLowerInvariant();
            if (parts.Length == 1) return first;
            var sb = new System.Text.StringBuilder(first);
            for (var i = 1; i < parts.Length; i++)
            {
                var p = parts[i];
                if (p.Length == 0) continue;
                sb.Append(char.ToUpperInvariant(p[0]));
                if (p.Length > 1) sb.Append(p.AsSpan(1).ToString().ToLowerInvariant());
            }
            return sb.ToString();
        }

        // PascalCase / camelCase — lower the first character only.
        if (char.IsUpper(s[0]))
        {
            return char.ToLowerInvariant(s[0]) + s[1..];
        }
        return s;
    }
}
