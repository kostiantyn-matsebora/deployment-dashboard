namespace Dashboard.Shared.Entities;

/// <summary>
/// One named preset published by a repo/CI source, persisted by
/// <c>PUT /api/presets/sources/{source}</c> and served (merged across sources) by
/// <c>GET /api/presets</c>. Authoritative per source — a source's whole set is replaced
/// on every PUT (last write wins); composite key <c>(Source, Name)</c>.
/// </summary>
public sealed class ProvidedPreset
{
    /// <summary>The <c>owner/repo</c> that published this preset. Part of the composite key.</summary>
    public required string Source { get; set; }

    /// <summary>Preset name as published in the source's bundle. Part of the composite key.</summary>
    public required string Name { get; set; }

    /// <summary>Envelope schema version. Currently always <c>1</c>.</summary>
    public int Version { get; set; }

    /// <summary>Opaque settings payload, stored verbatim as JSON text. Never parsed or validated.</summary>
    public required string SettingsJson { get; set; }

    /// <summary>Server timestamp when this source's bundle was last published/stored.</summary>
    public DateTimeOffset FetchedAt { get; set; }
}
