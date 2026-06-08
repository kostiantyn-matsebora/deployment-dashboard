namespace Dashboard.Shared.Configuration;

/// <summary>
/// Supplies a short-lived bearer token suitable for use as a Postgres password
/// when authenticating via a cloud managed identity.
/// </summary>
/// <remarks>
/// Isolates the Azure <c>DefaultAzureCredential</c> implementation behind this interface
/// so the token-acquisition strategy is swappable without touching the Npgsql wiring.
/// </remarks>
public interface IPostgresTokenProvider
{
    /// <summary>
    /// Returns a fresh access token for the Postgres service.
    /// Implementations are expected to handle caching internally;
    /// Npgsql calls this on a periodic schedule and on reconnect.
    /// </summary>
    ValueTask<string> GetTokenAsync(CancellationToken cancellationToken);
}
