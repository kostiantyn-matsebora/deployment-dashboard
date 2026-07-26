using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Write.Contracts;

/// <summary>
/// One named settings preset within a <see cref="PresetBundle"/> (OpenAPI <c>Preset</c>),
/// mirroring the SPA settings envelope <c>{ version, name, settings }</c>.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record Preset
{
    /// <summary>Envelope schema version. Currently always <c>1</c>.</summary>
    [Required]
    [JsonPropertyName("version")]
    public required int Version { get; init; }

    /// <summary>Human-facing preset name; unique within a source's bundle.</summary>
    [Required]
    [MinLength(1)]
    [MaxLength(200)]
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    /// <summary>Opaque settings payload. Stored verbatim; never parsed or validated.</summary>
    [Required]
    [JsonPropertyName("settings")]
    public required JsonElement Settings { get; init; }
}

/// <summary>
/// Request body for <c>PUT /api/presets/sources/{source}</c> (OpenAPI <c>PresetBundle</c>).
/// Closed, authoritative bundle published by one source — replaces the entire set of presets
/// owned by that source. An empty <see cref="Presets"/> is a valid authoritative-empty bundle
/// that prunes every preset previously published by the source.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record PresetBundle
{
    /// <summary>Bundle schema version. Currently always <c>1</c>.</summary>
    [Required]
    [JsonPropertyName("version")]
    public required int Version { get; init; }

    /// <summary>The complete set of presets for the source. May be empty (prune-all).</summary>
    [Required]
    [JsonPropertyName("presets")]
    public required IReadOnlyList<Preset> Presets { get; init; }
}
