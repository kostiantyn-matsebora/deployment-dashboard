using Dashboard.Read.Repositories;
using Dashboard.Shared.Entities;
using Dashboard.Shared.Sse;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Read.Sse;

/// <summary>
/// Singleton background service responsible for:
/// <list type="bullet">
///   <item>Holding one dedicated Npgsql connection with <c>LISTEN deployment_events</c>.</item>
///   <item>Fetching the full <see cref="DeploymentEvent"/> row for every notified id.</item>
///   <item>Fan-outing events to all active SSE subscriber channels.</item>
/// </list>
/// The LISTEN loop and the broadcast loop run concurrently via an internal
/// <see cref="System.Threading.Channels.Channel{T}"/> that decouples notification receipt from DB access.
/// </summary>
internal sealed class DeploymentEventBroadcaster
    : PgListenFanOutBase<Guid, DeploymentEvent>, IDeploymentEventBroadcaster, IReadinessIndicator
{
    private readonly IServiceScopeFactory _scopeFactory;

    public DeploymentEventBroadcaster(
        IServiceScopeFactory scopeFactory,
        NpgsqlDataSource dataSource,
        ILogger<DeploymentEventBroadcaster> logger)
        : base(dataSource, logger)
    {
        _scopeFactory = scopeFactory;
    }

    // ── IReadinessIndicator ───────────────────────────────────────────────────

    public bool IsListenerConnected => IsListening;

    // ── Internal fan-out (exposed for unit tests via InternalsVisibleTo) ──────

    // Test seam: re-exposes the protected base Publish to Dashboard.Read.Tests.
    // PgListenFanOutBase.Publish is 'protected' and lives in Dashboard.Shared, so
    // Dashboard.Shared's InternalsVisibleTo cannot reach Dashboard.Read.Tests directly.
    // This thin 'internal new' wrapper lives in Dashboard.Read (which already declares
    // InternalsVisibleTo("Dashboard.Read.Tests")), giving tests compile-safe access.
    /// <summary>Writes <paramref name="ev"/> to every active subscriber channel.</summary>
    internal new void Publish(DeploymentEvent ev) => base.Publish(ev);

    // ── PgListenFanOutBase<Guid, DeploymentEvent> ─────────────────────────────

    protected override string PgChannelName => "deployment_events";

    protected override bool TryParseNotification(string payload, out Guid item) =>
        Guid.TryParse(payload, out item);

    protected override async Task<DeploymentEvent?> ResolveAsync(Guid id, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IDeploymentReadRepository>();
        return await repo.GetByIdAsync(id, ct);
    }
}
