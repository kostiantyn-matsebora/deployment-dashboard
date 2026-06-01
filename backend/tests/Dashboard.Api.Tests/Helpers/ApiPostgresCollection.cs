namespace Dashboard.Api.Tests.Helpers;

/// <summary>
/// xUnit collection fixture that shares one <see cref="PostgresFixture"/> across all
/// <c>Dashboard.Api.Tests</c> test classes. A single Postgres container is started for
/// the assembly; migrations run once; Respawn truncates between classes.
///
/// All test classes decorated with <c>[Collection("api-postgres")]</c> run serially,
/// which is the correct semantics for a shared database.
/// </summary>
[CollectionDefinition("api-postgres")]
public sealed class ApiPostgresCollection : ICollectionFixture<PostgresFixture>
{
    // Marker type only — no members required.
}
