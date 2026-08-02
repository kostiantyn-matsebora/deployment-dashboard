using System.Text.Json;

namespace Dashboard.Control.Services;

/// <summary>
/// Builds the <c>{"since":"…"}</c> payload JSON carried by every <c>recover-*</c> control event
/// (mirrors the resolved rewind point echoed in <c>RecoverAcceptedResponse.Since</c>). Shared by
/// <see cref="RecoverOrchestrator"/> (normal completion) and <see cref="ResetReconciler"/>
/// (orphan-abort completion) so both paths serialise identically.
/// </summary>
internal static class RecoverPayload
{
    public static string Build(DateTimeOffset since) => JsonSerializer.Serialize(new { since });
}
