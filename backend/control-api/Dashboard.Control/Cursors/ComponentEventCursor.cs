using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;

namespace Dashboard.Control.Cursors;

/// <summary>
/// Opaque pagination cursor for the component-event listing.
/// Encodes the position of the last item in the <c>received_at DESC, id DESC</c> ordering.
/// Format (stable, opaque): base64url of <c>{"r":"&lt;iso8601&gt;","i":"&lt;uuid&gt;"}</c>.
/// Mirrors <c>Dashboard.Read.Cursors.CursorCodec</c>.
/// </summary>
internal static class ComponentEventCursor
{
    internal sealed record DecodedCursor(DateTimeOffset ReceivedAt, Guid Id);

    internal static string Encode(DateTimeOffset receivedAt, Guid id)
    {
        var json = $"{{\"r\":\"{receivedAt:O}\",\"i\":\"{id}\"}}";
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

            if (!root.TryGetProperty("r", out var rProp) ||
                !root.TryGetProperty("i", out var iProp))
                return false;

            if (!DateTimeOffset.TryParse(rProp.GetString(), out var receivedAt))
                return false;

            if (!Guid.TryParse(iProp.GetString(), out var id))
                return false;

            result = new DecodedCursor(receivedAt, id);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
