using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Fetcher.Orchestration;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Control;

/// <summary>
/// HTTP client for <c>POST /api/control/events</c> (§5.10.4, §5.10.5, F18).
/// <c>X-Api-Key</c> and <c>X-Component-Id</c> are added by the typed-client factory in DI.
/// </summary>
public sealed class ComponentEventClient(
    HttpClient http,
    ILogger<ComponentEventClient> logger) : IComponentEventClient
{
    // ── Event type constants (outgoing to POST /api/control/events) ───────────

    /// <summary>Event type for a reset acknowledgement (§5.10.4).</summary>
    public const string EventTypeResetAck = "reset-ack";

    /// <summary>Event type for a status report (§5.10.5 / F18).</summary>
    public const string EventTypeStatus = "status";

    /// <summary>Event type for a rate-limit report (F18 / §5.11).</summary>
    public const string EventTypeRateLimit = "rate-limit";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <inheritdoc />
    public async Task PostAckAsync(string resetId, CancellationToken ct)
    {
        var body = new ComponentEventBody(
            EventType: EventTypeResetAck,
            State: ComponentState.Paused,
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: null);

        // X-Correlation-Id carries the ack-gate key (§5.10.4) — no payload.reset_id.
        await PostAsync(body, correlationId: resetId, ct);
    }

    /// <inheritdoc />
    public async Task PostRunningAsync(string resetId, CancellationToken ct)
    {
        var body = new ComponentEventBody(
            EventType: EventTypeStatus,
            State: ComponentState.Running,
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: null);

        // X-Correlation-Id optionally correlates recovery to the same reset process (§5.10.5).
        await PostAsync(body, correlationId: resetId, ct);
    }

    /// <inheritdoc />
    public async Task PostRateLimitAsync(
        RateLimitSnapshot snapshot,
        string adapterId,
        string state,
        CancellationToken ct)
    {
        // reset_at is null when the snapshot hasn't received a real reset timestamp yet.
        var resetAt = snapshot.ResetAt == DateTimeOffset.MinValue
            ? (DateTimeOffset?)null
            : snapshot.ResetAt;

        var body = new ComponentEventBody(
            EventType: EventTypeRateLimit,
            State: state,
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: new RateLimitPayload(
                Adapter: adapterId,
                CiLimit: snapshot.CiLimit,
                CiRemaining: snapshot.CiRemaining,
                OwnBudget: snapshot.Budget,
                OwnUsed: snapshot.Used,
                ResetAt: resetAt));

        // Non-reset post — no correlation header.
        await PostAsync(body, correlationId: null, ct);
    }

    private async Task PostAsync(ComponentEventBody body, string? correlationId, CancellationToken ct)
    {
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/control/events")
            {
                Content = JsonContent.Create(body, options: JsonOptions),
            };

            if (correlationId is not null)
                request.Headers.Add("X-Correlation-Id", correlationId);

            var response = await http.SendAsync(request, ct);

            if (!response.IsSuccessStatusCode)
                logger.LogWarning(
                    "[ComponentEvent] POST /api/control/events returned {Status}; event_type={EventType}",
                    (int)response.StatusCode, body.EventType);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Non-fatal per §5.10.4 / §5.11 — event post failure must not break the poll loop.
            logger.LogWarning(ex,
                "[ComponentEvent] POST /api/control/events failed; event_type={EventType}",
                body.EventType);
        }
    }

    // ── wire types ───────────────────────────────────────────────────────────

    private sealed record ComponentEventBody(
        [property: JsonPropertyName("event_type")] string EventType,
        [property: JsonPropertyName("state")] string State,
        [property: JsonPropertyName("occurred_at")] DateTimeOffset OccurredAt,
        [property: JsonPropertyName("payload")] object? Payload);

    /// <summary>
    /// Payload shape for <c>event_type: rate-limit</c> (§5.11 / api-guidelines §11).
    /// Fields serialised as snake_case via <see cref="JsonOptions"/>.
    /// </summary>
    private sealed record RateLimitPayload(
        string Adapter,
        int? CiLimit,
        int? CiRemaining,
        int OwnBudget,
        int OwnUsed,
        DateTimeOffset? ResetAt);
}
