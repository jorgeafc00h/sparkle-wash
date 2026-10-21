using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CarwashApi;

public sealed record N1coWebhookEvent(string Key, string BodyDigest, string OrderId, string? OrderReference, string Type, DateTimeOffset ReceivedAt);

// A verified event is only a signal to reconcile the order with N1CO. It is never a paid receipt.
public sealed class N1coWebhookInbox
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private List<N1coWebhookEvent> _events;

    public N1coWebhookInbox(string path)
    {
        _path = path;
        _events = File.Exists(path)
            ? JsonSerializer.Deserialize<List<N1coWebhookEvent>>(File.ReadAllText(path), JsonOptions) ?? []
            : [];
    }

    public async Task<bool> AddAsync(N1coWebhookEvent value)
    {
        await _gate.WaitAsync();
        try
        {
            if (_events.Any(item => item.Key == value.Key || item.BodyDigest == value.BodyDigest)) return false;
            var next = _events.Append(value).TakeLast(10000).ToList();
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
            var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(next, JsonOptions));
                File.Move(temp, _path, true);
                _events = next;
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
            return true;
        }
        finally { _gate.Release(); }
    }

    public static bool Verify(ReadOnlySpan<byte> body, string? signature, string? secret)
    {
        if (string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(signature)) return false;
        byte[] supplied;
        try { supplied = Convert.FromBase64String(signature); }
        catch (FormatException) { return false; }
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body);
        return supplied.Length == expected.Length && CryptographicOperations.FixedTimeEquals(supplied, expected);
    }

    public static bool TryParse(ReadOnlySpan<byte> body, string? eventId, out N1coWebhookEvent? value)
    {
        value = null;
        try
        {
            using var json = JsonDocument.Parse(body.ToArray());
            var root = json.RootElement;
            var orderId = root.GetProperty("orderId").GetString();
            var type = root.GetProperty("type").GetString();
            if (string.IsNullOrWhiteSpace(orderId) || orderId.Length > 128 ||
                string.IsNullOrWhiteSpace(type) || type.Length > 128) return false;
            var reference = root.TryGetProperty("orderReference", out var property) && property.ValueKind == JsonValueKind.String
                ? property.GetString() : null;
            if (reference?.Length > 255) return false;
            var digest = Convert.ToHexString(SHA256.HashData(body));
            var key = !string.IsNullOrWhiteSpace(eventId) && long.TryParse(eventId, out var id) && id > 0
                ? "event:" + id : "body:" + digest;
            value = new N1coWebhookEvent(key, digest, orderId, reference, type, DateTimeOffset.UtcNow);
            return true;
        }
        catch (JsonException) { return false; }
        catch (KeyNotFoundException) { return false; }
        catch (InvalidOperationException) { return false; }
    }
}
