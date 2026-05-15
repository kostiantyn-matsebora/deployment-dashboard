using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Realtime;

namespace Dashboard.Shared.Tests.Realtime;

public sealed class SlotUpdateBrokerTests
{
    private static SlotUpdatePayload Payload(string version)
    {
        return new SlotUpdatePayload
        {
            Service = "svc",
            Environment = "dev",
            State = new MatrixSlot
            {
                Current = new CurrentDeployment
                {
                    Version = version,
                    Status = DeploymentStatus.Success,
                    RunUrl = "https://example.com/r",
                    RunNumber = 1,
                    Actor = "t",
                    DeployedAt = DateTime.UtcNow,
                },
                LastSuccessful = null,
                PreviousFailed = false,
            },
        };
    }

    private static void Publish(SlotUpdateBroker b, SlotUpdatePayload p)
    {
        // Publish is internal — invoke via reflection so this test stays
        // self-contained without exposing the method publicly.
        var m = typeof(SlotUpdateBroker)
            .GetMethod("Publish", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        m.Invoke(b, new object[] { p });
    }

    [Fact]
    public async Task Subscriber_ReceivesEventsPublishedAfterSubscribe()
    {
        var broker = new SlotUpdateBroker();
        using var sub = broker.Subscribe();

        Publish(broker, Payload("v1"));

        var update = await sub.Reader.ReadAsync();
        Assert.Equal("v1", update.Payload.State.Current.Version);
        Assert.Equal(1, update.Id); // monotonic broker id starts at 1
    }

    [Fact]
    public void ReplaySince_ReturnsBufferedEventsInOrder()
    {
        var broker = new SlotUpdateBroker(replayBufferSize: 8);
        for (var i = 1; i <= 3; i++) Publish(broker, Payload($"v{i}"));

        var replay = broker.ReplaySince(0);
        Assert.Equal(3, replay.Count);
        Assert.Equal(new long[] { 1, 2, 3 }, replay.Select(r => r.Id).ToArray());
    }

    [Fact]
    public void ReplaySince_SkipsEventsAtOrBelowGivenId()
    {
        var broker = new SlotUpdateBroker(replayBufferSize: 8);
        for (var i = 1; i <= 4; i++) Publish(broker, Payload($"v{i}"));

        var replay = broker.ReplaySince(2);
        Assert.Equal(new long[] { 3, 4 }, replay.Select(r => r.Id).ToArray());
    }

    [Fact]
    public void RingBuffer_EvictsOldestOnceFull()
    {
        var broker = new SlotUpdateBroker(replayBufferSize: 3);
        for (var i = 1; i <= 5; i++) Publish(broker, Payload($"v{i}"));

        var replay = broker.ReplaySince(0);
        Assert.Equal(3, replay.Count);
        Assert.Equal(new long[] { 3, 4, 5 }, replay.Select(r => r.Id).ToArray());
    }

    [Fact]
    public async Task MultipleSubscribers_EachReceiveAllEvents()
    {
        var broker = new SlotUpdateBroker();
        using var a = broker.Subscribe();
        using var b = broker.Subscribe();

        Publish(broker, Payload("v1"));
        Publish(broker, Payload("v2"));

        for (var i = 1; i <= 2; i++)
        {
            var ua = await a.Reader.ReadAsync();
            var ub = await b.Reader.ReadAsync();
            Assert.Equal($"v{i}", ua.Payload.State.Current.Version);
            Assert.Equal($"v{i}", ub.Payload.State.Current.Version);
        }
    }
}
