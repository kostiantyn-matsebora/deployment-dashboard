using System.Text.RegularExpressions;

namespace Dashboard.Fetcher.Adapters.GitHubActions;

/// <summary>
/// Parses a deployment-status <c>log_url</c> / <c>target_url</c> into the
/// run-host coordinates the adapter needs to recover intra-run
/// <c>needs:</c> edges (issue #19, ADR-0007 rule 1).
///
/// <para>The URL points at the GitHub Actions UI page for the workflow run
/// that produced this deployment. PostHog and other large repos route their
/// deployment status URLs at a *different* repo than the one being deployed
/// (e.g. <c>PostHog/posthog</c> deploys link to runs on <c>PostHog/charts</c>),
/// so the run-host owner / repo are NOT necessarily the deployment's own
/// repo — the adapter MUST use the parsed values when calling the jobs +
/// workflow-contents APIs.</para>
///
/// <para>The job-id suffix is optional. Sample real-world URLs:</para>
/// <list type="bullet">
///   <item><c>https://github.com/PostHog/charts/actions/runs/26129778612</c>
///   — run id present, job id absent → deployment cannot be mapped to a
///   specific job in the run, so intra-run <c>needs:</c> edges are NOT
///   derivable for this deployment (issue #19 §3 "Job-id absent case").</item>
///   <item><c>https://github.com/acme/charts/actions/runs/123/job/45</c>
///   — run id + job id both present → full intra-run resolution possible.</item>
/// </list>
/// </summary>
internal static class StatusUrlParser
{
    /// <summary>
    /// Matches <c>/{owner}/{repo}/actions/runs/{run_id}[/job/{job_id}]</c>
    /// in either the <c>log_url</c> or <c>target_url</c> of a deployment
    /// status. The host prefix is ignored so the same regex works against
    /// public github.com and GHE-on-prem (<c>github.acme.corp</c>).
    /// </summary>
    private static readonly Regex StatusUrlRegex = new(
        @"/(?<owner>[^/]+)/(?<repo>[^/]+)/actions/runs/(?<run_id>\d+)(?:/job/(?<job_id>\d+))?",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Try to extract run-host coordinates from a status URL. Returns
    /// <c>true</c> when at least <c>owner</c>, <c>repo</c>, and <c>run_id</c>
    /// could be parsed; <c>jobId</c> may be <c>null</c> (job-id absent case
    /// per issue #19 §3 — intra-run edges are then skipped for that
    /// deployment but per-env predecessor edges still emit).
    /// </summary>
    public static bool TryParse(string? url, out string owner, out string repo, out long runId, out long? jobId)
    {
        owner = string.Empty;
        repo = string.Empty;
        runId = 0;
        jobId = null;
        if (string.IsNullOrWhiteSpace(url)) return false;
        var match = StatusUrlRegex.Match(url);
        if (!match.Success) return false;

        owner = match.Groups["owner"].Value;
        repo = match.Groups["repo"].Value;
        if (!long.TryParse(
                match.Groups["run_id"].Value,
                System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture,
                out runId))
        {
            return false;
        }

        var jobGroup = match.Groups["job_id"];
        if (jobGroup.Success && jobGroup.Length > 0
            && long.TryParse(
                jobGroup.Value,
                System.Globalization.NumberStyles.Integer,
                System.Globalization.CultureInfo.InvariantCulture,
                out var parsedJob))
        {
            jobId = parsedJob;
        }
        return true;
    }
}

/// <summary>
/// Parsed run-host coordinates for a deployment, populated from a status
/// URL via <see cref="StatusUrlParser"/>. <see cref="JobId"/> is
/// <c>null</c> when the status URL omits the <c>/job/{id}</c> segment (the
/// deployment is then unmappable to a specific job within the run, so
/// intra-run <c>needs:</c> edges are skipped for it).
/// </summary>
internal sealed record RunHostCoordinates(string Owner, string Repo, long RunId, long? JobId);
