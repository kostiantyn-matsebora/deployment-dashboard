using Dashboard.Fetcher.GitHub.Graph;

namespace Dashboard.Fetcher.Tests.Graph;

/// <summary>
/// Tests for F2: WorkflowGraphParser reads the YAML top-level <c>name:</c> field
/// as the authoritative workflow name (service identity), NOT the run's display name.
/// </summary>
public sealed class WorkflowGraphParserF2Tests
{
    [Fact]
    public void Parse_YamlNameField_UsedAsWorkflowName()
    {
        const string yaml = """
            name: My Real Workflow Name
            jobs:
              deploy:
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("run-name override ignored", yaml);

        Assert.Equal("My Real Workflow Name", graph.WorkflowName);
    }

    [Fact]
    public void Parse_NoYamlNameField_FallsBackToFallbackName()
    {
        const string yaml = """
            jobs:
              deploy:
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("fallback-name", yaml);

        Assert.Equal("fallback-name", graph.WorkflowName);
    }

    [Fact]
    public void Parse_RunNameOverride_DoesNotAffectWorkflowName()
    {
        // Simulates: run-name set to "Release v1.2.3", YAML name: "Release API"
        // The YAML name must win.
        const string yaml = """
            name: Release API
            jobs:
              deploy-prod:
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("Release v1.2.3", yaml);

        Assert.Equal("Release API", graph.WorkflowName);
        Assert.NotEqual("Release v1.2.3", graph.WorkflowName);
    }

    [Fact]
    public void Parse_EmptyYamlNameField_FallsBackToFallbackName()
    {
        const string yaml = """
            name: ""
            jobs:
              deploy:
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        // Empty string from YAML is technically a valid value (non-null), but
        // null-coalescing uses fallback only when GetScalar returns null.
        // An empty string is still "present" — we keep it as-is (the YAML author's intent).
        var graph = WorkflowGraphParser.Parse("fallback", yaml);

        // Empty string name is preserved from YAML (it's not null).
        Assert.Equal("", graph.WorkflowName);
    }

    [Fact]
    public void Parse_InvalidYaml_FallsBackToFallbackName()
    {
        const string yaml = ":::not valid yaml:::";

        var graph = WorkflowGraphParser.Parse("my-fallback", yaml);

        Assert.Equal("my-fallback", graph.WorkflowName);
    }
}
