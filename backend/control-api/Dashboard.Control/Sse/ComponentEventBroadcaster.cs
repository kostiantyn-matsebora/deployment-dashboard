using Dashboard.Control.Models;
using Dashboard.Control.Repositories;
using Dashboard.Shared.Sse;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Control.Sse;

/// <summary>
/// Singleton background service responsible for:
/// <list type="bullet">
///   <item>Holding one dedicated Npgsql connection with <c>LISTEN component_events</c>.</item>
///   <item>Fetching the full <see cref="Dashboard.Shared.Entities.ComponentEvent"/> row for every notified id.</item>
///   <item>Fan-outing <see cref="ComponentEventRecord"/> values to all active SSE subscriber channels.</item>
/// </list>
/// Mirrors <c>DeploymentEventBroadcaster</c>: the NOTIFY payload carries the row <c>id</c> only
/// (not the full JSON) because a component payload can reach 8 KiB, exceeding the Postgres NOTIFY limit
/// (§7 ch.4, API spec).
/// </summary>
internal sealed class ComponentEventBroadcaster
    : PgListenFanOutBase<Guid, ComponentEventRecord>, IComponentEventBroadcaster, IComponentEventReadinessIndicator
{
    private readonly IServiceScopeFactory _scopeFactory;

    public ComponentEventBroadcaster(
        IServiceScopeFactory scopeFactory,
        NpgsqlDataSource dataSource,
        ILogger<ComponentEventBroadcaster> logger)
        : base(dataSource, logger)
    {
        _scopeFactory = scopeFactory;
    }

    // ── IComponentEventReadinessIndicator ─────────────────────────────────────

    public bool IsComponentEventListenerConnected => IsListening;

    // ── PgListenFanOutBase<Guid, ComponentEventRecord> ────────────────────────

    protected override string PgChannelName => "component_events";

    protected override bool TryParseNotification(string payload, out Guid item) =>
        Guid.TryParse(payload, out item);

    protected override async Task<ComponentEventRecord?> ResolveAsync(Guid id, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IComponentEventRepository>();
        var entity = await repo.GetByIdAsync(id, ct);
        return entity is null ? null : ComponentEventRecord.FromEntity(entity);
    }
}
