namespace Dashboard.Api.Version;

/// <summary>
/// Supplies the running assembly's semantic version string.
/// </summary>
internal interface IAppVersionProvider
{
    /// <summary>Gets the application version, e.g. <c>"1.2.3"</c> or <c>"0.0.0-dev"</c>.</summary>
    string Version { get; }
}
