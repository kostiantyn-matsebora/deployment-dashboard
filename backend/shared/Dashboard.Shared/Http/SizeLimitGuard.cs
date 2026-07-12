using System.Text;

namespace Dashboard.Shared.Http;

/// <summary>
/// Centralises the "measure a payload against a size cap, and if it's over, describe why" idiom
/// duplicated across write-surface endpoints (issue #391 review) — <c>PresetEndpoints.ValidateBundleSize</c>,
/// <c>FetcherStateEndpoints.HandlePutAsync</c>, <c>ControlEndpoints.SerializeAndValidatePayload</c> each
/// independently measured a size, compared it to a cap, and built a <c>413</c> RFC-9457 Problem.
/// </summary>
/// <remarks>
/// Deliberately framework-agnostic (no <c>Microsoft.AspNetCore.Http</c> dependency): <see cref="Dashboard.Shared"/>
/// is also referenced by <c>Dashboard.Fetcher</c>, a non-web host with no ASP.NET Core framework reference.
/// Returns a plain title/detail pair; callers build their own <c>Results.Problem(..., statusCode: 413)</c> at
/// the endpoint layer, so each endpoint's exact wording and status code stay under its own control.
/// </remarks>
public static class SizeLimitGuard
{
    /// <summary>
    /// Byte-count-based cap: measures the UTF-8 byte count of <paramref name="json"/>. Matches the
    /// "serialise → count bytes → compare" idiom used when the size limit is expressed in bytes
    /// (a request body or a re-serialised field), as opposed to a character-count cap.
    /// </summary>
    public static (string Title, string Detail)? EnsureWithinBytes(
        string json, int maxBytes, string title, string detail) =>
        EnsureWithinSize(Encoding.UTF8.GetByteCount(json), maxBytes, title, detail);

    /// <summary>
    /// Size-agnostic cap: compares an already-computed <paramref name="actualSize"/> (bytes, chars,
    /// or any other unit the caller measured) against <paramref name="maxSize"/>. Returns
    /// <paramref name="title"/>/<paramref name="detail"/> unchanged when over the cap, so the exact
    /// wording each endpoint used before extraction is preserved verbatim.
    /// </summary>
    public static (string Title, string Detail)? EnsureWithinSize(
        int actualSize, int maxSize, string title, string detail) =>
        actualSize > maxSize ? (title, detail) : null;
}
