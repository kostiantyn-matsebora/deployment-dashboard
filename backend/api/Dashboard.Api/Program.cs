using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ── Data ──────────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<DashboardDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

// ── Endpoints (wired per phase) ───────────────────────────────────────────────
// Phase 3: app.MapWriteEndpoints();
// Phase 4: app.MapReadEndpoints();
// Phase 5: SSE stream
// Phase 6: Fetcher state + ops

var app = builder.Build();

app.Run();

// Exposes Program to WebApplicationFactory in Dashboard.Api.Tests.
public partial class Program { }
