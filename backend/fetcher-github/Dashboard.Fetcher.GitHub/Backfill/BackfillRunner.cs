using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.Backfill;

/// <summary>
/// Fills the store with the most recent <see cref="FetcherOptions.BackfillDepth"/> status events
/// per (service, environment) slot (§5.8, F13).
/// Triggered on null cursor (first run) or BACKFILL=true (F14).
///
/// Streaming + resumable (chunked backfill):
/// Yields one <see cref="FetchResult"/> per completed (repo, env) plus a zero-event
/// completion marker per repo.  The orchestrator persists the cursor after each chunk
/// so a mid-backfill crash resumes from the last completed env.
///
/// Parent-map choice: the per-repo envToDeploymentId map is accumulated as each env
/// completes within a repo (§5.6.4 cross-env edges). A parent deployment in an env
/// processed later becomes a forward reference that Swimlanes resolves at render time
/// (§5.6.5 — dangling ids are tolerated). Within-repo edges from earlier envs are
/// resolved correctly because all of those deployments are accumulated into the repo
/// map before emitting later-env events.
///
/// Empty-repo completion: when a repo has no emitted events (maxSince == null), the
/// completion marker emits without advancing repos[repo].since, so the next poll window
/// falls back to now − INITIAL_LOOKBACK (safe; avoids missing events in an empty repo).
/// </summary>
public sealed class BackfillRunner(
    GithubClient github,
    GithubAdapterOptions options,
    FetcherOptions fetcherOptions,
    BackfillEventBuilder eventBuilder,
    ILogger<BackfillRunner> logger)
{
    /// <summary>
    /// Streams backfill chunks — one per completed (repo, env) plus a zero-event
    /// completion marker per repo.  Each chunk carries the full running cursor so the
    /// orchestrator can persist it after every yield.
    /// </summary>
    public async IAsyncEnumerable<FetchResult> RunAsync(
        GithubCursor incoming,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        logger.LogInformation("[Backfill] starting (depth={Depth})", fetcherOptions.BackfillDepth);

        var cursor = incoming;
        var serviceMap = options.ServiceMapDict;
        var maxAge = fetcherOptions.EffectiveBackfillMaxAge;

        foreach (var repo in options.RepoList)
        {
            var (owner, repoName) = SplitRepo(repo);
            var existing = incoming.BackfillFor(repo);

            // Stable anchor: reuse the persisted anchor for a resume, set a fresh one otherwise.
            var anchor = existing?.Anchor ?? fetcherOptions.UtcNow;
            var cutoff = anchor - maxAge;
            var alreadyDone = existing?.DoneEnvs ?? [];

            logger.LogInformation("[Backfill] {Repo}: anchor={Anchor}, resuming={Resume}, doneEnvs={Done}",
                repo, anchor, existing is not null, string.Join(",", alreadyDone));

            // Per-repo accumulated envToDeploymentId map for parent derivation (§5.6.4).
            // Built incrementally as each env's deployments are scanned so within-repo
            // edges from earlier envs resolve when later-env events reference them.
            var repoEnvMap = new Dictionary<long, Dictionary<string, string>>();

            DateTimeOffset? maxSinceForRepo = null;

            var (pathToService, allServiceNames) = await ResolveWorkflowMappingsAsync(owner, repoName, serviceMap, repo, ct);
            var remainingEnvs = await DiscoverRemainingEnvsAsync(owner, repoName, alreadyDone, ct);

            foreach (var env in remainingEnvs)
            {
                ct.ThrowIfCancellationRequested();

                var (envEvents, envDeployments) = await eventBuilder.BackfillEnvAsync(
                    new BackfillEnvContext(owner, repoName, repo, env, cutoff),
                    pathToService, allServiceNames, serviceMap,
                    repoEnvMap, fetcherOptions.BackfillDepth, ct);

                // Accumulate deployment data into the repo-level env map so that
                // subsequent envs can resolve parent edges back to this env's deployments.
                BackfillEventBuilder.MergeIntoRepoEnvMap(repoEnvMap, envDeployments);

                // Sort env events oldest-first (§5.8.2).
                envEvents.Sort((a, b) => a.HappenedAt.CompareTo(b.HappenedAt));

                foreach (var ev in envEvents)
                {
                    if (maxSinceForRepo is null || ev.HappenedAt > maxSinceForRepo.Value)
                        maxSinceForRepo = ev.HappenedAt;
                }

                // Advance the running cursor with the done-env marker.
                cursor = cursor.WithBackfillEnvDone(repo, anchor, env);

                yield return new FetchResult(envEvents, cursor.Encode());
            }

            // Zero-event completion marker: sets repos[repo].since and removes the backfill marker.
            cursor = cursor.WithBackfillComplete(repo, maxSinceForRepo);
            yield return new FetchResult([], cursor.Encode());

            logger.LogInformation("[Backfill] {Repo}: complete — maxSince={MaxSince}", repo, maxSinceForRepo);
        }

        logger.LogInformation("[Backfill] all repos complete");
    }

    /// <summary>
    /// Discovers active workflows and builds the path-to-service and service-name lookup maps.
    /// </summary>
    private async Task<(IReadOnlyDictionary<string, string> PathToService, IReadOnlySet<string> AllServiceNames)>
        ResolveWorkflowMappingsAsync(
            string owner, string repoName,
            IReadOnlyDictionary<string, string> serviceMap,
            string repo,
            CancellationToken ct)
    {
        var workflowList = await github.GetAsync<GhWorkflowListResponse>(
            $"/repos/{owner}/{repoName}/actions/workflows?per_page=100", ct);
        var activeWorkflows = workflowList?.Workflows
            .Where(w => w.State == "active")
            .ToList() ?? [];

        var pathToService = activeWorkflows
            .ToDictionary(
                w => w.Path,
                w => ServiceResolver.Resolve(w.Name, repo, serviceMap),
                StringComparer.OrdinalIgnoreCase);

        var allServiceNames = activeWorkflows
            .Select(w => ServiceResolver.Resolve(w.Name, repo, serviceMap))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return (pathToService, allServiceNames);
    }

    /// <summary>
    /// Fetches the environment list for a repo and filters out already-completed environments.
    /// </summary>
    private async Task<List<string>> DiscoverRemainingEnvsAsync(
        string owner, string repoName,
        IReadOnlyCollection<string> alreadyDone,
        CancellationToken ct)
    {
        var envList = await github.GetAsync<GhEnvironmentListResponse>(
            $"/repos/{owner}/{repoName}/environments", ct);
        var environments = envList?.Environments.Select(e => e.Name).ToList() ?? [];

        return environments
            .Where(e => !alreadyDone.Contains(e, StringComparer.OrdinalIgnoreCase))
            .ToList();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static (string Owner, string Repo) SplitRepo(string repo)
    {
        var parts = repo.Split('/', 2);
        return parts.Length == 2 ? (parts[0], parts[1]) : ("", repo);
    }
}

/// <summary>Cohesive identity/scope parameters for a single env backfill pass.</summary>
internal readonly record struct BackfillEnvContext(
    string Owner,
    string RepoName,
    string Repo,
    string Env,
    DateTimeOffset Cutoff);
