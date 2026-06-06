using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Contracts;
using Dashboard.Write.Filters;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;

namespace Dashboard.Write.Tests;

/// <summary>
/// Unit tests for <see cref="ApiKeyEndpointFilter"/> and <see cref="IngestGateEndpointFilter"/>.
/// Uses minimal stubs — no HTTP stack or Testcontainers.
/// </summary>
public sealed class ApiKeyEndpointFilterTests
{
    private const string ValidKey = "secret-key";

    // ── ApiKeyEndpointFilter ──────────────────────────────────────────────────

    [Fact]
    public async Task InvokeAsync_CorrectKey_CallsNext()
    {
        var filter = BuildFilter(configuredKey: ValidKey);
        var ctx = BuildContext(headerValue: ValidKey);
        var nextCalled = false;
        EndpointFilterDelegate next = _ => { nextCalled = true; return ValueTask.FromResult<object?>(null); };

        await filter.InvokeAsync(ctx, next);

        Assert.True(nextCalled);
    }

    [Fact]
    public async Task InvokeAsync_WrongKey_Returns401()
    {
        var filter = BuildFilter(configuredKey: ValidKey);
        var ctx = BuildContext(headerValue: "wrong-key");
        var result = await filter.InvokeAsync(ctx, _ => ValueTask.FromResult<object?>(null));

        var problem = Assert.IsAssignableFrom<ProblemHttpResult>(result);
        Assert.Equal(StatusCodes.Status401Unauthorized, problem.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_MissingHeader_Returns401()
    {
        var filter = BuildFilter(configuredKey: ValidKey);
        var ctx = BuildContext(headerValue: null);
        var result = await filter.InvokeAsync(ctx, _ => ValueTask.FromResult<object?>(null));

        var problem = Assert.IsAssignableFrom<ProblemHttpResult>(result);
        Assert.Equal(StatusCodes.Status401Unauthorized, problem.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_NoKeyConfigured_Returns401()
    {
        // When API_KEY is not set, every request is rejected.
        var filter = BuildFilter(configuredKey: null);
        var ctx = BuildContext(headerValue: "any-value");
        var result = await filter.InvokeAsync(ctx, _ => ValueTask.FromResult<object?>(null));

        var problem = Assert.IsAssignableFrom<ProblemHttpResult>(result);
        Assert.Equal(StatusCodes.Status401Unauthorized, problem.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_EmptyKeyConfigured_Returns401()
    {
        // An empty configured key is equivalent to absent — all requests rejected.
        var filter = BuildFilter(configuredKey: string.Empty);
        var ctx = BuildContext(headerValue: string.Empty);
        var result = await filter.InvokeAsync(ctx, _ => ValueTask.FromResult<object?>(null));

        var problem = Assert.IsAssignableFrom<ProblemHttpResult>(result);
        Assert.Equal(StatusCodes.Status401Unauthorized, problem.StatusCode);
    }

    private static ApiKeyEndpointFilter BuildFilter(string? configuredKey)
    {
        var pairs = configuredKey is not null
            ? new Dictionary<string, string?> { [ApiKeyEndpointFilter.ApiKeyConfigKey] = configuredKey }
            : new Dictionary<string, string?>();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(pairs)
            .Build();

        return new ApiKeyEndpointFilter(config);
    }

    private static EndpointFilterInvocationContext BuildContext(string? headerValue)
    {
        var ctx = new DefaultHttpContext();
        if (headerValue is not null)
            ctx.Request.Headers[ApiKeyEndpointFilter.HeaderName] = new StringValues(headerValue);

        return new StubEndpointFilterInvocationContext(ctx);
    }
}

/// <summary>
/// Unit tests for <see cref="IngestGateEndpointFilter"/>.
/// </summary>
public sealed class IngestGateEndpointFilterTests
{
    [Fact]
    public async Task InvokeAsync_NoResetStateProvider_CallsNext()
    {
        // When no IResetStateProvider is registered, the gate is open.
        var filter = new IngestGateEndpointFilter();
        var ctx = BuildContext(isResetting: null);
        var nextCalled = false;
        EndpointFilterDelegate next = _ => { nextCalled = true; return ValueTask.FromResult<object?>(null); };

        await filter.InvokeAsync(ctx, next);

        Assert.True(nextCalled);
    }

    [Fact]
    public async Task InvokeAsync_IsResettingFalse_CallsNext()
    {
        var filter = new IngestGateEndpointFilter();
        var ctx = BuildContext(isResetting: false);
        var nextCalled = false;
        EndpointFilterDelegate next = _ => { nextCalled = true; return ValueTask.FromResult<object?>(null); };

        await filter.InvokeAsync(ctx, next);

        Assert.True(nextCalled);
    }

    [Fact]
    public async Task InvokeAsync_IsResettingTrue_Returns503()
    {
        var filter = new IngestGateEndpointFilter();
        var ctx = BuildContext(isResetting: true);
        var result = await filter.InvokeAsync(ctx, _ => ValueTask.FromResult<object?>(null));

        var problem = Assert.IsAssignableFrom<ProblemHttpResult>(result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, problem.StatusCode);
    }

    [Fact]
    public async Task InvokeAsync_IsResettingTrue_SetsRetryAfterHeader()
    {
        var filter = new IngestGateEndpointFilter();
        var ctx = BuildContext(isResetting: true);

        await filter.InvokeAsync(ctx, _ => ValueTask.FromResult<object?>(null));

        Assert.True(ctx.HttpContext.Response.Headers.ContainsKey("Retry-After"),
            "Response must include Retry-After header when resetting.");
    }

    private static EndpointFilterInvocationContext BuildContext(bool? isResetting)
    {
        var services = new ServiceCollection();
        if (isResetting.HasValue)
            services.AddSingleton<IResetStateProvider>(new StubResetStateProvider(isResetting.Value));

        var ctx = new DefaultHttpContext
        {
            RequestServices = services.BuildServiceProvider(),
        };
        return new StubEndpointFilterInvocationContext(ctx);
    }

    private sealed class StubResetStateProvider(bool isResetting) : IResetStateProvider
    {
        public bool IsResetting => isResetting;
    }
}

/// <summary>
/// Minimal stub for <see cref="EndpointFilterInvocationContext"/>.
/// Provides an <see cref="HttpContext"/> and an empty argument list.
/// </summary>
file sealed class StubEndpointFilterInvocationContext(HttpContext httpContext)
    : EndpointFilterInvocationContext
{
    public override HttpContext HttpContext => httpContext;
    public override IList<object?> Arguments { get; } = [];

    public override T GetArgument<T>(int index) =>
        throw new NotSupportedException("Not needed for filter tests.");
}
