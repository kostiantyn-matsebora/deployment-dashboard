using Dashboard.Fetcher.GitHub.Graph;

namespace Dashboard.Fetcher.Tests.Graph;

public sealed class WorkflowGraphParserTests
{
    [Fact]
    public void Parse_LinearChain_DetectsDeploymentJobs()
    {
        const string yaml = """
            name: Deploy
            jobs:
              build:
                runs-on: ubuntu-latest
                steps: []
              deploy-dev:
                needs: build
                environment: dev
                runs-on: ubuntu-latest
                steps: []
              deploy-prod:
                needs: deploy-dev
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("Deploy", yaml);

        Assert.Equal(2, graph.DeploymentJobs.Count);
        Assert.Contains("deploy-dev", graph.DeploymentJobs.Keys);
        Assert.Contains("deploy-prod", graph.DeploymentJobs.Keys);
        Assert.Equal("dev", graph.DeploymentJobs["deploy-dev"].Environment);
        Assert.Equal(["build"], graph.DeploymentJobs["deploy-dev"].Needs);
        Assert.Equal(["deploy-dev"], graph.DeploymentJobs["deploy-prod"].Needs);
    }

    [Fact]
    public void Parse_EnvironmentAsObject_NormalisesToName()
    {
        const string yaml = """
            jobs:
              deploy:
                environment:
                  name: prod
                  url: https://example.com
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("wf", yaml);

        Assert.Equal("prod", graph.DeploymentJobs["deploy"].Environment);
    }

    [Fact]
    public void Parse_NeedsAsString_NormalisedToSingleItemList()
    {
        const string yaml = """
            jobs:
              a:
                environment: dev
                runs-on: ubuntu-latest
                steps: []
              b:
                needs: a
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("wf", yaml);

        Assert.Equal(["a"], graph.DeploymentJobs["b"].Needs);
    }

    [Fact]
    public void Parse_NeedsAsArray_PreservedAsList()
    {
        const string yaml = """
            jobs:
              deploy:
                needs: [build, test]
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("wf", yaml);

        Assert.Equal(["build", "test"], graph.DeploymentJobs["deploy"].Needs);
    }

    [Fact]
    public void Parse_NoJobsKey_ReturnsEmptyGraph()
    {
        const string yaml = "name: wf";
        var graph = WorkflowGraphParser.Parse("wf", yaml);

        Assert.Empty(graph.DeploymentJobs);
        Assert.Empty(graph.AllJobs);
    }

    [Fact]
    public void Parse_InvalidYaml_ReturnsEmptyGraph()
    {
        var graph = WorkflowGraphParser.Parse("wf", "{{{{not yaml");

        Assert.Empty(graph.DeploymentJobs);
    }

    [Fact]
    public void Parse_NoEnvironmentKey_JobNotInDeploymentJobs()
    {
        const string yaml = """
            jobs:
              build:
                runs-on: ubuntu-latest
                steps: []
            """;

        var graph = WorkflowGraphParser.Parse("wf", yaml);

        Assert.Empty(graph.DeploymentJobs);
        Assert.Contains("build", graph.AllJobs.Keys);
    }
}
