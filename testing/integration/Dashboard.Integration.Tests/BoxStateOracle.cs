using System;
using Dashboard.Shared.Dto;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Pure-function state-id classifier for a single matrix slot. Codifies
/// the six canonical box-state conditions verbatim from
/// <c>local/index/ui-states.yaml</c> + the Phase 3 design-review table
/// re-published in <c>docs/integration-tests.md § 9</c>.
///
/// <para><b>Six-state table (source-of-truth: <c>local/index/ui-states.yaml</c>):</b></para>
/// <list type="bullet">
///   <item><c>success</c>                 — Last deployment succeeded.</item>
///   <item><c>running-with-last</c>       — Deploying now; previous terminal was success.</item>
///   <item><c>running-failed-with-last</c>— Deploying now; previous terminal was failure; older success exists.</item>
///   <item><c>failed-with-last</c>        — Last deployment failed; older success exists.</item>
///   <item><c>running</c>                 — Deploying now; no prior successful deployment.</item>
///   <item><c>running-failed</c>          — Deploying now; previous terminal was failure; no successful history.</item>
/// </list>
///
/// <para><b>Mapping rules (boolean truth table):</b></para>
/// <para>
/// Inputs derived from the wire shape of <c>GET /api/deployments</c>
/// (one slot per <c>(service, environment)</c>):
/// <list type="bullet">
///   <item><c>current.status</c> ∈ <c>{ success | in-progress | failure }</c></item>
///   <item><c>lastSuccessful</c> — present-or-null (presence ⇔ "older success exists" for non-success current)</item>
///   <item><c>previousFailed</c> — bool (true ⇔ current is in-progress AND most recent terminal before it was failure)</item>
/// </list>
/// </para>
///
/// <para><b>Truth table</b> (rows in canonical declaration order from the
/// six-state YAML; matches the Phase 3 design-review table verbatim):</para>
/// <code>
///   current.status   lastSuccessful   previousFailed     →   state-id
///   ──────────────   ───────────────  ────────────────       ───────────────────────────
///   success          (irrelevant)     (irrelevant)       →   success
///   in-progress      present          false              →   running-with-last
///   in-progress      present          true               →   running-failed-with-last
///   failure          present          (irrelevant)       →   failed-with-last
///   in-progress      null             false              →   running
///   in-progress      null             true               →   running-failed
/// </code>
///
/// <para><b>Unmatched rows.</b> The slot's wire shape is constrained by
/// the server (see <c>backend/api/Dashboard.ReadApi/Queries/MatrixQuery.cs</c>
/// invariants); any combination outside the six rows above indicates a
/// regression and throws <see cref="InvalidOperationException"/>.</para>
///
/// <para><b>Why the oracle is a separate class.</b> Tests stay focused on
/// "this scenario drives the slot to state X"; the oracle takes the
/// scenario-driven slot and re-derives the state-id from first principles.
/// Hard-coding the expected state-id inside the test would tautologically
/// pass on a buggy classifier; routing through the oracle proves the wire
/// shape + the classifier agree.</para>
/// </summary>
public static class BoxStateOracle
{
    public const string Success = "success";
    public const string RunningWithLast = "running-with-last";
    public const string RunningFailedWithLast = "running-failed-with-last";
    public const string FailedWithLast = "failed-with-last";
    public const string Running = "running";
    public const string RunningFailed = "running-failed";

    private const string StatusSuccess = "success";
    private const string StatusInProgress = "in-progress";
    private const string StatusFailure = "failure";

    /// <summary>
    /// Classify a single matrix slot's state-id from its wire shape.
    /// </summary>
    public static string Classify(MatrixSlot slot)
    {
        if (slot is null) throw new ArgumentNullException(nameof(slot));
        if (slot.Current is null)
        {
            throw new InvalidOperationException(
                "MatrixSlot.current is null — slot has no history. " +
                "An empty slot cannot resolve to a canonical box state.");
        }

        var status = slot.Current.Status;
        var hasLast = slot.LastSuccessful is not null;
        var prevFailed = slot.PreviousFailed;

        // Row 1 — success
        if (string.Equals(status, StatusSuccess, StringComparison.Ordinal))
        {
            return Success;
        }

        // Row 4 — failed-with-last
        if (string.Equals(status, StatusFailure, StringComparison.Ordinal))
        {
            if (hasLast) return FailedWithLast;
            throw new InvalidOperationException(
                "current.status='failure' without lastSuccessful is not one of the six canonical box states. " +
                "Per ui-states.yaml the failure-without-history case is not modelled (terminal failures always " +
                "expose lastSuccessful when one exists; the no-history-and-failed case never occurs because the " +
                "matrix-frontend showsfailures only after at least one cycle).");
        }

        // Rows 2/3/5/6 — in-progress permutations
        if (string.Equals(status, StatusInProgress, StringComparison.Ordinal))
        {
            return (hasLast, prevFailed) switch
            {
                (true,  false) => RunningWithLast,
                (true,  true)  => RunningFailedWithLast,
                (false, false) => Running,
                (false, true)  => RunningFailed,
            };
        }

        throw new InvalidOperationException(
            $"current.status='{status}' is not one of {{success, in-progress, failure}}. " +
            "The matrix wire shape does not admit any other status value.");
    }

    /// <summary>
    /// Same as <see cref="Classify(MatrixSlot)"/> but takes the raw
    /// matrix-row JSON the integration tests deserialise out of
    /// <c>GET /api/deployments</c>. Convenience for tests that hold the
    /// JSON envelope rather than the typed DTO.
    /// </summary>
    public static string ClassifyFromJson(System.Text.Json.JsonElement slot)
    {
        if (!slot.TryGetProperty("current", out var current) ||
            current.ValueKind != System.Text.Json.JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                "Slot JSON has no 'current' object — cannot classify.");
        }

        var status = current.TryGetProperty("status", out var statusEl) &&
                     statusEl.ValueKind == System.Text.Json.JsonValueKind.String
            ? statusEl.GetString() ?? string.Empty
            : string.Empty;

        var hasLast = slot.TryGetProperty("lastSuccessful", out var ls) &&
                      ls.ValueKind == System.Text.Json.JsonValueKind.Object;

        var prevFailed = slot.TryGetProperty("previousFailed", out var pf) &&
                         pf.ValueKind == System.Text.Json.JsonValueKind.True;

        if (status == StatusSuccess) return Success;
        if (status == StatusFailure)
        {
            if (hasLast) return FailedWithLast;
            throw new InvalidOperationException(
                "current.status='failure' without lastSuccessful is not one of the six canonical box states.");
        }
        if (status == StatusInProgress)
        {
            return (hasLast, prevFailed) switch
            {
                (true,  false) => RunningWithLast,
                (true,  true)  => RunningFailedWithLast,
                (false, false) => Running,
                (false, true)  => RunningFailed,
            };
        }
        throw new InvalidOperationException(
            $"current.status='{status}' is not one of {{success, in-progress, failure}}.");
    }
}
