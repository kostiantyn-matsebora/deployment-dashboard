using Microsoft.AspNetCore.Http;

namespace Dashboard.Shared.Validation;

/// <summary>
/// Centralised factory for <c>application/problem+json</c> responses
/// (RFC 7807) emitted by both API surfaces (CR-0008 § 3c).
///
/// <para>Every 4xx response body in the API conforms to ASP.NET Core's
/// built-in <c>ProblemDetails</c> / <c>ValidationProblemDetails</c> shape.
/// The non-standard <c>error</c> slug (e.g. <c>cross_service_parent_reference</c>)
/// that earlier code carried as the JSON body is preserved as an
/// <c>extensions["error"]</c> entry so existing functional tests (and any
/// downstream CI script that pattern-matches on it) continue to work — only
/// the body shape standardises.</para>
///
/// <para>Status-code mapping (CR-0008 table § "Status-code mapping"):</para>
/// <list type="bullet">
///   <item>422 — DataAnnotations validation failure (handled in-line via
///   <c>Results.ValidationProblem</c>, not here).</item>
///   <item>400 — cross-service parent, topology cycle, malformed JSON,
///   unknown <c>correlationAttribute</c>.</item>
///   <item>401 — missing / invalid API key (owned by
///   <c>ApiKeyMiddleware</c>).</item>
///   <item>409 — duplicate <c>(service, deployment_id)</c>.</item>
///   <item>404 — not-found resource on a Read endpoint.</item>
/// </list>
/// </summary>
public static class ProblemResults
{
    private const string Rfc7231BadRequestType = "https://tools.ietf.org/html/rfc7231#section-6.5.1";
    private const string Rfc7231NotFoundType = "https://tools.ietf.org/html/rfc7231#section-6.5.4";
    private const string Rfc7231ConflictType = "https://tools.ietf.org/html/rfc7231#section-6.5.8";

    /// <summary>
    /// 400 Bad Request. <paramref name="errorSlug"/> goes into
    /// <c>extensions["error"]</c> so existing tests pattern-matching on the
    /// slug keep passing; everything else lives on the standard
    /// <c>ProblemDetails</c> fields.
    /// </summary>
    public static IResult BadRequest(
        string title,
        string detail,
        string errorSlug,
        IDictionary<string, object?>? extra = null)
    {
        var extensions = new Dictionary<string, object?> { ["error"] = errorSlug };
        if (extra is not null)
        {
            foreach (var kv in extra) extensions[kv.Key] = kv.Value;
        }
        return Results.Problem(
            title: title,
            detail: detail,
            statusCode: StatusCodes.Status400BadRequest,
            type: Rfc7231BadRequestType,
            extensions: extensions);
    }

    /// <summary>
    /// 409 Conflict — duplicate (service, deployment_id). Preserves the
    /// existing <c>existing_id</c> / <c>deployment_id</c> extras so callers
    /// can still introspect the offending row.
    /// </summary>
    public static IResult Conflict(
        string title,
        string detail,
        string errorSlug,
        IDictionary<string, object?>? extra = null)
    {
        var extensions = new Dictionary<string, object?> { ["error"] = errorSlug };
        if (extra is not null)
        {
            foreach (var kv in extra) extensions[kv.Key] = kv.Value;
        }
        return Results.Problem(
            title: title,
            detail: detail,
            statusCode: StatusCodes.Status409Conflict,
            type: Rfc7231ConflictType,
            extensions: extensions);
    }

    /// <summary>
    /// 404 Not Found — used by Read API for unknown service/environment
    /// slots and missing history. No <c>errors</c> map; <c>title</c> + <c>detail</c>
    /// carry the explanation per RFC 7807 § 3.1.
    /// </summary>
    public static IResult NotFound(string title, string detail) =>
        Results.Problem(
            title: title,
            detail: detail,
            statusCode: StatusCodes.Status404NotFound,
            type: Rfc7231NotFoundType);
}
