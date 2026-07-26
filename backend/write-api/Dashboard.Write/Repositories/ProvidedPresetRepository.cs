using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Write.Repositories;

internal sealed class ProvidedPresetRepository(DashboardDbContext db) : IProvidedPresetRepository
{
    public async Task ReplaceForSourceAsync(string source, IReadOnlyList<ProvidedPreset> presets, CancellationToken ct)
    {
        var existing = await db.ProvidedPresets
            .Where(p => p.Source == source)
            .ToListAsync(ct);

        db.ProvidedPresets.RemoveRange(existing);

        if (presets.Count > 0)
            db.ProvidedPresets.AddRange(presets);

        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<ProvidedPreset>> GetAllAsync(CancellationToken ct)
        => await db.ProvidedPresets
            .OrderBy(p => p.Source)
            .ThenBy(p => p.Name)
            .ToListAsync(ct);
}
