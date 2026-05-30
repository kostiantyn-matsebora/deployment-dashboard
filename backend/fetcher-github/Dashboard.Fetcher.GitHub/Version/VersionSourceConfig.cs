namespace Dashboard.Fetcher.GitHub.Version;

public enum VersionSourceType { Attribute, Payload, Artifact }

/// <summary>Parsed version source from "type:key" config string (§5.7, F15).</summary>
public sealed record VersionSourceConfig(VersionSourceType Type, string Key)
{
    public static VersionSourceConfig Parse(string raw)
    {
        var parts = raw.Split(':', 2);
        if (parts.Length != 2)
            return Default;

        var type = parts[0].ToLowerInvariant() switch
        {
            "payload" => VersionSourceType.Payload,
            "artifact" => VersionSourceType.Artifact,
            _ => VersionSourceType.Attribute
        };

        return new VersionSourceConfig(type, parts[1]);
    }

    public static readonly VersionSourceConfig Default = new(VersionSourceType.Attribute, "sha");
}
