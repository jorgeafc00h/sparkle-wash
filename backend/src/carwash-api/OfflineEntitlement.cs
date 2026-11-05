using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CarwashApi;

internal sealed record OfflineEntitlementPayload(
    [property: JsonPropertyName("iss")] string Issuer,
    [property: JsonPropertyName("tenant")] string Tenant,
    [property: JsonPropertyName("sub")] string Subject,
    [property: JsonPropertyName("role")] string Role,
    [property: JsonPropertyName("revision")] string Revision,
    [property: JsonPropertyName("iat")] long IssuedAt,
    [property: JsonPropertyName("exp")] long ExpiresAt);

internal sealed record OfflineEntitlementEnvelope(string Token, string PublicKey, string KeyId,
    string Revision, DateTimeOffset ExpiresAt);

internal sealed class OfflineEntitlementIssuer
{
    internal static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly ECDsa _key;

    private OfflineEntitlementIssuer(ECDsa key, byte[] publicKey)
    {
        _key = key;
        PublicKey = Convert.ToBase64String(publicKey);
        KeyId = Convert.ToHexStringLower(SHA256.HashData(publicKey).AsSpan(0, 8));
    }

    internal string PublicKey { get; }
    internal string KeyId { get; }

    internal static OfflineEntitlementIssuer? FromPem(string? pem)
    {
        if (string.IsNullOrWhiteSpace(pem)) return null;
        var key = ECDsa.Create();
        key.ImportFromPem(pem);
        var parameters = key.ExportParameters(false);
        if (key.KeySize != 256 || parameters.Q.X is null || parameters.Q.Y is null ||
            parameters.Q.X.Length != 32 || parameters.Q.Y.Length != 32)
        {
            key.Dispose();
            throw new CryptographicException("Offline entitlement signing requires an ECDSA P-256 key.");
        }

        var publicKey = new byte[65];
        publicKey[0] = 4;
        parameters.Q.X.CopyTo(publicKey, 1);
        parameters.Q.Y.CopyTo(publicKey, 33);
        return new OfflineEntitlementIssuer(key, publicKey);
    }

    internal static string? NormalizeOrigin(string? input)
    {
        if (!Uri.TryCreate(input, UriKind.Absolute, out var uri) || uri.UserInfo.Length != 0 ||
            uri.Query.Length != 0 || uri.Fragment.Length != 0 || (uri.AbsolutePath.Length > 1) ||
            (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && IsLoopbackName(uri.Host))))
            return null;
        return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
    }

    private static bool IsLoopbackName(string host) => host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
        host.Equals("127.0.0.1", StringComparison.Ordinal) || host.Equals("::1", StringComparison.Ordinal);

    internal OfflineEntitlementEnvelope Issue(string origin, string tenant, string subject, string role,
        string revision, DateTimeOffset now)
    {
        if (revision.Length != 64 || revision.Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new ArgumentException("Archive revision must be a lowercase SHA-256 digest.", nameof(revision));

        var issued = now.ToUnixTimeSeconds();
        var expires = now.Add(Lifetime).ToUnixTimeSeconds();
        var payload = JsonSerializer.SerializeToUtf8Bytes(
            new OfflineEntitlementPayload(origin, tenant, subject, role, revision, issued, expires), JsonOptions);
        var header = JsonSerializer.SerializeToUtf8Bytes(new { alg = "ES256", typ = "JWT", kid = KeyId }, JsonOptions);
        var signingInput = Base64Url(header) + "." + Base64Url(payload);
        var signature = _key.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return new OfflineEntitlementEnvelope(signingInput + "." + Base64Url(signature), PublicKey, KeyId,
            revision, DateTimeOffset.FromUnixTimeSeconds(expires));
    }

    private static string Base64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
