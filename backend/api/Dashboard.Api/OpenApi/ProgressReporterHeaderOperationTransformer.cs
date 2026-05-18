using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Dashboard.Api.OpenApi;

/// <summary>
/// CR-0009 + CR-0008 — OpenAPI operation-level transformer that fixes two
/// gaps in the auto-generated metadata for the universal
/// <c>X-Progress-Reporter</c> request header:
///
/// <list type="bullet">
///   <item>
///     <strong>maxLength.</strong> ASP.NET Core does NOT run DataAnnotations
///     on <c>[FromHeader]</c> string bindings, so a
///     <c>[StringLength(64)]</c> attribute on the parameter would be ignored
///     by the generator. The 64-char cap is enforced at runtime by
///     <c>TryValidateProgressReporterHeader</c> in the Write surface, but
///     the OpenAPI document was missing the <c>maxLength: 64</c> on the
///     parameter schema. SDK / Scalar consumers therefore had no client-side
///     hint of the cap. This transformer injects <c>maxLength: 64</c> on the
///     parameter schema for every operation that exposes the header.
///   </item>
///   <item>
///     <strong>required: true on the fetcher-state endpoints.</strong> CR-0009
///     § 3b makes <c>X-Progress-Reporter</c> required on <c>GET</c>/<c>PUT
///     /api/fetcher/state/{source-id}</c> (the handler enforces this at
///     runtime via <c>TryValidateProgressReporterHeader(required: true,
///     ...)</c>). But the parameter binding is <c>string?</c> so the
///     generator emitted <c>required: false</c>. Keep the binding nullable
///     (validator-authoritative — missing header surfaces as a 422 via the
///     validator instead of a 400 from model-binding rejection) and flip the
///     <c>required</c> flag here for the two state endpoints. On
///     <c>POST /api/deployments</c> the header stays optional (CR-0009 § 3a)
///     — only the maxLength is injected.
///   </item>
/// </list>
///
/// <para>The transformer matches operations by <c>operationId</c> rather
/// than by path so renames at the route level are caught at compile-time
/// when the <c>.WithName(...)</c> string changes. See
/// <see cref="WriteApi.WriteApiEndpoints"/> for the canonical operation IDs.</para>
/// </summary>
internal sealed class ProgressReporterHeaderOperationTransformer : IOpenApiOperationTransformer
{
    /// <summary>Header name; mirrors <c>WriteApiEndpoints.ProgressReporterHeaderName</c>.</summary>
    private const string HeaderName = "X-Progress-Reporter";

    /// <summary>Cap; mirrors <c>WriteApiEndpoints.ProgressReporterMaxLength</c>.</summary>
    private const int HeaderMaxLength = 64;

    /// <summary>
    /// Operation IDs on which the header is REQUIRED (per CR-0009 § 3b).
    /// All other operations that expose the header (currently
    /// <c>IngestDeployment</c>) keep <c>required: false</c> per CR-0009 § 3a.
    /// </summary>
    private static readonly HashSet<string> RequiredOnOperationIds = new(StringComparer.Ordinal)
    {
        "GetFetcherState",
        "PutFetcherState",
    };

    public Task TransformAsync(
        OpenApiOperation operation,
        OpenApiOperationTransformerContext context,
        CancellationToken cancellationToken)
    {
        if (operation.Parameters is null || operation.Parameters.Count == 0)
        {
            return Task.CompletedTask;
        }

        // Microsoft.OpenApi 2.x exposes Parameters as IList<IOpenApiParameter>
        // (read-only interface). The concrete OpenApiParameter / OpenApiSchema
        // classes are what we get back from the generator; cast to mutate.
        for (var i = 0; i < operation.Parameters.Count; i++)
        {
            if (operation.Parameters[i] is not OpenApiParameter parameter) continue;
            if (parameter.In != ParameterLocation.Header) continue;
            if (!string.Equals(parameter.Name, HeaderName, StringComparison.OrdinalIgnoreCase)) continue;

            // (i) Always inject maxLength: 64 — applies to every operation
            // that exposes the header (POST /api/deployments + the two
            // state endpoints). DataAnnotations don't fire on [FromHeader]
            // string bindings, so the schema needs explicit help here.
            if (parameter.Schema is not OpenApiSchema concreteSchema)
            {
                concreteSchema = new OpenApiSchema { Type = JsonSchemaType.String };
                parameter.Schema = concreteSchema;
            }
            concreteSchema.MaxLength = HeaderMaxLength;

            // (ii) Required: only on the two fetcher-state operations
            // (CR-0009 § 3b). Match by operationId so the routing change
            // surfaces here if the WithName() literal moves.
            if (!string.IsNullOrEmpty(operation.OperationId) &&
                RequiredOnOperationIds.Contains(operation.OperationId))
            {
                parameter.Required = true;
            }
        }

        return Task.CompletedTask;
    }
}
