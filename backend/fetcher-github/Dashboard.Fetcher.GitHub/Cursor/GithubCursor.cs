using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Fetcher.GitHub.Cursor;

/// <summary>
/// Per-adapter cursor stored opaquely as Base64(compact JSON) (§5.4).
/// The host never inspects the content.
///
/// Shape:
/// <code>
/// {
///   "repos": { "owner/repo": { "since": "..." } },
///   "backfill": { "owner/repo": { "anchor": "...", "done_envs": ["env1"] } }
/// }
/// </code>
/// The <c>backfill</c> section is absent in old cursors and in cursors where all repos
/// have completed backfill — <see cref="Decode"/> is backward-compatible.
/// </summary>
public sealed class GithubCursor
{
    [JsonPropertyName("repos")]
    public Dictionary<string, RepoCursor> Repos { get; init; } = [];

    /// <summary>
    /// Per-repo backfill-progress markers. Absent when backfill is not in progress.
    /// Backward-compatible: <see cref="Decode"/> treats a missing key as empty.
    /// </summary>
    [JsonPropertyName("backfill")]
    public Dictionary<string, BackfillMarker>? Backfill { get; init; }

    // ── Factory / codec ───────────────────────────────────────────────────────

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

    // ── repos helpers ─────────────────────────────────────────────────────────

    /// <summary>
    /// Returns the high-water mark for <paramref name="repo"/>,
    /// falling back to <c>now − initialLookback</c> when not present (F7).
    /// </summary>
    public DateTimeOffset SinceFor(string repo, TimeSpan initialLookback) =>
        Repos.TryGetValue(repo, out var c) ? c.Since : DateTimeOffset.UtcNow - initialLookback;

    /// <summary>Returns a new cursor with the repo's high-water mark advanced.</summary>
    public GithubCursor WithRepo(string repo, DateTimeOffset since) =>
        new()
        {
            Repos = new Dictionary<string, RepoCursor>(Repos) { [repo] = new RepoCursor { Since = since } },
            Backfill = Backfill,
        };

    // ── backfill helpers ──────────────────────────────────────────────────────

    /// <summary>True when any repo still has an active backfill marker.</summary>
    public bool IsBackfilling => Backfill is { Count: > 0 };

    /// <summary>
    /// Returns the repos that have an active backfill marker (resume targets).
    /// </summary>
    public IEnumerable<string> BackfillRepos =>
        Backfill?.Keys ?? Enumerable.Empty<string>();

    /// <summary>
    /// Returns the backfill marker for <paramref name="repo"/>, or <c>null</c> if none.
    /// </summary>
    public BackfillMarker? BackfillFor(string repo) =>
        Backfill is not null && Backfill.TryGetValue(repo, out var m) ? m : null;

    /// <summary>
    /// Records that <paramref name="env"/> has been processed for <paramref name="repo"/>
    /// during the current backfill pass (creates the marker on first call for this repo).
    /// Does NOT advance <c>repos[repo].since</c> — that is set only by
    /// <see cref="WithBackfillComplete"/>.
    /// </summary>
    public GithubCursor WithBackfillEnvDone(string repo, DateTimeOffset anchor, string env)
    {
        var existing = BackfillFor(repo);
        var doneEnvs = existing?.DoneEnvs ?? [];
        if (!doneEnvs.Contains(env, StringComparer.OrdinalIgnoreCase))
            doneEnvs = [.. doneEnvs, env];

        var newBackfill = new Dictionary<string, BackfillMarker>(Backfill ?? [])
        {
            [repo] = new BackfillMarker { Anchor = anchor, DoneEnvs = doneEnvs },
        };

        return new GithubCursor { Repos = Repos, Backfill = newBackfill };
    }

    /// <summary>
    /// Marks backfill for <paramref name="repo"/> as complete:
    /// advances <c>repos[repo].since</c> to <paramref name="maxSince"/> (when non-null)
    /// and removes the backfill marker.
    /// When <paramref name="maxSince"/> is null (repo had no emitted events), the
    /// <c>repos[repo].since</c> entry is left unset so that the next poll window falls
    /// back to <c>now − INITIAL_LOOKBACK</c> — the safe choice that avoids missing events
    /// in an empty repo.
    /// </summary>
    public GithubCursor WithBackfillComplete(string repo, DateTimeOffset? maxSince)
    {
        var newRepos = new Dictionary<string, RepoCursor>(Repos);
        if (maxSince.HasValue)
            newRepos[repo] = new RepoCursor { Since = maxSince.Value };

        var newBackfill = Backfill is null
            ? null
            : new Dictionary<string, BackfillMarker>(Backfill);
        newBackfill?.Remove(repo);
        if (newBackfill?.Count == 0)
            newBackfill = null;

        return new GithubCursor { Repos = newRepos, Backfill = newBackfill };
    }
}

public sealed record RepoCursor
{
    [JsonPropertyName("since")]
    public DateTimeOffset Since { get; init; }
}

/// <summary>
/// Mid-backfill progress marker for a single repo.
/// Opaque to the backend (F3); only the adapter reads/writes this.
/// </summary>
public sealed record BackfillMarker
{
    /// <summary>
    /// UTC timestamp at which this backfill pass started. Used as the stable cutoff
    /// anchor so that a resumed backfill does not extend the scan window.
    /// </summary>
    [JsonPropertyName("anchor")]
    public DateTimeOffset Anchor { get; init; }

    /// <summary>Environment names whose per-env scan has been completed and emitted.</summary>
    [JsonPropertyName("done_envs")]
    public IReadOnlyList<string> DoneEnvs { get; init; } = [];
}
