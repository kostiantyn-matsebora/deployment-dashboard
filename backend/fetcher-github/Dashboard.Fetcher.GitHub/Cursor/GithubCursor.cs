using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Fetcher.GitHub.Cursor;

/// <summary>
/// Per-adapter cursor stored opaquely as Base64(compact JSON) (§5.4).
/// The host never inspects the content.
/// </summary>
public sealed class GithubCursor
{
    [JsonPropertyName("repos")]
    public Dictionary<string, RepoCursor> Repos { get; init; } = [];

    /// <summary>Decode from the opaque string; null = first run → empty cursor.</summary>
    public static GithubCursor Decode(string? encoded)
    {
        if (encoded is null)
            return new GithubCursor();

        var json = Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
        return JsonSerializer.Deserialize<GithubCursor>(json) ?? new GithubCursor();
    }

    /// <summary>Encode to the opaque string persisted via the state API.</summary>
    public string Encode()
    {
        var json = JsonSerializer.Serialize(this);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
    }

    /// <summary>
    /// Returns the high-water mark for <paramref name="repo"/>,
    /// falling back to <c>now − initialLookback</c> when not present (F7).
    /// </summary>
    public DateTimeOffset SinceFor(string repo, TimeSpan initialLookback) =>
        Repos.TryGetValue(repo, out var c) ? c.Since : DateTimeOffset.UtcNow - initialLookback;

    /// <summary>Returns a new cursor with the repo's high-water mark advanced.</summary>
    public GithubCursor WithRepo(string repo, DateTimeOffset since) =>
        new() { Repos = new Dictionary<string, RepoCursor>(Repos) { [repo] = new RepoCursor { Since = since } } };
}

public sealed record RepoCursor
{
    [JsonPropertyName("since")]
    public DateTimeOffset Since { get; init; }
}
