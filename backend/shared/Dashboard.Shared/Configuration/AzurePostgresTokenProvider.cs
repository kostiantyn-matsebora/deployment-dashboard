using Azure.Core;
using Azure.Identity;

namespace Dashboard.Shared.Configuration;

/// <summary>
/// Acquires a short-lived Postgres access token via <see cref="DefaultAzureCredential"/>.
/// Works with Azure Managed Identity, Workload Identity, and any ambient credential
/// recognised by the Azure Identity chain.
/// </summary>
internal sealed class AzurePostgresTokenProvider : IPostgresTokenProvider
{
    // OSS Azure Database for PostgreSQL token scope (same for Flexible Server / Single Server).
    private static readonly TokenRequestContext TokenRequestContext =
        new(["https://ossrdbms-aad.database.windows.net/.default"]);

    private readonly TokenCredential _credential;

    internal AzurePostgresTokenProvider(TokenCredential? credential = null) =>
        _credential = credential ?? new DefaultAzureCredential();

    /// <inheritdoc />
    public async ValueTask<string> GetTokenAsync(CancellationToken cancellationToken)
    {
        var token = await _credential.GetTokenAsync(TokenRequestContext, cancellationToken);
        return token.Token;
    }
}
