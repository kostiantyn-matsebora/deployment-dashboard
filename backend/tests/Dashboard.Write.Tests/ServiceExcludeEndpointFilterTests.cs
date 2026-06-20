using Dashboard.Shared.Contracts;
using Dashboard.Shared.ServiceFiltering;
using Dashboard.Write.Filters;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Dashboard.Write.Tests;

/// <summary>
/// Unit tests for <see cref="ServiceExcludeEndpointFilter"/>.
/// Verifies that excluded services receive HTTP 403 (Forbidden) and permitted services
/// are passed through to the next delegate unchanged.
/// No mocks — all real implementations.
/// </summary>
public sealed class ServiceExcludeEndpointFilterTests
{
    // ── Filter pass-through: empty SERVICE_EXCLUDE ────────────────────────────

    [Fact]
    public async Task EmptyExclude_AllowsAllServices()
    {
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.PassAll);
        var body = ValidBody(service: "checkout");

        var result = await InvokeAsync(filter, body);

        // Should have passed through to the next delegate (returns the sentinel result).
        Assert.Equal(SentinelResult.Instance, result);
    }

    [Fact]
    public async Task ExcludePattern_PermittedService_PassesThrough()
    {
        // Only "legacy-crm" is excluded; "checkout" must pass.
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("legacy-crm"));
        var body = ValidBody(service: "checkout");

        var result = await InvokeAsync(filter, body);

        Assert.Equal(SentinelResult.Instance, result);
    }

    // ── Filter rejection: matching SERVICE_EXCLUDE ────────────────────────────

    [Fact]
    public async Task ExcludePattern_SingleSegment_Returns403ForExcludedService()
    {
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("checkout"));
        var body = ValidBody(service: "checkout");

        var result = await InvokeAsync(filter, body);

        AssertIsProblem403(result);
    }

    [Fact]
    public async Task ExcludePattern_GlobSuffix_Returns403ForMatchingService()
    {
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("legacy-*"));
        var body = ValidBody(service: "legacy-crm");

        var result = await InvokeAsync(filter, body);

        AssertIsProblem403(result);
    }

    [Fact]
    public async Task ExcludePattern_GlobSuffix_AllowsNonMatchingService()
    {
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("legacy-*"));
        var body = ValidBody(service: "checkout");

        var result = await InvokeAsync(filter, body);

        Assert.Equal(SentinelResult.Instance, result);
    }

    [Fact]
    public async Task ExcludePattern_TwoSegment_Returns403ForMatchingNamespaceAndService()
    {
        // Pattern "my-repo/checkout" — owner is wildcarded; matches any namespace="my-repo", service="checkout".
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("my-repo/checkout"));
        var body = ValidBody(service: "checkout", @namespace: "my-repo");

        var result = await InvokeAsync(filter, body);

        AssertIsProblem403(result);
    }

    [Fact]
    public async Task ExcludePattern_TwoSegment_AllowsDifferentNamespace()
    {
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("my-repo/checkout"));
        var body = ValidBody(service: "checkout", @namespace: "other-repo");

        var result = await InvokeAsync(filter, body);

        Assert.Equal(SentinelResult.Instance, result);
    }

    [Fact]
    public async Task ExcludePattern_NullNamespace_SingleSegmentPattern_Returns403()
    {
        // Single-segment "checkout" matches any namespace including null.
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("checkout"));
        var body = ValidBody(service: "checkout", @namespace: null);

        var result = await InvokeAsync(filter, body);

        AssertIsProblem403(result);
    }

    [Fact]
    public async Task ExcludePattern_MultiPattern_Returns403ForAnyMatch()
    {
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.Parse("checkout,billing"));
        var checkoutResult = await InvokeAsync(filter, ValidBody(service: "checkout"));
        var billingResult = await InvokeAsync(filter, ValidBody(service: "billing"));
        var gatewayResult = await InvokeAsync(filter, ValidBody(service: "gateway"));

        AssertIsProblem403(checkoutResult);
        AssertIsProblem403(billingResult);
        Assert.Equal(SentinelResult.Instance, gatewayResult);
    }

    // ── Fast path: IsEmpty = true means no body inspection ───────────────────

    [Fact]
    public async Task EmptyFilter_IsEmpty_SkipsBodyInspection()
    {
        // Pass null body — with an empty filter no body lookup occurs so no NRE.
        var filter = new ServiceExcludeEndpointFilter(ServiceFilter.PassAll);

        var result = await InvokeAsync(filter, body: null);

        Assert.Equal(SentinelResult.Instance, result);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static DeploymentEventIngest ValidBody(string service = "checkout", string? @namespace = null) =>
        new()
        {
            DeploymentId = "gh-001",
            Service = service,
            Namespace = @namespace,
            Environment = "prod",
            Status = "success",
            HappenedAt = DateTimeOffset.UtcNow,
        };

    private static async Task<object?> InvokeAsync(
        ServiceExcludeEndpointFilter filter, DeploymentEventIngest? body)
    {
        var arguments = new List<object?>();
        if (body is not null)
            arguments.Add(body);

        var context = new FakeEndpointFilterInvocationContext(arguments);
        return await filter.InvokeAsync(context, _ => ValueTask.FromResult<object?>(SentinelResult.Instance));
    }

    private static void AssertIsProblem403(object? result)
    {
        // Results.Problem() returns a ProblemHttpResult — verify type and status code directly.
        Assert.NotNull(result);
        Assert.NotEqual(SentinelResult.Instance, result);

        // ProblemHttpResult is the concrete type returned by Results.Problem().
        var problem = result as Microsoft.AspNetCore.Http.HttpResults.ProblemHttpResult
            ?? throw new InvalidCastException(
                $"Expected ProblemHttpResult but got {result!.GetType().FullName}. " +
                "Results.Problem() should return ProblemHttpResult.");

        Assert.Equal(StatusCodes.Status403Forbidden, problem.StatusCode);
    }

    // ── Sentinel for distinguishing pass-through from a filter result ─────────

    private sealed class SentinelResult
    {
        public static readonly SentinelResult Instance = new();
        private SentinelResult() { }
    }

    // ── Minimal IEndpointFilterInvocationContext implementation ──────────────

    private sealed class FakeEndpointFilterInvocationContext(IList<object?> arguments)
        : EndpointFilterInvocationContext
    {
        public override IList<object?> Arguments => arguments;

        public override T GetArgument<T>(int index) =>
            (T)arguments[index]!;

        public override HttpContext HttpContext =>
            new DefaultHttpContext();
    }
}
