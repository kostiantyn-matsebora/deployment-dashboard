using Microsoft.Extensions.Configuration;

namespace Dashboard.Control.Options;

/// <summary>
/// Applies SCREAMING_SNAKE environment-variable overrides to a <see cref="ResetOptions"/> instance
/// that has already been bound from the <c>appsettings.json</c> <c>Reset</c> section.
/// </summary>
/// <remarks>
/// Override precedence (highest wins):
/// <list type="table">
///   <item><term><c>RESET_ACK_TIMEOUT_SECONDS</c></term><description>Replaces <see cref="ResetOptions.AckTimeoutSeconds"/> when parseable as int.</description></item>
///   <item><term><c>RESET_GATE_MAX_TTL_SECONDS</c></term><description>Replaces <see cref="ResetOptions.GateMaxTtlSeconds"/> when parseable as int.</description></item>
///   <item><term><c>RESET_EXPECTED_COMPONENTS</c></term><description>CSV string — split on <c>,</c>, trimmed, empty entries dropped — replaces the array wholesale when non-empty.</description></item>
///   <item><term><c>RESET_RECOVER_MAX_DAYS_BACK</c></term><description>Replaces <see cref="ResetOptions.RecoverMaxDaysBack"/> when parseable as int.</description></item>
/// </list>
/// </remarks>
public static class ResetOptionsEnv
{
    /// <summary>
    /// Reads <c>RESET_ACK_TIMEOUT_SECONDS</c>, <c>RESET_GATE_MAX_TTL_SECONDS</c>,
    /// <c>RESET_EXPECTED_COMPONENTS</c>, and <c>RESET_RECOVER_MAX_DAYS_BACK</c> from
    /// <paramref name="config"/> and applies any valid values to <paramref name="options"/> in place.
    /// </summary>
    public static void ApplyEnvOverrides(IConfiguration config, ResetOptions options)
    {
        ApplyInt(config, "RESET_ACK_TIMEOUT_SECONDS", v => options.AckTimeoutSeconds = v);
        ApplyInt(config, "RESET_GATE_MAX_TTL_SECONDS", v => options.GateMaxTtlSeconds = v);
        ApplyCsvArray(config, "RESET_EXPECTED_COMPONENTS", v => options.ExpectedComponents = v);
        ApplyInt(config, "RESET_RECOVER_MAX_DAYS_BACK", v => options.RecoverMaxDaysBack = v);
    }

    private static void ApplyInt(IConfiguration config, string key, Action<int> apply)
    {
        var raw = config[key];
        if (raw is not null && int.TryParse(raw, out var value))
            apply(value);
    }

    private static void ApplyCsvArray(IConfiguration config, string key, Action<string[]> apply)
    {
        var raw = config[key];
        if (string.IsNullOrWhiteSpace(raw))
            return;

        var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length > 0)
            apply(parts);
    }
}
