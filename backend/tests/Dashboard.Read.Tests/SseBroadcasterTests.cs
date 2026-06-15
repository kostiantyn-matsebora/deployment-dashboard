using Dashboard.Read.Sse;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace Dashboard.Read.Tests;

/// <summary>
/// Unit tests for <see cref="DeploymentEventBroadcaster"/> covering the subscription
/// and fan-out logic without involving a real Postgres connection.
/// The Postgres LISTEN loop is never started — only <see cref="DeploymentEventBroadcaster.Subscribe"/>,
/// <see cref="DeploymentEventBroadcaster.Unsubscribe"/>, and the internal
/// <see cref="DeploymentEventBroadcaster.Publish"/> method are exercised.
/// </summary>
public sealed class SseBroadcasterTests
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    private static DeploymentEventBroadcaster CreateBroadcaster()
    {
        // IServiceScopeFactory is injected but only used in BroadcastAsync (the Postgres path),
        // which is never invoked by these tests.
        var services = new ServiceCollection().BuildServiceProvider();
        var scopeFactory = services.GetRequiredService<IServiceScopeFactory>();
        // These tests never open a Postgres connection; supply a dummy data source.
        var dataSource = NpgsqlDataSource.Create("Host=localhost");
        var logger = NullLogger<DeploymentEventBroadcaster>.Instance;
        return new DeploymentEventBroadcaster(scopeFactory, dataSource, logger);
    }

    private static DeploymentEvent MakeEvent(string service = "svc-a") => new()
    {
        Id = Guid.CreateVersion7(),
        DeploymentId = $"dep-{Guid.NewGuid():N}",
        Service = service,
        Environment = "prod",
        Status = "success",
        HappenedAt = DateTimeOffset.UtcNow,
    };

    // ── IReadinessIndicator ───────────────────────────────────────────────────

    [Fact]
    public void IsListenerConnected_BeforeListenStarted_IsFalse()
    {
        // The broadcaster is constructed but ExecuteAsync / ListenAsync has never run.
        var broadcaster = CreateBroadcaster();
        Assert.False(broadcaster.IsListenerConnected);
    }

    // ── Subscribe ─────────────────────────────────────────────────────────────

    [Fact]
    public void Subscribe_ReturnsNonNullReader()
    {
        var broadcaster = CreateBroadcaster();

        var reader = broadcaster.Subscribe();

        Assert.NotNull(reader);
    }

    [Fact]
    public void Subscribe_MultipleSubscribers_ReturnsDistinctReaders()
    {
        var broadcaster = CreateBroadcaster();

        var r1 = broadcaster.Subscribe();
        var r2 = broadcaster.Subscribe();

        Assert.NotSame(r1, r2);
    }

    // ── Unsubscribe ───────────────────────────────────────────────────────────

    [Fact]
    public void Unsubscribe_CompletesTheChannel_ReaderCanNoLongerRead()
    {
        var broadcaster = CreateBroadcaster();
        var reader = broadcaster.Subscribe();

        broadcaster.Unsubscribe(reader);

        Assert.True(reader.Completion.IsCompleted);
    }

    [Fact]
    public void Unsubscribe_UnknownReader_DoesNotThrow()
    {
        var broadcaster = CreateBroadcaster();
        var otherBroadcaster = CreateBroadcaster();
        var foreignReader = otherBroadcaster.Subscribe();

        // Unsubscribing a reader that was never registered must be silent.
        var exception = Record.Exception(() => broadcaster.Unsubscribe(foreignReader));

        Assert.Null(exception);
    }

    // ── Publish (fan-out) ─────────────────────────────────────────────────────

    [Fact]
    public async Task Publish_SingleSubscriber_EventArrivesOnReader()
    {
        var broadcaster = CreateBroadcaster();
        var reader = broadcaster.Subscribe();
        var ev = MakeEvent();

        broadcaster.Publish(ev);

        Assert.True(reader.TryRead(out var received));
        Assert.Equal(ev.Id, received!.Id);
    }

    [Fact]
    public async Task Publish_MultipleSubscribers_EventArrivesOnAllReaders()
    {
        var broadcaster = CreateBroadcaster();
        var r1 = broadcaster.Subscribe();
        var r2 = broadcaster.Subscribe();
        var r3 = broadcaster.Subscribe();
        var ev = MakeEvent();

        broadcaster.Publish(ev);

        Assert.True(r1.TryRead(out var e1));
        Assert.True(r2.TryRead(out var e2));
        Assert.True(r3.TryRead(out var e3));
        Assert.Equal(ev.Id, e1!.Id);
        Assert.Equal(ev.Id, e2!.Id);
        Assert.Equal(ev.Id, e3!.Id);
    }

    [Fact]
    public void Publish_AfterUnsubscribe_DoesNotDeliverToUnsubscribedReader()
    {
        var broadcaster = CreateBroadcaster();
        var active = broadcaster.Subscribe();
        var removed = broadcaster.Subscribe();
        broadcaster.Unsubscribe(removed);
        var ev = MakeEvent();

        broadcaster.Publish(ev);

        // The unsubscribed reader's channel is completed — it should have no items.
        Assert.False(removed.TryRead(out _));
        // The active reader still receives the event.
        Assert.True(active.TryRead(out var received));
        Assert.Equal(ev.Id, received!.Id);
    }

    [Fact]
    public void Publish_NoSubscribers_DoesNotThrow()
    {
        var broadcaster = CreateBroadcaster();
        var ev = MakeEvent();

        var exception = Record.Exception(() => broadcaster.Publish(ev));

        Assert.Null(exception);
    }

    [Fact]
    public async Task Publish_MultipleEvents_AllArrivesInOrder()
    {
        var broadcaster = CreateBroadcaster();
        var reader = broadcaster.Subscribe();
        var ev1 = MakeEvent();
        var ev2 = MakeEvent();
        var ev3 = MakeEvent();

        broadcaster.Publish(ev1);
        broadcaster.Publish(ev2);
        broadcaster.Publish(ev3);

        Assert.True(reader.TryRead(out var r1));
        Assert.True(reader.TryRead(out var r2));
        Assert.True(reader.TryRead(out var r3));
        Assert.Equal(ev1.Id, r1!.Id);
        Assert.Equal(ev2.Id, r2!.Id);
        Assert.Equal(ev3.Id, r3!.Id);
    }
}
