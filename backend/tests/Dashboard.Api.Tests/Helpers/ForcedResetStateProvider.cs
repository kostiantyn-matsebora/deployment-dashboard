using Dashboard.Shared.Abstractions;

namespace Dashboard.Api.Tests.Helpers;

/// <summary>
/// Test stub for <see cref="IResetStateProvider"/> that allows tests to directly control
/// whether the ingest gate returns 503, without having to trigger the full NOTIFY/LISTEN
/// pipeline through Postgres (Fix C integration test support).
/// </summary>
internal sealed class ForcedResetStateProvider : IResetStateProvider
{
    public bool IsResetting { get; set; }
}
