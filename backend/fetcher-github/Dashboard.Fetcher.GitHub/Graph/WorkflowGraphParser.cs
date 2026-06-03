using YamlDotNet.RepresentationModel;

namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>Parses a workflow YAML string into a <see cref="WorkflowGraph"/> (§5.6.2).</summary>
public static class WorkflowGraphParser
{
    /// <summary>
    /// Parses the workflow YAML into a graph.
    /// <paramref name="fallbackName"/> is used only when the YAML contains no top-level
    /// <c>name:</c> field — the YAML name is the stable service-identity source (F2).
    /// </summary>
    public static WorkflowGraph Parse(string fallbackName, string yaml)
    {
        try
        {
            var stream = new YamlStream();
            stream.Load(new StringReader(yaml));

            if (stream.Documents.Count == 0 ||
                stream.Documents[0].RootNode is not YamlMappingNode root)
                return Empty(fallbackName);

            // F2: read the stable workflow name from the YAML `name:` field.
            // This is the workflow's *definition* name — never overridden by `run-name:`.
            var workflowName = GetScalar(root, "name") ?? fallbackName;

            if (!root.Children.TryGetValue(new YamlScalarNode("jobs"), out var jobsNode) ||
                jobsNode is not YamlMappingNode jobsMap)
                return Empty(workflowName);

            var allJobs = new Dictionary<string, WorkflowJob>(StringComparer.Ordinal);

            foreach (var (keyNode, valueNode) in jobsMap.Children)
            {
                if (keyNode is not YamlScalarNode keyScalar ||
                    valueNode is not YamlMappingNode jobNode)
                    continue;

                var jobId = keyScalar.Value ?? "";
                allJobs[jobId] = new WorkflowJob(
                    jobId,
                    ParseEnvironment(jobNode),
                    ParseNeeds(jobNode));
            }

            var deploymentJobs = allJobs.Values
                .Where(j => j.Environment is not null)
                .ToDictionary(j => j.Id, StringComparer.Ordinal);

            return new WorkflowGraph(workflowName, allJobs, deploymentJobs);
        }
        catch
        {
            return Empty(fallbackName);
        }
    }

    private static WorkflowGraph Empty(string workflowName) =>
        new(workflowName,
            new Dictionary<string, WorkflowJob>(),
            new Dictionary<string, WorkflowJob>());

    private static string? ParseEnvironment(YamlMappingNode jobNode)
    {
        if (!jobNode.Children.TryGetValue(new YamlScalarNode("environment"), out var envNode))
            return null;

        return envNode switch
        {
            YamlScalarNode scalar => scalar.Value,
            YamlMappingNode mapping => GetScalar(mapping, "name"),
            _ => null
        };
    }

    private static List<string> ParseNeeds(YamlMappingNode jobNode)
    {
        if (!jobNode.Children.TryGetValue(new YamlScalarNode("needs"), out var needsNode))
            return [];

        return needsNode switch
        {
            YamlScalarNode scalar =>
                string.IsNullOrEmpty(scalar.Value) ? [] : [scalar.Value],
            YamlSequenceNode seq =>
                seq.Children
                   .OfType<YamlScalarNode>()
                   .Select(n => n.Value ?? "")
                   .Where(v => v.Length > 0)
                   .ToList(),
            _ => []
        };
    }

    private static string? GetScalar(YamlMappingNode node, string key) =>
        node.Children.TryGetValue(new YamlScalarNode(key), out var val) && val is YamlScalarNode s
            ? s.Value
            : null;
}
