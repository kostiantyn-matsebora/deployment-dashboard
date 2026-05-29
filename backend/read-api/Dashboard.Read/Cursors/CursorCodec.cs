using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;

namespace Dashboard.Read.Cursors;

/// <summary>
/// Encodes and decodes opaque pagination cursors for the deployment event listing.
/// A cursor represents the position of the last item returned on a page in the
/// <c>happened_at DESC, id DESC</c> ordering.
///
/// Format (stable, opaque to callers): base64url of <c>{"h":"&lt;iso8601&gt;","i":"&lt;uuid&gt;"}</c>.
/// </summary>
internal static class CursorCodec
{
    internal sealed record DecodedCursor(DateTimeOffset HappenedAt, Guid Id);

    internal static string Encode(DateTimeOffset happenedAt, Guid id)
    {
        var json = $"{{\"h\":\"{happenedAt:O}\",\"i\":\"{id}\"}}";
        var bytes = Encoding.UTF8.GetBytes(json);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    internal static bool TryDecode(string cursor, [NotNullWhen(true)] out DecodedCursor? result)
    {
        result = null;
        try
        {
            var padded = cursor.Replace('-', '+').Replace('_', '/');
            padded += (padded.Length % 4) switch { 2 => "==", 3 => "=", _ => "" };
            var bytes = Convert.FromBase64String(padded);
            var json = Encoding.UTF8.GetString(bytes);

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!root.TryGetProperty("h", out var hProp) ||
                !root.TryGetProperty("i", out var iProp))
                return false;

            if (!DateTimeOffset.TryParse(hProp.GetString(), out var happenedAt))
                return false;

            if (!Guid.TryParse(iProp.GetString(), out var id))
                return false;

            result = new DecodedCursor(happenedAt, id);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
