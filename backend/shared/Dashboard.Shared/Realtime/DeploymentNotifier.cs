using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Shared.Realtime;

/// <summary>
/// Fires a PostgreSQL <c>NOTIFY deployments, '&lt;payload&gt;'</c> after a
/// successful insert (SAD §7 — Real-time path). Owned by the Write API.
///
/// <para>The notifier is configured with a raw Npgsql connection string
/// rather than going through EF Core's pooled connection so the NOTIFY
/// command lands on a dedicated short-lived connection that doesn't share
/// transactional state with the calling DbContext.</para>
///
/// <para>The payload is serialised with the same JSON options used by the
/// REST surface so the Read API's SSE forwarder can deserialise it
/// 1:1 into a <see cref="DeploymentEventResponse"/>.</para>
/// </summary>
public class DeploymentNotifier
{
    public const string ChannelName = "deployments";

    private readonly string _connectionString;
    private readonly ILogger<DeploymentNotifier> _logger;

    public DeploymentNotifier(string connectionString, ILogger<DeploymentNotifier> logger)
    {
        _connectionString = connectionString;
        _logger = logger;
    }

    /// <summary>
    /// Serialises the given event and fires NOTIFY. Errors are logged but
    /// not rethrown — the write has already succeeded and the matrix is the
    /// source of truth; SSE clients will pick up the change on their next
    /// reconnect or via polling fallback.
    /// </summary>
    public virtual async Task PublishAsync(DeploymentEventResponse evt, CancellationToken ct = default)
    {
        try
        {
            var payload = JsonSerializer.Serialize(evt, DashboardJson.Options);

            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand("SELECT pg_notify(@channel, @payload)", conn);
            cmd.Parameters.AddWithValue("channel", ChannelName);
            cmd.Parameters.AddWithValue("payload", payload);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Failed to NOTIFY {Channel} for deployment {Id}; SSE clients will pick up the change on reconnect.",
                ChannelName, evt.Id);
        }
    }
}
