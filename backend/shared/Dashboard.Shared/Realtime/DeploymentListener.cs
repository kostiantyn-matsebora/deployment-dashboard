using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Queries;
using Dashboard.Shared.Topology;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Shared.Realtime;

/// <summary>
/// Long-lived <c>LISTEN deployments</c> subscription owned by each Read API
/// replica. Reads the NOTIFY payload, derives the per-slot
/// <see cref="MatrixSlot"/> view (via <see cref="MatrixQuery.BuildSlotAsync"/>)
/// so the wire shape mirrors the REST endpoint, and pushes the resulting
/// <see cref="SlotUpdatePayload"/> into the in-process
/// <see cref="SlotUpdateBroker"/>.
///
/// <para>The listener uses its own dedicated <see cref="NpgsqlConnection"/>
/// (NOT borrowed from the EF Core pool) per SAD statelessness rules. If
/// the connection drops, the background loop reconnects with exponential
/// backoff. The per-slot DB read for derivation runs in a fresh DI scope
/// each time — request-scoped <see cref="DashboardDbContext"/> instances
/// are never reused across NOTIFY callbacks.</para>
/// </summary>
public sealed class DeploymentListener : BackgroundService
{
    private readonly string _connectionString;
    private readonly SlotUpdateBroker _broker;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DeploymentListener> _logger;

    public DeploymentListener(
        string connectionString,
        SlotUpdateBroker broker,
        IServiceScopeFactory scopeFactory,
        ILogger<DeploymentListener> logger)
    {
        _connectionString = connectionString;
        _broker = broker;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var backoff = TimeSpan.FromSeconds(1);
        var maxBackoff = TimeSpan.FromSeconds(30);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                conn.Notification += OnNotification;
                await conn.OpenAsync(stoppingToken);

                await using (var listen = new NpgsqlCommand(
                    $"LISTEN {DeploymentNotifier.ChannelName}", conn))
                {
                    await listen.ExecuteNonQueryAsync(stoppingToken);
                }

                _logger.LogInformation("Subscribed to PostgreSQL channel {Channel}",
                    DeploymentNotifier.ChannelName);

                // Successful connect resets the backoff so a brief blip
                // doesn't compound across many cycles.
                backoff = TimeSpan.FromSeconds(1);

                while (!stoppingToken.IsCancellationRequested)
                {
                    // WaitAsync blocks until a NOTIFY arrives or the
                    // connection is closed, at which point it throws.
                    await conn.WaitAsync(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // graceful shutdown
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "LISTEN loop dropped; reconnecting in {Delay}s",
                    backoff.TotalSeconds);
                try
                {
                    await Task.Delay(backoff, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }

                backoff = backoff < maxBackoff
                    ? TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, maxBackoff.TotalSeconds))
                    : maxBackoff;
            }
        }
    }

    private void OnNotification(object sender, NpgsqlNotificationEventArgs args)
    {
        if (args.Channel != DeploymentNotifier.ChannelName) return;

        // Npgsql raises Notification on a sync callback; fire-and-forget the
        // async derivation so we don't block the LISTEN socket. Errors are
        // logged inside HandlePayloadAsync — they cannot bubble back here.
        _ = HandlePayloadAsync(args.Payload);
    }

    private async Task HandlePayloadAsync(string rawPayload)
    {
        DeploymentEventResponse? evt;
        try
        {
            evt = JsonSerializer.Deserialize<DeploymentEventResponse>(rawPayload, DashboardJson.Options);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Failed to deserialise NOTIFY payload on {Channel}: {Payload}",
                DeploymentNotifier.ChannelName, rawPayload);
            return;
        }

        if (evt is null)
        {
            _logger.LogWarning("Received empty NOTIFY payload on {Channel}",
                DeploymentNotifier.ChannelName);
            return;
        }

        try
        {
            // Derive the per-slot view in a fresh DI scope so the
            // DashboardDbContext lifecycle isn't tied to the LISTEN loop.
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            var topologyBuilder = scope.ServiceProvider.GetRequiredService<TopologyBuilder>();
            var configStore = scope.ServiceProvider.GetRequiredService<TopologyConfigStore>();

            // The SSE wire intentionally drops topology (SAD §7 "SSE
            // topology semantics — single source of truth"; Decision §10 #8).
            // We still resolve the server-side correlation attribute and
            // build the per-slot view so callers see identical `state`
            // between REST and SSE. The discarded topology snapshot is the
            // server-default one — clients refresh their topology via a
            // follow-up GET with their own picker preference.
            var attribute = await configStore.ResolveAttributeForServiceAsync(evt.Service);
            var (state, _) = await MatrixQuery.BuildSlotAsync(
                db, evt.Service, evt.Environment, topologyBuilder, attribute);
            if (state is null)
            {
                // Pruning may have raced the NOTIFY — extremely unlikely but
                // defensible: skip the publish and log so the gap is visible.
                _logger.LogWarning(
                    "NOTIFY received for {Service}/{Environment} but no history exists; skipping fan-out.",
                    evt.Service, evt.Environment);
                return;
            }

            // SAD §7 "SSE slot-update data payload": slot updates only, no
            // topology — the SPA refreshes topology via
            // GET /api/deployments?correlationAttribute=<picker> after each
            // event ("SSE topology semantics" + Decision §10 #8).
            _broker.Publish(new SlotUpdatePayload
            {
                Service = evt.Service,
                Environment = evt.Environment,
                State = state,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Failed to derive slot state for {Service}/{Environment} after NOTIFY",
                evt.Service, evt.Environment);
        }
    }
}
