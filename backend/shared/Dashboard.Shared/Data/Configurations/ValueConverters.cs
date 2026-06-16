using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Dashboard.Shared.Data.Configurations;

/// <summary>
/// Shared EF Core value converters reused across entity configuration classes.
/// All converters are required only when targeting SQLite (unit tests); Postgres stores
/// native types.
/// </summary>
internal static class ValueConverters
{
    /// <summary>DateTimeOffset (non-nullable) ↔ Unix milliseconds (long).</summary>
    internal static readonly ValueConverter<DateTimeOffset, long> DateTimeOffsetToUnixMs =
        new(v => v.ToUnixTimeMilliseconds(),
            v => DateTimeOffset.FromUnixTimeMilliseconds(v));

    /// <summary>DateTimeOffset? (nullable) ↔ Unix milliseconds (long?).</summary>
    internal static readonly ValueConverter<DateTimeOffset?, long?> NullableDateTimeOffsetToUnixMs =
        new(v => v == null ? (long?)null : v.Value.ToUnixTimeMilliseconds(),
            v => v == null ? (DateTimeOffset?)null : DateTimeOffset.FromUnixTimeMilliseconds(v.Value));

    /// <summary>string[] (nullable) ↔ comma-delimited text (SQLite has no native array type).</summary>
    internal static readonly ValueConverter<string[]?, string?> StringArrayToCsv =
        new(v => v == null ? null : string.Join(',', v),
            v => v == null ? null : v.Split(',', StringSplitOptions.None));
}
