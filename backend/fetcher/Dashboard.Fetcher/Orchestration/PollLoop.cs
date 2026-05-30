using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Ingest;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Orchestration;

/// <summary>
/// Tool-agnostic poll loop. One instance per adapter (§4).
/// Cursor persisted only after all POSTs succeed — guarantees at-least-once delivery (F5).
/// </summary>
public sealed class PollLoop(
    ICiCdAdapter adapter,
    IIngestClient ingest,
    IFetcherStateClient state,
    TimeSpan pollInterval,
    ILogger<PollLoop> logger)
{
    public async Task RunAsync(CancellationToken ct)
    {
        var cursor = await state.GetAsync(adapter.AdapterId, ct);
        logger.LogInformation("[{Adapter}] poll loop starting; cursor={HasCursor}",
            adapter.AdapterId, cursor is not null);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                cursor = await PollOnceAsync(cursor, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[{Adapter}] poll error; retrying next interval",
                    adapter.AdapterId);
            }

            try
            {
                await Task.Delay(pollInterval, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<string?> PollOnceAsync(string? cursor, CancellationToken ct)
    {
        var result = await adapter.FetchAsync(cursor, ct);

        foreach (var ev in result.Events)
            await ingest.PostAsync(ev, adapter.AdapterId, ct);

        // Advance cursor only after all POSTs succeed (F5)
        if (result.Events.Count > 0 && result.Cursor != cursor)
        {
            await state.PutAsync(adapter.AdapterId, result.Cursor!, ct);
            cursor = result.Cursor;
        }

        return cursor;
    }
}
