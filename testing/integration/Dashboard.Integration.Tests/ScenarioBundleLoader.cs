using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Reads WireMock mapping JSON files from disk for a named scenario under
/// <c>testing/fixtures/gha/scenarios/{scenarioName}/</c>. Scenario
/// directory layout follows CR-0012 § 3c: per-state-id directories for the
/// six canonical box states + a <c>_cross-cutting/</c> directory for
/// NFR-05 + ADR-0004 + NFR-03 + FR-06 cross-cutting scenarios.
///
/// <para><b>Path resolution.</b> Two strategies, in order:</para>
/// <list type="number">
///   <item>Environment variable <c>DASHBOARD_FIXTURES_BASE</c> — when set,
///   the loader treats it as the absolute path to <c>testing/fixtures</c>.
///   Useful for CI runs where the working directory and the assembly
///   path are unrelated.</item>
///   <item>Relative-to-assembly fallback — walks upward from the test
///   assembly's location until it finds a <c>testing/fixtures</c>
///   directory. This works for the default <c>dotnet test</c> invocation
///   from the repo root.</item>
/// </list>
///
/// <para>All mapping files are read verbatim (no templating, no
/// substitution); per-scenario per-source-id customisation is achieved by
/// authoring distinct mapping files. This matches the qa-engineer
/// authoring conventions in <c>docs/integration-tests.md § 4</c>.</para>
/// </summary>
internal static class ScenarioBundleLoader
{
    private const string FixturesEnvVar = "DASHBOARD_FIXTURES_BASE";
    private const string FixturesRelativePath = "testing/fixtures";
    private const string GhaSubdir = "gha";
    private const string ScenariosSubdir = "scenarios";
    private const string MappingsSubdir = "mappings";

    /// <summary>
    /// Load every <c>*.json</c> file in the scenario directory, sorted
    /// alphabetically by filename (so the priority prefix convention —
    /// <c>NN-…json</c> — drives effective load order). Returns each file
    /// body as a UTF-8 string; the caller composes them into a JSON array
    /// for the bulk-import call.
    /// </summary>
    public static IReadOnlyList<string> LoadScenarioMappings(string scenarioName)
    {
        var dir = ResolveScenarioDirectory(scenarioName);
        if (!Directory.Exists(dir))
        {
            throw new DirectoryNotFoundException(
                $"Scenario '{scenarioName}' not found at '{dir}'. " +
                $"Ensure the scenario directory exists under {FixturesRelativePath}/{GhaSubdir}/{ScenariosSubdir}/.");
        }
        var files = Directory.EnumerateFiles(dir, "*.json", SearchOption.AllDirectories)
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var bodies = new List<string>(files.Count);
        foreach (var f in files)
        {
            bodies.Add(File.ReadAllText(f));
        }
        return bodies;
    }

    /// <summary>
    /// Load every base mapping (one per <c>(method, URL pattern)</c>) from
    /// <c>testing/fixtures/gha/mappings/</c>. Not currently called by the
    /// runner — base mappings are mounted by the mock-gha container at
    /// startup — but exposed for diagnostic tests that need to verify the
    /// base corpus.
    /// </summary>
    public static IReadOnlyList<string> LoadBaseMappings()
    {
        var dir = Path.Combine(ResolveFixturesBase(), GhaSubdir, MappingsSubdir);
        if (!Directory.Exists(dir))
        {
            return Array.Empty<string>();
        }
        return Directory.EnumerateFiles(dir, "*.json", SearchOption.TopDirectoryOnly)
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .Select(File.ReadAllText)
            .ToList();
    }

    /// <summary>
    /// Resolve the absolute path to a scenario's directory — exposed for
    /// diagnostic error messages on <see cref="MockGhaClient.LoadScenarioAsync"/>.
    /// </summary>
    public static string ResolveScenarioDirectory(string scenarioName)
    {
        if (string.IsNullOrWhiteSpace(scenarioName))
        {
            throw new ArgumentException("Scenario name must be non-empty.", nameof(scenarioName));
        }
        return Path.Combine(ResolveFixturesBase(), GhaSubdir, ScenariosSubdir, scenarioName);
    }

    private static string ResolveFixturesBase()
    {
        var fromEnv = Environment.GetEnvironmentVariable(FixturesEnvVar);
        if (!string.IsNullOrWhiteSpace(fromEnv))
        {
            var abs = Path.GetFullPath(fromEnv);
            if (Directory.Exists(abs)) return abs;
            throw new DirectoryNotFoundException(
                $"{FixturesEnvVar} is set to '{fromEnv}' but the directory does not exist.");
        }

        // Walk up from the assembly location looking for testing/fixtures.
        var asmPath = typeof(ScenarioBundleLoader).Assembly.Location;
        var startDir = string.IsNullOrEmpty(asmPath)
            ? Environment.CurrentDirectory
            : (Path.GetDirectoryName(asmPath) ?? Environment.CurrentDirectory);

        var cursor = new DirectoryInfo(startDir);
        while (cursor is not null)
        {
            var candidate = Path.Combine(cursor.FullName, "testing", "fixtures");
            if (Directory.Exists(candidate))
            {
                return Path.GetFullPath(candidate);
            }
            cursor = cursor.Parent;
        }

        throw new DirectoryNotFoundException(
            $"Could not locate '{FixturesRelativePath}/' walking upward from '{startDir}'. " +
            $"Set {FixturesEnvVar} to the absolute path of testing/fixtures/.");
    }
}
