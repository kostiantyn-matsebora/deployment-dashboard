using Dashboard.Shared.Persistence;
using Dashboard.Shared.Tests.Persistence;
using Dashboard.Shared.Topology;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Shared.Tests.Topology;

/// <summary>
/// Unit-level guards for the topology config store. The Read API endpoints
/// exercise the HTTP surface; these tests pin the in-process behaviour:
///
/// <list type="bullet">
///   <item>Bootstrap from <c>TopologyOptions</c> on first run.</item>
///   <item>PATCH semantics — unset fields unchanged; <c>null</c> removes.</item>
///   <item>Per-service override beats global default and beats the
///   per-request query parameter; missing override falls back through the
///   precedence chain.</item>
///   <item>Invalid attribute names throw — endpoint translates to 400.</item>
/// </list>
///
/// <para>The Phase-1 SAD revision removed the <c>AllowUserOverride</c>
/// kill-switch. The SPA is read-only against the API and never invokes
/// PATCH; there is no longer a "blocked PATCH" branch to test.</para>
/// </summary>
public sealed class TopologyConfigStoreTests
{
    private sealed class Harness : IDisposable
    {
        public InMemorySqliteContext.Handle DbHandle { get; }
        public IServiceProvider Provider { get; }
        public TopologyConfigStore Store { get; }

        public Harness(TopologyOptions opts)
        {
            DbHandle = InMemorySqliteContext.Create();

            var services = new ServiceCollection();
            services.AddSingleton(DbHandle.Context);
            services.AddSingleton<IServiceScopeFactory>(new SingleScopeFactory(DbHandle.Context));

            Provider = services.BuildServiceProvider();
            Store = new TopologyConfigStore(
                Provider.GetRequiredService<IServiceScopeFactory>(),
                opts,
                NullLogger<TopologyConfigStore>.Instance);
        }

        public void Dispose() => DbHandle.Dispose();
    }

    /// <summary>
    /// Minimal <see cref="IServiceScopeFactory"/> that hands back the same
    /// DbContext on every CreateScope() — adequate for unit tests since
    /// each test has its own <see cref="InMemorySqliteContext"/>.
    /// </summary>
    private sealed class SingleScopeFactory : IServiceScopeFactory
    {
        private readonly DashboardDbContext _db;
        public SingleScopeFactory(DashboardDbContext db) => _db = db;
        public IServiceScope CreateScope() => new Scope(_db);

        private sealed class Scope : IServiceScope, IServiceProvider
        {
            private readonly DashboardDbContext _db;
            public Scope(DashboardDbContext db) => _db = db;
            public IServiceProvider ServiceProvider => this;
            public void Dispose() { /* DbContext owned by harness */ }
            public object? GetService(Type t) => t == typeof(DashboardDbContext) ? _db : null;
        }
    }

    private static TopologyOptions Defaults() => new()
    {
        CorrelationAttribute = "version",
        PerServiceOverrides = new Dictionary<string, string>(StringComparer.Ordinal),
    };

    [Fact]
    public async Task GetAsync_BootstrapsFromOptions_OnFirstCall()
    {
        using var h = new Harness(Defaults());

        var dto = await h.Store.GetAsync();

        Assert.Equal("version", dto.CorrelationAttribute);
        Assert.Empty(dto.PerServiceOverrides);

        // And persists for next call.
        var again = await h.Store.GetAsync();
        Assert.Equal("version", again.CorrelationAttribute);
    }

    [Fact]
    public async Task PatchAsync_UpdatesCorrelationAttribute_PersistsAcrossReads()
    {
        using var h = new Harness(Defaults());

        await h.Store.PatchAsync(new() { CorrelationAttribute = "actor" });

        var dto = await h.Store.GetAsync();
        Assert.Equal("actor", dto.CorrelationAttribute);
    }

    [Fact]
    public async Task PatchAsync_UnsetFields_LeftUnchanged()
    {
        using var h = new Harness(Defaults());

        // Seed with both fields.
        await h.Store.PatchAsync(new()
        {
            CorrelationAttribute = "run",
            PerServiceOverrides = new Dictionary<string, string?>
            {
                ["svc-x"] = "sha",
            },
        });

        // Patch only the overrides; correlationAttribute must persist.
        await h.Store.PatchAsync(new()
        {
            PerServiceOverrides = new Dictionary<string, string?>
            {
                ["svc-y"] = "actor",
            },
        });

        var dto = await h.Store.GetAsync();
        Assert.Equal("run", dto.CorrelationAttribute);
        Assert.Equal("sha", dto.PerServiceOverrides["svc-x"]);
        Assert.Equal("actor", dto.PerServiceOverrides["svc-y"]);
    }

    [Fact]
    public async Task PatchAsync_NullValue_RemovesPerServiceOverride()
    {
        using var h = new Harness(Defaults());

        await h.Store.PatchAsync(new()
        {
            PerServiceOverrides = new Dictionary<string, string?>
            {
                ["svc-x"] = "sha",
                ["svc-y"] = "actor",
            },
        });

        await h.Store.PatchAsync(new()
        {
            PerServiceOverrides = new Dictionary<string, string?>
            {
                ["svc-x"] = null,
            },
        });

        var dto = await h.Store.GetAsync();
        Assert.False(dto.PerServiceOverrides.ContainsKey("svc-x"));
        Assert.True(dto.PerServiceOverrides.ContainsKey("svc-y"));
    }

    [Fact]
    public async Task ResolveAttributeForServiceAsync_PerServiceOverride_BeatsGlobal()
    {
        using var h = new Harness(Defaults());

        await h.Store.PatchAsync(new()
        {
            CorrelationAttribute = "version",
            PerServiceOverrides = new Dictionary<string, string?>
            {
                ["svc-special"] = "actor",
            },
        });

        Assert.Equal("actor", await h.Store.ResolveAttributeForServiceAsync("svc-special"));
        Assert.Equal("version", await h.Store.ResolveAttributeForServiceAsync("svc-other"));
    }

    [Fact]
    public async Task ResolveAttributeForServiceAsync_MissingOverride_FallsBackToGlobalDefault()
    {
        // SAD §5 "Inputs" table: "Topology.PerServiceOverrides[service] if
        // present, else Topology.CorrelationAttribute (server-side default,
        // default `version`)".
        using var h = new Harness(new TopologyOptions
        {
            CorrelationAttribute = "run",
            PerServiceOverrides = new Dictionary<string, string>(StringComparer.Ordinal),
        });

        var attr = await h.Store.ResolveAttributeForServiceAsync("svc-unknown");
        Assert.Equal("run", attr);
    }

    [Fact]
    public async Task ResolveAttributeForServiceAsync_RequestOverride_BeatsServerDefault()
    {
        // SAD §7 precedence: PerServiceOverrides[svc] > query-param >
        // server default. When there is no per-service override, the
        // request-supplied attribute wins over the server default.
        using var h = new Harness(new TopologyOptions
        {
            CorrelationAttribute = "version",
            PerServiceOverrides = new Dictionary<string, string>(StringComparer.Ordinal),
        });

        var attr = await h.Store.ResolveAttributeForServiceAsync(
            "svc-x", requestOverride: "actor");
        Assert.Equal("actor", attr);
    }

    [Fact]
    public async Task ResolveAttributeForServiceAsync_PerServiceOverride_BeatsRequestOverride()
    {
        // SAD §7 "GET /api/deployments — query parameters":
        // "Per-service overrides win regardless: if
        // Topology.PerServiceOverrides[service] is set (ops-managed,
        // server-side), that attribute is used for `service` even when the
        // request supplies a different correlationAttribute."
        using var h = new Harness(Defaults());

        await h.Store.PatchAsync(new()
        {
            PerServiceOverrides = new Dictionary<string, string?>
            {
                ["svc-special"] = "sha",
            },
        });

        var attr = await h.Store.ResolveAttributeForServiceAsync(
            "svc-special", requestOverride: "actor");
        Assert.Equal("sha", attr);
    }

    [Fact]
    public async Task ResolveAttributeForServiceAsync_AbsentRequestOverride_FallsBackToServerDefault()
    {
        // The caller is allowed to pass null when the query parameter is
        // absent; the resolver must fall through to the server default.
        using var h = new Harness(new TopologyOptions
        {
            CorrelationAttribute = "version",
            PerServiceOverrides = new Dictionary<string, string>(StringComparer.Ordinal),
        });

        var attr = await h.Store.ResolveAttributeForServiceAsync(
            "svc-x", requestOverride: null);
        Assert.Equal("version", attr);
    }

    [Fact]
    public async Task PatchAsync_InvalidAttribute_Throws()
    {
        using var h = new Harness(Defaults());

        await Assert.ThrowsAsync<InvalidTopologyAttributeException>(() =>
            h.Store.PatchAsync(new() { CorrelationAttribute = "id" }));

        await Assert.ThrowsAsync<InvalidTopologyAttributeException>(() =>
            h.Store.PatchAsync(new() { CorrelationAttribute = "nonsense" }));
    }
}
