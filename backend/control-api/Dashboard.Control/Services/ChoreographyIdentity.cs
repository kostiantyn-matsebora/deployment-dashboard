using Microsoft.Extensions.Logging;

namespace Dashboard.Control.Services;

/// <summary>
/// The per-orchestrator identity the shared static choreography helpers need for logging:
/// the orchestrator's own <see cref="ILogger"/> (so log entries carry the right category) and its
/// human-readable operation label (<c>"Reset"</c> | <c>"Recover"</c>) used to parameterise the
/// otherwise-identical log message templates. Grouped into one value object (data clump → value
/// object) rather than threading both through every shared helper's parameter list.
/// </summary>
internal readonly record struct ChoreographyIdentity(ILogger Logger, string OperationLabel)
{
    public string LowerLabel => OperationLabel.ToLowerInvariant();
}
