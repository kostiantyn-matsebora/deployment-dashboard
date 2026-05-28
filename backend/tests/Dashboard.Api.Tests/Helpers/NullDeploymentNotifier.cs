using Dashboard.Shared.Abstractions;

namespace Dashboard.Api.Tests.Helpers;

/// <summary>No-op notifier used in integration tests to avoid Postgres NOTIFY calls.</summary>
internal sealed class NullDeploymentNotifier : IDeploymentNotifier
{
    public Task NotifyAsync(Guid eventId, CancellationToken ct = default) => Task.CompletedTask;
}
