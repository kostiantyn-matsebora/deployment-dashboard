using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Json;

/// <summary>
/// Shared System.Text.Json options for the entire backend.
///
/// <para>The wire format uses snake_case (<c>run_url</c>, <c>run_number</c>,
/// <c>deployed_at</c>) per SAD §7. Each DTO carries explicit
/// <see cref="JsonPropertyName"/> attributes for clarity, but we also set
/// <see cref="JsonNamingPolicy.SnakeCaseLower"/> as a belt-and-braces
/// default so any new field doesn't silently regress to camelCase.</para>
///
/// <para>Slot-level keys that must remain camelCase
/// (<c>lastSuccessful</c>, <c>previousFailed</c>) keep their explicit
/// <see cref="JsonPropertyName"/> attributes — those override the policy.</para>
/// </summary>
public static class DashboardJson
{
    public static JsonSerializerOptions Options { get; } = Build();

    private static JsonSerializerOptions Build()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DictionaryKeyPolicy = null, // keep service / environment keys verbatim
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        };
        return o;
    }
}
