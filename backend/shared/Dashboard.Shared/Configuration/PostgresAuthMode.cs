namespace Dashboard.Shared.Configuration;

/// <summary>
/// Controls how the application authenticates to PostgreSQL.
/// Auto-detected from credential presence — no explicit configuration required.
/// </summary>
public enum PostgresAuthMode
{
    /// <summary>
    /// Static credentials — <c>POSTGRES_USER</c> and <c>POSTGRES_PASSWORD</c> used verbatim.
    /// Active when <c>POSTGRES_PASSWORD</c> (or <c>Postgres:Password</c>) is present and non-empty.
    /// Suitable for local Compose, CI, and tests. Behavior is identical to pre-v2.
    /// </summary>
    Password,

    /// <summary>
    /// No static password. The service authenticates as its ambient cloud managed identity
    /// and obtains a short-lived access token at connection time, refreshed transparently.
    /// Active when <c>POSTGRES_PASSWORD</c> is absent or empty.
    /// </summary>
    ManagedIdentity,
}
