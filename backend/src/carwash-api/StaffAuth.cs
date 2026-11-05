using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Google.Apis.Auth;
using Npgsql;
using NpgsqlTypes;

namespace CarwashApi;

public sealed record GoogleLoginInput(string? IdToken);
public sealed record GoogleIdentity(string Subject, string? Email, bool EmailVerified, string? Name);
public sealed record StaffSession(string Subject, string Role, DateTimeOffset ExpiresAt,
    string TenantId = TenantDirectory.DefaultTenantId, string? Email = null, string? Name = null);
public enum RegistrationStatus { Created, AlreadyMember, Invalid, Closed, Limit }

public interface IGoogleIdentityVerifier
{
    Task<string?> VerifySubjectAsync(string idToken, string clientId);

    /// <summary>Subject plus email claims. Verifiers that only know the subject get no email, which means
    /// invitations (matched by verified email) can't be accepted through them.</summary>
    async Task<GoogleIdentity?> VerifyAsync(string idToken, string clientId) =>
        await VerifySubjectAsync(idToken, clientId) is { } subject ? new GoogleIdentity(subject, null, false, null) : null;
}

public sealed class GoogleIdentityVerifier : IGoogleIdentityVerifier
{
    public async Task<string?> VerifySubjectAsync(string idToken, string clientId) => (await VerifyAsync(idToken, clientId))?.Subject;

    public async Task<GoogleIdentity?> VerifyAsync(string idToken, string clientId)
    {
        var payload = await GoogleJsonWebSignature.ValidateAsync(idToken,
            new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] });
        return new GoogleIdentity(payload.Subject, payload.Email, payload.EmailVerified, payload.Name);
    }
}

public sealed class StaffAuth
{
    // Comma-separated: the web console, the iOS app and any other client each have their own OAuth client ID.
    private readonly string[] _clientIds;
    private readonly Dictionary<string, string> _roles;
    private readonly IGoogleIdentityVerifier _verifier;
    private readonly TenantDirectory _directory;
    private readonly bool _registrationOpen;
    private readonly NpgsqlDataSource? _sessionDatabase;
    private readonly ConcurrentDictionary<string, StaffSession> _sessions = new();

    public StaffAuth(IConfiguration configuration, TenantDirectory directory, IGoogleIdentityVerifier? verifier = null, NpgsqlDataSource? sessionDatabase = null)
    {
        _clientIds = (configuration["SPARKLEWASH_GOOGLE_CLIENT_ID"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        _roles = ParseRoles(configuration["SPARKLEWASH_STAFF_ROLES"]);
        _registrationOpen = (sessionDatabase is null || directory is PostgresTenantDirectory) && !string.Equals(configuration["SPARKLEWASH_REGISTRATION_OPEN"], "false", StringComparison.OrdinalIgnoreCase);
        _verifier = verifier ?? new GoogleIdentityVerifier();
        _directory = directory;
        _sessionDatabase = sessionDatabase;
    }

    public bool IsConfigured => _clientIds.Length > 0;
    public bool RegistrationOpen => IsConfigured && _registrationOpen;

    /// <summary>Server-configured staff (SPARKLEWASH_STAFF_ROLES) of the default carwash, shown read-only in the admin view.</summary>
    public IReadOnlyDictionary<string, string> ConfiguredRoles => _roles;

    public async Task<(string Token, StaffSession Session)?> LoginAsync(string? idToken)
    {
        var identity = await VerifyAsync(idToken);
        if (identity is null) return null;
        // Configured roles keep working exactly as before registration existed.
        if (_roles.TryGetValue(identity.Subject, out var configuredRole))
            return await IssueAsync(identity, TenantDirectory.DefaultTenantId, configuredRole);
        var membership = await _directory.MembershipForAsync(identity.Subject) ?? await _directory.AcceptInvitationAsync(identity);
        return membership is null ? null : await IssueAsync(identity, membership.TenantId, membership.Role);
    }

    public async Task<(RegistrationStatus Status, Tenant? Tenant, string? Token, StaffSession? Session)> RegisterAsync(string? idToken, TenantInput input)
    {
        if (!RegistrationOpen) return (RegistrationStatus.Closed, null, null, null);
        var normalized = TenantDirectory.Normalize(input);
        if (normalized is null) return (RegistrationStatus.Invalid, null, null, null);
        var identity = await VerifyAsync(idToken);
        if (identity is null) return (RegistrationStatus.Invalid, null, null, null);
        if (_roles.ContainsKey(identity.Subject) || await _directory.MembershipForAsync(identity.Subject) is not null)
            return (RegistrationStatus.AlreadyMember, null, null, null);
        var tenant = await _directory.RegisterAsync(identity, normalized);
        if (tenant is null) return (RegistrationStatus.Limit, null, null, null);
        var login = await IssueAsync(identity, tenant.Id, "admin");
        return login is null ? (RegistrationStatus.Limit, tenant, null, null) : (RegistrationStatus.Created, tenant, login.Value.Token, login.Value.Session);
    }

    public async Task<StaffSession?> AuthenticateAsync(string? authorization)
    {
        if (authorization is null || !authorization.StartsWith("Bearer ", StringComparison.Ordinal) || authorization.Length > 256) return null;
        var token = authorization[7..];
        if (_sessionDatabase is not null)
        {
            var persisted = await ReadSessionAsync(Digest(token));
            if (persisted is null) return null;
            if (_roles.TryGetValue(persisted.Subject, out var configuredRole))
                return persisted.TenantId == TenantDirectory.DefaultTenantId && persisted.Role == configuredRole ? persisted : null;
            var membership = await _directory.MembershipForAsync(persisted.Subject);
            return membership?.TenantId == persisted.TenantId && membership.Role == persisted.Role ? persisted : null;
        }
        if (!_sessions.TryGetValue(Digest(token), out var session)) return null;
        if (session.ExpiresAt > DateTimeOffset.UtcNow) return session;
        _sessions.TryRemove(Digest(token), out _);
        return null;
    }

    public async Task<bool> SignOutAsync(string? authorization)
    {
        if (authorization is null || !authorization.StartsWith("Bearer ", StringComparison.Ordinal) || authorization.Length > 256) return false;
        var digest = Digest(authorization[7..]);
        if (_sessionDatabase is null) return _sessions.TryRemove(digest, out _);
        await using var command = _sessionDatabase.CreateCommand("DELETE FROM sparklewash.staff_sessions WHERE token_digest = $1");
        command.Parameters.AddWithValue(digest);
        return await command.ExecuteNonQueryAsync() == 1;
    }

    /// <summary>Ends every session of a person, e.g. after their role changes or they are removed.</summary>
    public async Task RevokeAsync(string tenantId, string subject)
    {
        if (_sessionDatabase is not null)
        {
            await using var command = _sessionDatabase.CreateCommand(
                "DELETE FROM sparklewash.staff_sessions WHERE tenant_id = $1 AND subject = $2");
            command.Parameters.AddWithValue(tenantId);
            command.Parameters.AddWithValue(subject);
            await command.ExecuteNonQueryAsync();
            return;
        }
        foreach (var pair in _sessions.Where(pair => pair.Value.TenantId == tenantId && pair.Value.Subject == subject))
            _sessions.TryRemove(pair.Key, out _);
    }

    private async Task<GoogleIdentity?> VerifyAsync(string? idToken)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(idToken) || idToken.Length > 8192) return null;
        // A token is valid when its audience is any one of our clients.
        foreach (var clientId in _clientIds)
        {
            try
            {
                var identity = await _verifier.VerifyAsync(idToken, clientId);
                if (!string.IsNullOrWhiteSpace(identity?.Subject)) return identity;
            }
            catch (Exception exception) when (exception is InvalidJwtException or ArgumentException or HttpRequestException)
            {
            }
        }
        return null;
    }

    private async Task<(string Token, StaffSession Session)?> IssueAsync(GoogleIdentity identity, string tenantId, string role)
    {
        foreach (var pair in _sessions.Where(pair => pair.Value.ExpiresAt <= DateTimeOffset.UtcNow))
            _sessions.TryRemove(pair.Key, out _);
        if (_sessions.Count >= 10000) return null;
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var session = new StaffSession(identity.Subject, role, DateTimeOffset.UtcNow.AddHours(8), tenantId, identity.Email, identity.Name);
        if (_sessionDatabase is null) _sessions[Digest(token)] = session;
        else
        {
            await using var command = _sessionDatabase.CreateCommand("""
                WITH expired AS (
                    DELETE FROM sparklewash.staff_sessions WHERE expires_at <= now()
                )
                INSERT INTO sparklewash.staff_sessions (token_digest, tenant_id, subject, role, email, name, expires_at)
                SELECT $1, $2, $3, $4, $5, $6, $7
                WHERE (SELECT count(*) FROM sparklewash.staff_sessions WHERE expires_at > now()) < 10000
                """);
            command.Parameters.AddWithValue(Digest(token));
            command.Parameters.AddWithValue(tenantId);
            command.Parameters.AddWithValue(session.Subject);
            command.Parameters.AddWithValue(role);
            command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)session.Email ?? DBNull.Value);
            command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)session.Name ?? DBNull.Value);
            command.Parameters.AddWithValue(session.ExpiresAt);
            if (await command.ExecuteNonQueryAsync() != 1) return null;
        }
        return (token, session);
    }

    private async Task<StaffSession?> ReadSessionAsync(string digest)
    {
        await using var command = _sessionDatabase!.CreateCommand("""
            SELECT subject, role, expires_at, tenant_id, email, name
            FROM sparklewash.staff_sessions WHERE token_digest = $1 AND expires_at > now()
            """);
        command.Parameters.AddWithValue(digest);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new StaffSession(reader.GetString(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2),
            reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5));
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
