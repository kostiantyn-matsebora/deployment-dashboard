using Dashboard.Api.Endpoints;
using Dashboard.Api.Extensions;
using Dashboard.Api.Version;
using Dashboard.Control;
using Dashboard.Read;
using Dashboard.Write;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddApiJsonOptions();
builder.Services.AddDashboardProblemDetails();

// Surface binding-level body failures (malformed JSON, unknown/missing fields) as a JsonException
// so the problem-details handler maps them to 422 (D5 / §6) in every environment — minimal APIs
// only throw on bad requests in Development by default.
builder.Services.Configure<RouteHandlerOptions>(opts => opts.ThrowOnBadRequest = true);

builder.AddDashboardDatabase();

builder.Services.AddSingleton<IAppVersionProvider, AssemblyAppVersionProvider>();

builder.Services.AddWriteServices();
builder.Services.AddReadServices(builder.Configuration);
builder.Services.AddControlServices();

builder.Services.AddApiCors(builder.Configuration);

builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((doc, _, _) =>
    {
        doc.Info.Title = "Deployment Dashboard API";
        doc.Info.Version = "v1";
        doc.Info.Description = "Write and read deployment events.";
        return Task.CompletedTask;
    });
});

var app = builder.Build();

// ── Pipeline ──────────────────────────────────────────────────────────────────
await app.MigrateDatabaseAsync();

app.UseExceptionHandler();
app.UseApiCorsIfConfigured(builder.Configuration);

app.MapOpenApi();
app.MapScalarApiReference();

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.MapOpsEndpoints();
app.MapWriteEndpoints();
app.MapFetcherStateEndpoints();
app.MapReadEndpoints();
app.MapControlEndpoints();

app.Run();

// Exposes Program to WebApplicationFactory in Dashboard.Api.Tests.
public partial class Program { }
