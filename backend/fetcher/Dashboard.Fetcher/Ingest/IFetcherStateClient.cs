namespace Dashboard.Fetcher.Ingest;

public interface IFetcherStateClient
{
    /// <summary>Returns the cursor, or null on 404 (no state yet).</summary>
    Task<string?> GetAsync(string adapterId, CancellationToken ct);

    Task PutAsync(string adapterId, string cursor, CancellationToken ct);
}
