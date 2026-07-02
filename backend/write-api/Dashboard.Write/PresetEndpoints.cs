using System.Text;
using System.Text.Json;
using Dashboard.Shared.Entities;
using Dashboard.Write.Contracts;
using Dashboard.Write.Filters;
using Dashboard.Write.Repositories;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.Write;

/// <summary>
/// Repo/CI-sourced provided presets (issue #391): sources publish authoritative bundles via
/// <c>PUT /api/presets/sources/{source}</c> (requires <c>X-Api-Key</c>); the SPA reads the
/// merged catalog via <c>GET /api/presets</c> (unauthenticated).
/// </summary>
public static class PresetEndpoints
{
    /// <summary>
    /// The spec-mandated bundle size limit (256 KiB = 262144 bytes). Larger bundles → 413.
    /// </summary>
    private const int MaxBundleBytes = 262_144;

    public static IEndpointRouteBuilder MapPresetEndpoints(this IEndpointRouteBuilder app)
    {
        // Catch-all route: {source} is owner/repo and contains a slash.
        app.MapPut("/api/presets/sources/{**source}", HandlePutAsync)
           .AddEndpointFilter<ApiKeyEndpointFilter>()
           .WithName("putPresetSource")
           .WithTags("presets")
           .WithSummary("Publish the authoritative preset bundle for a source")
           .Produces(StatusCodes.Status204NoContent)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .ProducesProblem(StatusCodes.Status413RequestEntityTooLarge)
           .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        // Unauthenticated — public read, same trust tier as /api/version.
        app.MapGet("/api/presets", HandleGetAsync)
           .WithName("getPresets")
           .WithTags("presets")
           .WithSummary("List all provided presets across every source")
           .Produces<ProvidedPresetsResponse>(StatusCodes.Status200OK);

        return app;
    }

    private static async Task<IResult> HandlePutAsync(
        string source,
        [FromBody] PresetBundle body,
        IProvidedPresetRepository repository,
        CancellationToken ct)
    {
        var sizeError = ValidateBundleSize(body);
        if (sizeError is not null)
            return sizeError;

        var fetchedAt = DateTimeOffset.UtcNow;
        var entities = body.Presets
            .Select(p => new ProvidedPreset
            {
                Source = source,
                Name = p.Name,
                Version = p.Version,
                SettingsJson = p.Settings.GetRawText(),
                FetchedAt = fetchedAt,
            })
            .ToList();

        await repository.ReplaceForSourceAsync(source, entities, ct);
        return Results.NoContent();
    }

    private static async Task<IResult> HandleGetAsync(
        IProvidedPresetRepository repository,
        CancellationToken ct)
    {
        var presets = await repository.GetAllAsync(ct);
        var items = presets.Select(ProvidedPresetResponse.FromEntity).ToList();
        return Results.Ok(new ProvidedPresetsResponse(items));
    }

    /// <summary>
    /// The whole request body is size-capped at 256 KiB; re-serialising the bound bundle gives
    /// a close, deterministic proxy for the wire size (mirrors the componentevent payload check).
    /// </summary>
    private static IResult? ValidateBundleSize(PresetBundle body)
    {
        var json = JsonSerializer.Serialize(body);
        if (Encoding.UTF8.GetByteCount(json) > MaxBundleBytes)
            return Results.Problem(
                title: "Bundle exceeds the size limit.",
                detail: $"The request body must not exceed {MaxBundleBytes} bytes.",
                statusCode: StatusCodes.Status413RequestEntityTooLarge);

        return null;
    }
}
