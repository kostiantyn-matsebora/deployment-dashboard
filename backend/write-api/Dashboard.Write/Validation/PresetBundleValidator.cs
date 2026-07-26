using Dashboard.Write.Contracts;

namespace Dashboard.Write.Validation;

/// <summary>
/// Business-rule validation for a <see cref="PresetBundle"/> that DataAnnotations on
/// <see cref="Preset"/> cannot express (or, for <c>Name</c>'s length bounds, never actually
/// run — minimal-API model binding does not evaluate them). Runs before
/// <c>PresetEndpoints.HandlePutAsync</c> persists the bundle (issue #391 review).
/// </summary>
internal sealed class PresetBundleValidator : IPresetBundleValidator
{
    /// <summary>Contract bound (OpenAPI <c>Preset.name</c>: minLength 1, maxLength 200).</summary>
    private const int MaxNameLength = 200;

    public IReadOnlyList<ValidationFailure> Validate(PresetBundle bundle)
    {
        var failures = new List<ValidationFailure>();
        CollectNameLengthFailures(bundle, failures);
        CollectDuplicateNameFailures(bundle, failures);
        return failures;
    }

    private static void CollectNameLengthFailures(PresetBundle bundle, List<ValidationFailure> failures)
    {
        for (var i = 0; i < bundle.Presets.Count; i++)
        {
            var name = bundle.Presets[i].Name;
            if (string.IsNullOrWhiteSpace(name) || name.Length > MaxNameLength)
                failures.Add(new ValidationFailure(
                    $"/presets/{i}/name",
                    $"Must be between 1 and {MaxNameLength} characters."));
        }
    }

    // Composite key is (source, name) — a duplicate name within one bundle is a bundle-shaped
    // error (not attributable to a single item), so it gets one failure at "/presets" rather
    // than per-index, mirroring IngestValidator's "/parent_deployments" uniqueness check.
    private static void CollectDuplicateNameFailures(PresetBundle bundle, List<ValidationFailure> failures)
    {
        var duplicates = bundle.Presets
            .Select(p => p.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .GroupBy(name => name, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();

        if (duplicates.Count > 0)
            failures.Add(new ValidationFailure(
                "/presets",
                $"Preset names must be unique within a bundle. Duplicates: {string.Join(", ", duplicates)}."));
    }
}
