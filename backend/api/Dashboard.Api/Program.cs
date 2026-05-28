using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Shared.Data;
using Dashboard.Write;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ── JSON ──────────────────────────────────────────────────────────────────────
// Global snake_case policy covers response DTOs (DeploymentEvent entity fields).
// Ingest DTO uses [JsonPropertyName] which takes precedence.
builder.Services.ConfigureHttpJsonOptions(opts =>
{
    opts.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// ── Problem details ───────────────────────────────────────────────────────────
// Converts unhandled exceptions (including JsonException from unknown fields or
// bad field types) to RFC 9457 application/problem+json responses.
// NOTE: UseExceptionHandler() does NOT populate ctx.Exception — the exception
// is only available via IExceptionHandlerFeature set on HttpContext.Features.
builder.Services.AddProblemDetails(opts =>
{
    opts.CustomizeProblemDetails = ctx =>
    {
        var exception = ctx.HttpContext.Features
            .Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;

        var jsonEx = exception as System.Text.Json.JsonException
            ?? exception?.InnerException as System.Text.Json.JsonException;

        if (jsonEx is null) return;

        ctx.ProblemDetails.Status = StatusCodes.Status422UnprocessableEntity;
        ctx.ProblemDetails.Title = "Unprocessable payload.";
        ctx.ProblemDetails.Detail = "The request body is malformed or contains unknown fields.";
        ctx.HttpContext.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;

        var pointer = jsonEx.Path is { } p
            ? $"/{p.Replace(".", "/").TrimStart('$', '.')}"
            : "/";
        ctx.ProblemDetails.Extensions["errors"] = new[] { new { pointer, message = jsonEx.Message } };
    };
});

// ── Data ──────────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<DashboardDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

// ── Write services ────────────────────────────────────────────────────────────
builder.Services.AddWriteServices();

// ── Read services ─────────────────────────────────────────────────────────────
// Phase 4: builder.Services.AddReadServices();

var app = builder.Build();

app.UseExceptionHandler();

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.MapWriteEndpoints();

// Phase 4: app.MapReadEndpoints();
// Phase 5: SSE stream
// Phase 6: Fetcher state + ops

app.Run();

// Exposes Program to WebApplicationFactory in Dashboard.Api.Tests.
public partial class Program { }
