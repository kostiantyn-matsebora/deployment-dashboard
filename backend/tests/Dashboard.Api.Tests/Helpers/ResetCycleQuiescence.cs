using Npgsql;

namespace Dashboard.Api.Tests.Helpers;

/// <summary>
/// Deterministic teardown barrier (issue #423 flake fix, 2nd pass) for every
/// <c>[Collection("api-postgres")]</c> class whose tests start a control orchestrator —
/// directly via <c>POST /api/control/reset</c>/<c>recover</c>, or indirectly by seeding an
/// orphaned <c>reset_cycle</c> row for the reconciler background service to pick up.
///
/// <para>
/// Root cause this replaces: the reset/recover orchestrator runs as a fire-and-forget
/// <c>Task.Run</c> that only acquires the Postgres advisory lock (7654321) — and only writes
/// its terminal state — <em>after</em> the endpoint has already returned 202 and claimed the
/// shared <c>reset_cycle</c> (id=1) row. Probing "advisory lock free" is therefore not a
/// quiescence signal: a drive can be pending while the lock is momentarily free between
/// acquisitions, and — worse — a never-acked orchestrator auto-advances the row back to
/// <c>idle</c> ~<c>AckTimeoutSeconds</c> (10 s) later regardless of which test is currently
/// running, because its idle/abort write is <c>WHERE id=1</c> with no correlation guard. If a
/// test's <c>DisposeAsync</c> tears down its <see cref="TestApiFactory"/> before that write
/// lands, the orchestrator's underlying Npgsql connection can still complete the write against
/// the shared container — clobbering whatever the *next* test has since claimed on the same row.
/// </para>
///
/// <para>
/// The fix: poll the row directly and require it to reach <c>idle</c> — the orchestrator's
/// own terminal state, reached deterministically once <c>AckTimeoutSeconds</c> elapses for a
/// never-acked cycle — <em>before</em> the caller disposes its factory. Once this returns, the
/// orchestrator (or reconciler abort) that owned the row has fully finished, so nothing is left
/// that could write to <c>reset_cycle</c> after this test's teardown. Because xUnit runs an
/// <c>api-postgres</c> collection's tests strictly serially, every test that follows starts
/// <see cref="PostgresFixture.ResetAsync"/> against a row with no orchestrator still driving it
/// — the leak is closed by construction, not by racing a fixed timeout against it.
/// </para>
///
/// <para>
/// Bounded well above the ~10 s a never-acked cycle needs (<c>AckTimeoutSeconds</c>) so routine
/// completion never trips it; a real wedge (stuck reconciler, hung connection) still fails
/// loudly instead of hanging the suite forever.
/// </para>
/// </summary>
internal static class ResetCycleQuiescence
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);

    public static Task WaitForIdleAsync(string connectionString) =>
        WaitForIdleAsync(connectionString, DefaultTimeout);

    public static async Task WaitForIdleAsync(string connectionString, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();

        string? state = null;
        do
        {
            await using (var cmd = new NpgsqlCommand("SELECT state FROM reset_cycle WHERE id = 1", conn))
            {
                state = (string?)await cmd.ExecuteScalarAsync();
            }

            if (state == "idle")
                return;

            await Task.Delay(100);
        } while (DateTimeOffset.UtcNow < deadline);

        Assert.Fail(
            $"reset_cycle (id=1) did not reach 'idle' within {timeout.TotalSeconds:F0}s of test " +
            $"teardown (last observed state='{state}'). A never-acked orchestrator reaches idle " +
            "in ~AckTimeoutSeconds (10s), so a real wedge here is a genuine orchestrator/reconciler " +
            "bug, not routine cross-test leak absorption.");
    }
}
