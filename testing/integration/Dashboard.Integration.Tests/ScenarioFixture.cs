using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Per-test fixture that resets the integration test substrate to a known
/// clean state, then provides a scenario-loader pass-through to the
/// <see cref="MockGhaClient"/>. xUnit instantiates this once per test
/// class (via <see cref="IClassFixture{TFixture}"/>) so each canonical
/// box-state class gets its own scenario isolation. Per CR-0012 § 3b the
/// integration profile pins <c>FETCHER_POLL_INTERVAL_SECONDS=1</c> so a
/// single fixture/test pair completes within the NFR-03 5 s envelope.
///
/// <para><b>Initialise — three steps:</b></para>
/// <list type="number">
///   <item><b>Reset mock-gha mappings.</b> Drops every per-test mapping
///   loaded by a previous scenario; the container's base-mappings mount
///   re-registers itself on next admin call.</item>
///   <item><b>Clear mock-gha request log.</b> Negative assertions
///   ("fetcher did NOT call workflow-contents") need a clean recording
///   window; this is per-test, not per-scenario.</item>
///   <item><b>Truncate the deployments table.</b> Shells out to
///   <c>testing/scripts/seed.ps1 -CleanOnly</c> with the same
///   <c>-Config</c> the runner used. Mirrors the functional runner's
///   teardown pattern; integration uses it as setup because the stack is
///   shared with the functional suite + the local SPA. Local-only by
///   contract: <c>seed.ps1 -CleanOnly</c> refuses non-localhost
///   targets.</item>
/// </list>
///
/// <para><b>Dispose.</b> No-op. We do not re-clean on teardown; the next
/// fixture's Initialize re-asserts the clean state. This keeps the last
/// scenario's mock-gha mappings + recorded requests + DB rows available
/// for ad-hoc post-mortem during a failing run.</para>
/// </summary>
public sealed class ScenarioFixture : IAsyncLifetime
{
    /// <summary>
    /// Admin client for the scenario's mock-gha. Owned by the fixture;
    /// individual tests do not construct their own.
    /// </summary>
    public MockGhaClient MockGha { get; }

    private readonly TimeSpan _cleanupBudget = TimeSpan.FromSeconds(30);

    public ScenarioFixture()
    {
        MockGha = new MockGhaClient();
    }

    public async Task InitializeAsync()
    {
        using var cts = new CancellationTokenSource(_cleanupBudget);

        await MockGha.DiscoverAdminSurfaceAsync(cts.Token);
        await MockGha.ResetMappingsAsync(cts.Token);
        await MockGha.ClearRecordedRequestsAsync(cts.Token);

        await TruncateDeploymentsAsync(cts.Token);
    }

    public Task DisposeAsync()
    {
        MockGha.Dispose();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Convenience pass-through so tests need not reach into
    /// <see cref="MockGha"/> for the most common operation.
    /// </summary>
    public Task LoadScenarioAsync(string scenarioName, CancellationToken ct = default)
        => MockGha.LoadScenarioAsync(scenarioName, ct);

    // ----- helpers -------------------------------------------------------

    private static async Task TruncateDeploymentsAsync(CancellationToken ct)
    {
        // Locate testing/scripts/seed.ps1 by walking upward from the
        // assembly location — same algorithm as ScenarioBundleLoader's
        // fixture-base resolver.
        var seedScript = LocateSeedScript();
        if (seedScript is null)
        {
            // Soft-warn rather than hard-fail: the dev_env may have an
            // alternative cleanup mechanism (e.g. a future docker exec).
            // The runner script already TRUNCATEs on teardown so the
            // worst case here is residue from a prior abnormal exit.
            return;
        }

        var configPath = Environment.GetEnvironmentVariable("DASHBOARD_INTEGRATION_CONFIG");
        // seed.ps1 -CleanOnly takes -Config to derive the target writeBaseUrl;
        // when DASHBOARD_INTEGRATION_CONFIG is unset, seed.ps1 falls back to
        // testing/config/local.json — same writeBaseUrl as integration.json
        // by design, so the truncate still hits the right database.
        var args = "-NoProfile -File \"" + seedScript + "\" -CleanOnly";
        if (!string.IsNullOrWhiteSpace(configPath))
        {
            args += " -Config \"" + configPath + "\"";
        }

        var psi = new ProcessStartInfo
        {
            FileName = "pwsh",
            Arguments = args,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to launch pwsh to invoke seed.ps1 -CleanOnly.");

        // Read streams to completion under the cancellation budget.
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        try
        {
            await proc.WaitForExitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch { /* best-effort */ }
            throw new TimeoutException(
                "seed.ps1 -CleanOnly exceeded the per-scenario cleanup budget.");
        }

        if (proc.ExitCode != 0)
        {
            var stderr = await stderrTask;
            var stdout = await stdoutTask;
            throw new InvalidOperationException(
                "seed.ps1 -CleanOnly exited " + proc.ExitCode + ". " +
                "stderr: " + stderr + " | stdout: " + stdout);
        }
    }

    private static string? LocateSeedScript()
    {
        var asmPath = typeof(ScenarioFixture).Assembly.Location;
        var startDir = string.IsNullOrEmpty(asmPath)
            ? Environment.CurrentDirectory
            : (Path.GetDirectoryName(asmPath) ?? Environment.CurrentDirectory);

        var cursor = new DirectoryInfo(startDir);
        while (cursor is not null)
        {
            var candidate = Path.Combine(cursor.FullName, "testing", "scripts", "seed.ps1");
            if (File.Exists(candidate)) return candidate;
            cursor = cursor.Parent;
        }
        return null;
    }
}
