using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Google.Apis.Auth;

namespace CarwashApi;

public sealed record GoogleLoginInput(string? IdToken);
public sealed record StaffSession(string Subject, string Role, DateTimeOffset ExpiresAt);

public interface IGoogleIdentityVerifier
{
    Task<string?> VerifySubjectAsync(string idToken, string clientId);
}

public sealed class GoogleIdentityVerifier : IGoogleIdentityVerifier
{
    public async Task<string?> VerifySubjectAsync(string idToken, string clientId)
    {
        var payload = await GoogleJsonWebSignature.ValidateAsync(idToken,
            new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] });
        return payload.Subject;
    }
}

public sealed class StaffAuth
{
    private readonly string? _clientId;
    private readonly Dictionary<string, string> _roles;
    private readonly IGoogleIdentityVerifier _verifier;
    private readonly ConcurrentDictionary<string, StaffSession> _sessions = new();

    public StaffAuth(IConfiguration configuration, IGoogleIdentityVerifier? verifier = null)
    {
        _clientId = configuration["SPARKLEWASH_GOOGLE_CLIENT_ID"];
        _roles = ParseRoles(configuration["SPARKLEWASH_STAFF_ROLES"]);
        _verifier = verifier ?? new GoogleIdentityVerifier();
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_clientId);

    public async Task<(string Token, StaffSession Session)?> LoginAsync(string? idToken)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(idToken) || idToken.Length > 8192) return null;
        string? subject;
        try
        {
            subject = await _verifier.VerifySubjectAsync(idToken, _clientId!);
        }
        catch (Exception exception) when (exception is InvalidJwtException or ArgumentException or HttpRequestException)
        {
            return null;
        }
        if (string.IsNullOrWhiteSpace(subject) || !_roles.TryGetValue(subject, out var role)) return null;
        foreach (var pair in _sessions.Where(pair => pair.Value.ExpiresAt <= DateTimeOffset.UtcNow))
            _sessions.TryRemove(pair.Key, out _);
        if (_sessions.Count >= 1000) return null;
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var session = new StaffSession(subject, role, DateTimeOffset.UtcNow.AddHours(8));
        _sessions[Digest(token)] = session;
        return (token, session);
    }

    public StaffSession? Authenticate(string? authorization)
    {
        if (authorization is null || !authorization.StartsWith("Bearer ", StringComparison.Ordinal) || authorization.Length > 256) return null;
        var token = authorization[7..];
        if (!_sessions.TryGetValue(Digest(token), out var session)) return null;
        if (session.ExpiresAt > DateTimeOffset.UtcNow) return session;
        _sessions.TryRemove(Digest(token), out _);
        return null;
    }

    public bool SignOut(string? authorization)
    {
        if (authorization is null || !authorization.StartsWith("Bearer ", StringComparison.Ordinal) || authorization.Length > 256) return false;
        return _sessions.TryRemove(Digest(authorization[7..]), out _);
    }

    internal static Dictionary<string, string> ParseRoles(string? raw)
    {
        var roles = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var item in (raw ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = item.Split('=', 2, StringSplitOptions.TrimEntries);
            if (parts.Length == 2 && parts[0].Length is >= 1 and <= 128 && parts[0].All(char.IsAsciiDigit) &&
                parts[1] is ("viewer" or "operator" or "admin")) roles[parts[0]] = parts[1];
        }
        return roles;
    }

    private static string Digest(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
