using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.Configuration;
using Microsoft.OpenApi;

namespace Dashboard.Api.OpenApi;

/// <summary>
/// CR-0008 OpenAPI semantic enrichment — document-level transformer.
///
/// <para>Sets the OpenAPI <c>info</c> block (title / description / version)
/// and the <c>servers</c> list. The servers entry is read from
/// <see cref="IConfiguration"/> (<c>OpenApi:Servers</c>) per the
/// declarative-configuration rule (<c>CLAUDE.md</c> &gt; Configuration vs.
/// data): a localhost default in <c>appsettings.json</c> gets overridden by
/// <c>appsettings.Production.json</c> / env vars in real deployments.</para>
///
/// <para>Targets Microsoft.OpenApi 2.x (OpenAPI 3.1) — types live directly
/// under <c>Microsoft.OpenApi</c> (no <c>.Models</c> sub-namespace).</para>
/// </summary>
internal sealed class DashboardInfoDocumentTransformer(IConfiguration configuration)
    : IOpenApiDocumentTransformer
{
    /// <summary>API title surfaced on the Scalar UI header.</summary>
    private const string ApiTitle = "Deployment Dashboard API";

    /// <summary>
    /// API version surfaced on the OpenAPI document. The host mounts a single
    /// document keyed "v1" (CR-0008 Decision 3); this string is the
    /// human-readable form shown in the Scalar UI.
    /// </summary>
    private const string ApiVersion = "1.0";

    public Task TransformAsync(
        OpenApiDocument document,
        OpenApiDocumentTransformerContext context,
        CancellationToken cancellationToken)
    {
        document.Info ??= new OpenApiInfo();
        document.Info.Title = ApiTitle;
        document.Info.Version = ApiVersion;
        document.Info.Description =
            "Push-based deployment matrix for an internal-only, single-org pipeline view.\n\n" +
            "* **Write surface** — `POST /api/deployments`, `PATCH /api/config/topology`. " +
            "Both protected by the `X-Api-Key` header (SAD §8).\n" +
            "* **Read surface** — matrix / single-slot / history / discovery / SSE / health / " +
            "`GET /api/config/topology`. Unauthenticated (FR-10, SAD §8).\n\n" +
            "Real-time updates flow over `GET /api/stream` as Server-Sent Events; payload shape " +
            "matches `SlotUpdatePayload`. Schema documentation is generated from the C# DTOs " +
            "annotated with `<summary>` XML comments.";

        // Declarative-config: server list comes from IConfiguration, never
        // hardcoded URLs in source. Falls back to the dev gateway URL only
        // when the configuration is silent.
        var servers = configuration.GetSection("OpenApi:Servers").Get<List<OpenApiServerOption>>() ?? [];
        if (servers.Count == 0)
        {
            servers.Add(new OpenApiServerOption
            {
                Url = "http://localhost:8080",
                Description = "Local Compose stack (dev_env/start.ps1)",
            });
        }

        document.Servers = servers
            .Where(s => !string.IsNullOrWhiteSpace(s.Url))
            .Select(s => new OpenApiServer
            {
                Url = s.Url,
                Description = s.Description,
            })
            .ToList();

        return Task.CompletedTask;
    }

    /// <summary>
    /// Binding shape for the <c>OpenApi:Servers</c> configuration section.
    /// Public so <see cref="IConfiguration.Get{T}"/> can populate it.
    /// </summary>
    public sealed class OpenApiServerOption
    {
        public string Url { get; set; } = string.Empty;
        public string? Description { get; set; }
    }
}

/// <summary>
/// CR-0008 OpenAPI semantic enrichment — security scheme transformer.
///
/// <para>Declares the <c>X-Api-Key</c> API-key security scheme and attaches
/// it as a requirement to every operation tagged <c>"Write"</c> (i.e. the
/// two endpoints that live behind <c>RequireApiKey()</c> in
/// <see cref="Program"/>). Read-tagged operations are left without a
/// requirement — matches SAD §8 verbatim.</para>
/// </summary>
internal sealed class WriteSurfaceSecurityDocumentTransformer : IOpenApiDocumentTransformer
{
    /// <summary>Security-scheme key referenced from operation requirements.</summary>
    public const string SchemeName = "ApiKey";

    /// <summary>HTTP header the Write middleware reads (SAD §8).</summary>
    public const string HeaderName = "X-Api-Key";

    /// <summary>Tag string applied to Write endpoints via <c>.WithTags("Write")</c>.</summary>
    public const string WriteTag = "Write";

    public Task TransformAsync(
        OpenApiDocument document,
        OpenApiDocumentTransformerContext context,
        CancellationToken cancellationToken)
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
        document.Components.SecuritySchemes[SchemeName] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.ApiKey,
            In = ParameterLocation.Header,
            Name = HeaderName,
            Description =
                $"Static API key for the Write surface. Sent in the {HeaderName} header. " +
                "Required for POST /api/deployments and PATCH /api/config/topology only " +
                "(SAD §8).",
        };

        if (document.Paths is null) return Task.CompletedTask;

        // In Microsoft.OpenApi 2.x, an OpenApiSecurityRequirement is a
        // dictionary keyed by OpenApiSecuritySchemeReference. The reference
        // points back at the components.securitySchemes entry by name.
        foreach (var path in document.Paths.Values)
        {
            if (path.Operations is null) continue;
            foreach (var operation in path.Operations.Values)
            {
                if (operation.Tags is null || operation.Tags.Count == 0) continue;
                if (!operation.Tags.Any(t => string.Equals(t.Name, WriteTag, StringComparison.Ordinal)))
                {
                    continue;
                }

                var requirement = new OpenApiSecurityRequirement
                {
                    [new OpenApiSecuritySchemeReference(SchemeName, document)] = new List<string>(),
                };

                operation.Security ??= new List<OpenApiSecurityRequirement>();
                operation.Security.Add(requirement);
            }
        }

        return Task.CompletedTask;
    }
}
