using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dashboard.Shared.Topology;

/// <summary>
/// Server-side state for the topology correlation configuration
/// (SAD §7 "Configuration — Read API topology"). Reads bootstrap from
/// <c>appsettings.json</c> via <see cref="TopologyOptions"/> on first run;
/// subsequent reads come from the <c>topology_config</c> table.
///
/// <para>Mutations land via <c>PATCH /api/config/topology</c>, which is
/// reserved for admin / CI / ops tooling (SAD §7: "<strong>admin / CI / ops
/// tooling only — not invoked by the SPA</strong>"). The SPA expresses
/// per-user picker preferences via the <c>correlationAttribute</c> query
/// parameter on read endpoints (see SAD §7 "GET /api/deployments — query
/// parameters").</para>
/// </summary>
public sealed class TopologyConfigStore
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly TopologyOptions _bootstrap;
    private readonly ILogger<TopologyConfigStore> _logger;

    public TopologyConfigStore(
        IServiceScopeFactory scopeFactory,
        TopologyOptions bootstrap,
        ILogger<TopologyConfigStore> logger)
    {
        _scopeFactory = scopeFactory;
        _bootstrap = bootstrap;
        _logger = logger;
    }

    /// <summary>
    /// Active config. Bootstraps the single-row table on first call.
    /// </summary>
    public async Task<TopologyConfigDto> GetAsync(CancellationToken ct = default)
    {
        var row = await LoadOrBootstrapAsync(ct);
        return ToDto(row);
    }

    /// <summary>
    /// Apply a PATCH body. Returns the active config after the update.
    /// </summary>
    public async Task<TopologyConfigDto> PatchAsync(
        TopologyConfigPatch patch,
        CancellationToken ct = default)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();

        var row = await LoadOrBootstrapAsync(db, ct);

        if (patch.CorrelationAttribute is not null)
        {
            if (!CorrelationAttribute.IsAllowed(patch.CorrelationAttribute))
            {
                throw new InvalidTopologyAttributeException(patch.CorrelationAttribute);
            }
            row.CorrelationAttribute = patch.CorrelationAttribute;
        }

        if (patch.PerServiceOverrides is not null)
        {
            var current = DeserialiseOverrides(row.PerServiceOverridesJson);
            foreach (var (service, value) in patch.PerServiceOverrides)
            {
                if (string.IsNullOrWhiteSpace(service))
                {
                    throw new InvalidTopologyAttributeException(service);
                }
                if (value is null)
                {
                    // SAD PATCH semantics: null removes the override.
                    current.Remove(service);
                    continue;
                }
                if (!CorrelationAttribute.IsAllowed(value))
                {
                    throw new InvalidTopologyAttributeException(value);
                }
                current[service] = value;
            }
            row.PerServiceOverridesJson = JsonSerializer.Serialize(current);
        }

        await db.SaveChangesAsync(ct);

        return ToDto(row);
    }

    /// <summary>
    /// Resolve the effective correlation attribute for a service using the
    /// SAD §7 precedence order:
    /// <c>PerServiceOverrides[service] &gt; requestOverride &gt; server default</c>.
    ///
    /// <para><paramref name="requestOverride"/> is the per-request
    /// <c>correlationAttribute</c> query parameter (SAD §7 "GET
    /// /api/deployments — query parameters"). Caller is responsible for
    /// validating that <paramref name="requestOverride"/> is in the allowed
    /// set (the matrix endpoint returns <c>400 Bad Request</c> on invalid
    /// input before reaching this method).</para>
    /// </summary>
    public async Task<string> ResolveAttributeForServiceAsync(
        string service,
        string? requestOverride = null,
        CancellationToken ct = default)
    {
        var dto = await GetAsync(ct);

        // 1. Per-service override always wins (ops-managed contract).
        if (dto.PerServiceOverrides.TryGetValue(service, out var perService) &&
            CorrelationAttribute.IsAllowed(perService))
        {
            return perService;
        }

        // 2. Per-request override (query parameter) — the picker preference.
        if (CorrelationAttribute.IsAllowed(requestOverride))
        {
            return requestOverride!;
        }

        // 3. Server-side default.
        return CorrelationAttribute.IsAllowed(dto.CorrelationAttribute)
            ? dto.CorrelationAttribute
            : CorrelationAttribute.Version;
    }

    private async Task<TopologyConfigRow> LoadOrBootstrapAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        return await LoadOrBootstrapAsync(db, ct);
    }

    private async Task<TopologyConfigRow> LoadOrBootstrapAsync(DashboardDbContext db, CancellationToken ct)
    {
        var row = await db.TopologyConfigs
            .FirstOrDefaultAsync(r => r.Id == TopologyConfigRow.SingletonId, ct);

        if (row is null)
        {
            row = new TopologyConfigRow
            {
                Id = TopologyConfigRow.SingletonId,
                CorrelationAttribute = CorrelationAttribute.IsAllowed(_bootstrap.CorrelationAttribute)
                    ? _bootstrap.CorrelationAttribute
                    : CorrelationAttribute.Version,
                PerServiceOverridesJson = JsonSerializer.Serialize(_bootstrap.PerServiceOverrides),
            };
            db.TopologyConfigs.Add(row);
            await db.SaveChangesAsync(ct);
            _logger.LogInformation(
                "Bootstrapped topology config from appsettings: attribute='{Attribute}', overrides={OverrideCount}.",
                row.CorrelationAttribute, _bootstrap.PerServiceOverrides.Count);
        }

        return row;
    }

    private TopologyConfigDto ToDto(TopologyConfigRow row) => new()
    {
        CorrelationAttribute = row.CorrelationAttribute,
        PerServiceOverrides = DeserialiseOverrides(row.PerServiceOverridesJson),
    };

    private static Dictionary<string, string> DeserialiseOverrides(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new(StringComparer.Ordinal);
        try
        {
            var dict = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
            return dict is null
                ? new Dictionary<string, string>(StringComparer.Ordinal)
                : new Dictionary<string, string>(dict, StringComparer.Ordinal);
        }
        catch
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }
    }
}

/// <summary>
/// Bootstrap configuration read from <c>appsettings.json</c> under the
/// <c>Topology</c> section (SAD §7 "Configuration — Read API topology").
///
/// <para>Per the Phase-1 SAD revision, only <c>CorrelationAttribute</c> and
/// <c>PerServiceOverrides</c> remain. The previous <c>AllowUserOverride</c>
/// SPA-disable toggle was removed because the SPA cannot write to the API
/// at all — it carries no API key.</para>
/// </summary>
public sealed class TopologyOptions
{
    public const string SectionName = "Topology";

    public string CorrelationAttribute { get; init; } = "version";
    public Dictionary<string, string> PerServiceOverrides { get; init; } = new(StringComparer.Ordinal);
}

/// <summary>
/// PATCH supplied a correlation attribute not in the SAD-allowed set.
/// Endpoint maps this to HTTP 400.
/// </summary>
public sealed class InvalidTopologyAttributeException : Exception
{
    public string Attribute { get; }

    public InvalidTopologyAttributeException(string? attribute)
        : base($"Correlation attribute '{attribute ?? "(null)"}' is not allowed. " +
               $"Allowed: {string.Join(", ", CorrelationAttribute.Allowed)}.")
    {
        Attribute = attribute ?? string.Empty;
    }
}
