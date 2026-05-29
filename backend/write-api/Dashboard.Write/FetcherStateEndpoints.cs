using Dashboard.Shared.Entities;
using Dashboard.Write.Contracts;
using Dashboard.Write.Filters;
using Dashboard.Write.Repositories;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.Write;

public static class FetcherStateEndpoints
{
    /// <summary>
    /// The spec-mandated cursor size limit (8 KiB = 8192 characters).
    /// Cursors exceeding this are rejected with <c>413</c>.
    /// </summary>
    private const int MaxCursorLength = 8192;

    public static IEndpointRouteBuilder MapFetcherStateEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/fetcher/state/{adapter}", HandleGetAsync)
           .AddEndpointFilter<ApiKeyEndpointFilter>()
           .WithName("GetFetcherState")
           .WithTags("Fetcher")
           .WithSummary("Read the opaque cursor for a fetcher adapter")
           .Produces<FetcherState>(StatusCodes.Status200OK)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapPut("/api/fetcher/state/{adapter}", HandlePutAsync)
           .AddEndpointFilter<ApiKeyEndpointFilter>()
           .WithName("PutFetcherState")
           .WithTags("Fetcher")
           .WithSummary("Upsert the opaque cursor for a fetcher adapter")
           .Produces(StatusCodes.Status204NoContent)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .ProducesProblem(StatusCodes.Status413RequestEntityTooLarge);

        return app;
    }

    private static async Task<IResult> HandleGetAsync(
        string adapter,
        IFetcherStateRepository repository,
        CancellationToken ct)
    {
        var state = await repository.GetByAdapterAsync(adapter, ct);
        return state is null
            ? Results.Problem(
                title: "Fetcher state not found.",
                detail: $"No cursor state has been stored for adapter '{adapter}'.",
                statusCode: StatusCodes.Status404NotFound)
            : Results.Ok(state);
    }

    private static async Task<IResult> HandlePutAsync(
        string adapter,
        [FromBody] FetcherStateUpsert body,
        IFetcherStateRepository repository,
        CancellationToken ct)
    {
        if (body.Cursor.Length > MaxCursorLength)
            return Results.Problem(
                title: "Cursor exceeds the size limit.",
                detail: $"The cursor must not exceed {MaxCursorLength} characters.",
                statusCode: StatusCodes.Status413RequestEntityTooLarge);

        await repository.UpsertAsync(adapter, body.Cursor, ct);
        return Results.NoContent();
    }
}
