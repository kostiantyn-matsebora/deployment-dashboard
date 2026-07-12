using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Orchestration;

/// <summary>
/// Tool-agnostic slow-cadence loop (issue #391 — preset discovery; see
/// FETCHER_SPECIFICATION.md "Preset discovery"), sibling to <see cref="PollLoop"/> but
/// independent of it — separate cadence, no cursor, no pause/resume. Runs
/// <paramref name="runOnceAsync"/> on <paramref name="interval"/>, swallowing per-cycle
/// exceptions so one bad cycle never stops the loop (same at-least-tries philosophy as
/// <see cref="PollLoop"/>'s retry-next-interval behaviour).
/// </summary>
public sealed class DiscoveryLoop(
    Func<CancellationToken, Task> runOnceAsync,
    TimeSpan interval,
    ILogger<DiscoveryLoop> logger)
{
    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await runOnceAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[Discovery] cycle failed; retrying next interval");
            }

            if (!await WaitIntervalAsync(ct)) break;
        }
    }

    private async Task<bool> WaitIntervalAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(interval, ct).ConfigureAwait(false);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
