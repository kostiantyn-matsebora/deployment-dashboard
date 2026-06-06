using Dashboard.Api.Extensions;
using Dashboard.Control;
using Dashboard.Read;
using Dashboard.Shared.Configuration;
using Dashboard.Shared.Data;
using Dashboard.Write;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ── JSON ──────────────────────────────────────────────────────────────────────
builder.Services.AddDashboardJsonOptions();

// ── Problem details ───────────────────────────────────────────────────────────
builder.Services.AddDashboardProblemDetails();

// Binding-level body failures (malformed JSON, unknown/missing fields) must surface as a
// JsonException so the problem-details handler maps them to 422 (D5 / §6). Minimal APIs only
// throw on bad requests in Development by default; force it on in every environment so the
// deployed API returns the contract-mandated 422 instead of a silent 400.
builder.Services.Configure<RouteHandlerOptions>(opts => opts.ThrowOnBadRequest = true);

// ── Data ──────────────────────────────────────────────────────────────────────
// Expose ConnectionStrings:Postgres as a synthetic key computed lazily from flat
// POSTGRES_* env vars (highest priority) → appsettings Postgres:* section → built-in
// defaults. Adding this source last gives it the highest priority and ensures
// resolution always reads from the live ConfigurationManager so any providers
// added after initial setup (e.g. test-harness in-memory collections) are visible.
((IConfigurationBuilder)builder.Configuration).Add(new PostgresConnectionStringSource(builder.Configuration));

builder.Services.AddDbContext<DashboardDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

// ── Domain services ───────────────────────────────────────────────────────────
builder.Services.AddWriteServices();
builder.Services.AddReadServices();
builder.Services.AddControlServices();

// ── CORS (D6) ─────────────────────────────────────────────────────────────────
// Enabled only when CORS_ALLOWED_ORIGINS is set; empty/absent = off (gateway / same-origin).
builder.Services.AddDashboardCors(builder.Configuration);

// ── OpenAPI ───────────────────────────────────────────────────────────────────
builder.Services.AddDashboardOpenApi();

var app = builder.Build();

// ── Migrations ────────────────────────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
    await db.Database.MigrateAsync();
}

app.UseExceptionHandler();
app.UseDashboardCors();

// ── OpenAPI / Scalar ──────────────────────────────────────────────────────────
app.MapDashboardOpenApi();

// ── Infrastructure endpoints ──────────────────────────────────────────────────
app.MapLivenessProbe();
app.MapReadinessProbe();

// ── Domain endpoints ──────────────────────────────────────────────────────────
app.MapWriteEndpoints();
app.MapFetcherStateEndpoints();
app.MapReadEndpoints();
app.MapControlEndpoints();

app.Run();

// Exposes Program to WebApplicationFactory in Dashboard.Api.Tests.
public partial class Program { }
