using YamlDotNet.RepresentationModel;

namespace Dashboard.Fetcher.Adapters.GitHubActions;

/// <summary>
/// Parses a GitHub Actions workflow YAML and extracts each job's
/// <c>needs:</c> declaration (issue #19, ADR-0007 rule 1). The result is
/// the per-job parent-job-name list used to wire intra-run edges into
/// <see cref="Dashboard.Shared.Dto.DeploymentEventRequest.ParentDeployments"/>.
///
/// <para>YAML shapes the parser accepts (per GHA workflow spec):</para>
/// <list type="bullet">
///   <item>No <c>needs:</c> key → job has no in-DAG parents.</item>
///   <item><c>needs: build</c> → single parent (scalar).</item>
///   <item><c>needs: [build, test]</c> or <c>needs:\n  - build\n  - test</c>
///   → multiple parents (sequence).</item>
/// </list>
///
/// <para>Anything else — malformed YAML, missing <c>jobs:</c> map,
/// non-string entries — returns <see cref="ParsedWorkflowYaml.Empty"/>;
/// the caller silent-degrades (no intra-run edges from this workflow,
/// INFO log only, cycle continues).</para>
/// </summary>
internal static class WorkflowYamlParser
{
    /// <summary>
    /// Parse the YAML text into a {jobName → parentJobNames[]} map.
    /// Returns <see cref="ParsedWorkflowYaml.Empty"/> on any structural
    /// problem (the caller treats that as "no needs edges recoverable").
    /// </summary>
    public static ParsedWorkflowYaml Parse(string yamlText)
    {
        if (string.IsNullOrWhiteSpace(yamlText)) return ParsedWorkflowYaml.Empty;

        try
        {
            var stream = new YamlStream();
            using var reader = new StringReader(yamlText);
            stream.Load(reader);
            if (stream.Documents.Count == 0) return ParsedWorkflowYaml.Empty;

            if (stream.Documents[0].RootNode is not YamlMappingNode root) return ParsedWorkflowYaml.Empty;
            if (!root.Children.TryGetValue(new YamlScalarNode("jobs"), out var jobsNode)) return ParsedWorkflowYaml.Empty;
            if (jobsNode is not YamlMappingNode jobs) return ParsedWorkflowYaml.Empty;

            var result = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
            foreach (var entry in jobs.Children)
            {
                if (entry.Key is not YamlScalarNode { Value: { } jobName }) continue;
                if (string.IsNullOrEmpty(jobName)) continue;
                if (entry.Value is not YamlMappingNode jobBody) continue;

                var needs = ReadNeeds(jobBody);
                result[jobName] = needs;
            }
            return new ParsedWorkflowYaml(result);
        }
        catch
        {
            // YamlDotNet throws YamlException + InvalidCastException + others
            // on malformed input. Per ADR-0007 rule 2 we silent-degrade —
            // hand the caller an empty map and let it log INFO once.
            return ParsedWorkflowYaml.Empty;
        }
    }

    /// <summary>
    /// Extract a job's <c>needs:</c> as a normalised string list.
    /// Returns an empty list when the key is absent or the value is not
    /// a scalar/sequence we can interpret.
    /// </summary>
    private static IReadOnlyList<string> ReadNeeds(YamlMappingNode jobBody)
    {
        if (!jobBody.Children.TryGetValue(new YamlScalarNode("needs"), out var needsNode))
        {
            return Array.Empty<string>();
        }

        switch (needsNode)
        {
            case YamlScalarNode scalar when !string.IsNullOrEmpty(scalar.Value):
                return new[] { scalar.Value };
            case YamlSequenceNode sequence:
                {
                    var parents = new List<string>(sequence.Children.Count);
                    foreach (var item in sequence.Children)
                    {
                        if (item is YamlScalarNode s && !string.IsNullOrEmpty(s.Value))
                        {
                            parents.Add(s.Value);
                        }
                    }
                    return parents;
                }
            default:
                return Array.Empty<string>();
        }
    }
}

/// <summary>
/// Result of <see cref="WorkflowYamlParser.Parse"/>. Lookup by job name
/// returns the (possibly empty) list of parent job names declared in
/// <c>needs:</c>. Job names not present in <see cref="Jobs"/> return an
/// empty list — a graceful default for jobs the YAML mentions but with
/// no <c>needs:</c> key.
/// </summary>
internal sealed record ParsedWorkflowYaml(IReadOnlyDictionary<string, IReadOnlyList<string>> Jobs)
{
    public static ParsedWorkflowYaml Empty { get; } =
        new(new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal));

    public IReadOnlyList<string> GetNeedsFor(string jobName)
        => Jobs.TryGetValue(jobName, out var needs) ? needs : Array.Empty<string>();
}
