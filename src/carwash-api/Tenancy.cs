using System.Collections.Concurrent;
using System.Text.Json;

namespace CarwashApi;

// A tenant is one registered carwash. Each tenant gets its own data directory (arrivals, jobs,
// operations, photos, devices), so nothing one carwash records is visible to another.
public sealed record Tenant(string Id, string Name, string? City, string Country, string? Phone, string TimeZone,
    DateTimeOffset CreatedAt, string? OwnerSubject);
public sealed record TenantInput(string? Name, string? City, string? Country, string? Phone, string? TimeZone);
public sealed record RegisterTenantInput(string? IdToken, string? Name, string? City, string? Country, string? Phone, string? TimeZone);
public sealed record Membership(string TenantId, string Subject, string? Email, string? Name, string Role, DateTimeOffset AddedAt, string AddedBy);
public sealed record Invitation(string Id, string TenantId, string Email, string Role, DateTimeOffset InvitedAt, string InvitedBy,
    DateTimeOffset? AcceptedAt, string? AcceptedBy);
public sealed record InvitationInput(string? Email, string? Role);
public sealed record RoleInput(string? Role);
public enum TeamChangeStatus { Done, NotFound, LastAdmin, Conflict }

public sealed class TenantDirectory
{
    public const string DefaultTenantId = "default";
    private sealed record Persisted(List<Tenant> Tenants, List<Membership> Memberships, List<Invitation> Invitations);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private readonly int _maxTenants;
    private Persisted _data;

    public TenantDirectory(string path, Tenant defaultTenant, int maxTenants = 500)
    {
        _path = path;
        _maxTenants = maxTenants;
        _data = File.Exists(path)
            ? JsonSerializer.Deserialize<Persisted>(File.ReadAllText(path), JsonOptions) ?? new Persisted([], [], [])
            : new Persisted([], [], []);
        // The single-site deployment that predates registration is the "default" tenant; it is not
        // written to disk until someone edits it.
        if (_data.Tenants.All(x => x.Id != DefaultTenantId)) _data = _data with { Tenants = [defaultTenant, .. _data.Tenants] };
    }

    public async Task<Tenant?> GetAsync(string id)
    {
        await _gate.WaitAsync();
        try { return _data.Tenants.FirstOrDefault(x => x.Id == id); }
        finally { _gate.Release(); }
    }

    public async Task<Membership?> MembershipForAsync(string subject)
    {
        await _gate.WaitAsync();
        try { return _data.Memberships.FirstOrDefault(x => x.Subject == subject); }
        finally { _gate.Release(); }
    }

    public async Task<(Membership[] Members, Invitation[] Invitations)> TeamAsync(string tenantId)
    {
        await _gate.WaitAsync();
        try
        {
            return (_data.Memberships.Where(x => x.TenantId == tenantId).OrderBy(x => x.AddedAt).ToArray(),
                _data.Invitations.Where(x => x.TenantId == tenantId && x.AcceptedAt is null).OrderByDescending(x => x.InvitedAt).ToArray());
        }
        finally { _gate.Release(); }
    }

    /// <summary>Creates a tenant with <paramref name="identity"/> as its admin. Null when that Google account
    /// already belongs to a carwash or the registration cap is reached.</summary>
    public async Task<Tenant?> RegisterAsync(GoogleIdentity identity, TenantInput input)
    {
        await _gate.WaitAsync();
        try
        {
            if (_data.Memberships.Any(x => x.Subject == identity.Subject) || _data.Tenants.Count >= _maxTenants) return null;
            var now = DateTimeOffset.UtcNow;
            var tenant = new Tenant("t" + Guid.NewGuid().ToString("N")[..15], input.Name!, input.City, input.Country!, input.Phone,
                input.TimeZone!, now, identity.Subject);
            var owner = new Membership(tenant.Id, identity.Subject, identity.Email, identity.Name, "admin", now, identity.Subject);
            await PersistAsync(_data with { Tenants = [.. _data.Tenants, tenant], Memberships = [.. _data.Memberships, owner] });
            return tenant;
        }
        finally { _gate.Release(); }
    }

    public async Task<Tenant?> UpdateAsync(string id, TenantInput input)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _data.Tenants.FindIndex(x => x.Id == id);
            if (index < 0) return null;
            var updated = _data.Tenants[index] with
            {
                Name = input.Name!, City = input.City, Country = input.Country!, Phone = input.Phone, TimeZone = input.TimeZone!
            };
            var tenants = _data.Tenants.ToList();
            tenants[index] = updated;
            await PersistAsync(_data with { Tenants = tenants });
            return updated;
        }
        finally { _gate.Release(); }
    }

    public async Task<Invitation?> InviteAsync(string tenantId, string email, string role, string actor)
    {
        await _gate.WaitAsync();
        try
        {
            if (_data.Invitations.Any(x => x.TenantId == tenantId && x.AcceptedAt is null && SameEmail(x.Email, email)) ||
                _data.Memberships.Any(x => x.TenantId == tenantId && SameEmail(x.Email, email)) ||
                _data.Invitations.Count(x => x.TenantId == tenantId && x.AcceptedAt is null) >= 100)
                return null;
            var invitation = new Invitation(Guid.NewGuid().ToString("N"), tenantId, email, role, DateTimeOffset.UtcNow, actor, null, null);
            await PersistAsync(_data with { Invitations = [.. _data.Invitations, invitation] });
            return invitation;
        }
        finally { _gate.Release(); }
    }

    public async Task<bool> RevokeInvitationAsync(string tenantId, string id)
    {
        await _gate.WaitAsync();
        try
        {
            var invitation = _data.Invitations.FirstOrDefault(x => x.Id == id && x.TenantId == tenantId && x.AcceptedAt is null);
            if (invitation is null) return false;
            await PersistAsync(_data with { Invitations = _data.Invitations.Where(x => x != invitation).ToList() });
            return true;
        }
        finally { _gate.Release(); }
    }

    /// <summary>Turns the oldest pending invitation for a verified email into a membership.</summary>
    public async Task<Membership?> AcceptInvitationAsync(GoogleIdentity identity)
    {
        if (!identity.EmailVerified || string.IsNullOrWhiteSpace(identity.Email)) return null;
        await _gate.WaitAsync();
        try
        {
            if (_data.Memberships.Any(x => x.Subject == identity.Subject)) return null;
            var invitation = _data.Invitations.Where(x => x.AcceptedAt is null && SameEmail(x.Email, identity.Email))
                .OrderBy(x => x.InvitedAt).FirstOrDefault();
            if (invitation is null) return null;
            var now = DateTimeOffset.UtcNow;
            var membership = new Membership(invitation.TenantId, identity.Subject, identity.Email, identity.Name, invitation.Role, now, invitation.InvitedBy);
            var invitations = _data.Invitations.Select(x => x.Id == invitation.Id ? x with { AcceptedAt = now, AcceptedBy = identity.Subject } : x).ToList();
            await PersistAsync(_data with { Memberships = [.. _data.Memberships, membership], Invitations = invitations });
            return membership;
        }
        finally { _gate.Release(); }
    }

    public async Task<TeamChangeStatus> SetRoleAsync(string tenantId, string subject, string role)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _data.Memberships.FindIndex(x => x.TenantId == tenantId && x.Subject == subject);
            if (index < 0) return TeamChangeStatus.NotFound;
            if (_data.Memberships[index].Role == "admin" && role != "admin" && AdminCount(tenantId) == 1) return TeamChangeStatus.LastAdmin;
            var memberships = _data.Memberships.ToList();
            memberships[index] = memberships[index] with { Role = role };
            await PersistAsync(_data with { Memberships = memberships });
            return TeamChangeStatus.Done;
        }
        finally { _gate.Release(); }
    }

    public async Task<TeamChangeStatus> RemoveAsync(string tenantId, string subject)
    {
        await _gate.WaitAsync();
        try
        {
            var member = _data.Memberships.FirstOrDefault(x => x.TenantId == tenantId && x.Subject == subject);
            if (member is null) return TeamChangeStatus.NotFound;
            if (member.Role == "admin" && AdminCount(tenantId) == 1) return TeamChangeStatus.LastAdmin;
            await PersistAsync(_data with { Memberships = _data.Memberships.Where(x => x != member).ToList() });
            return TeamChangeStatus.Done;
        }
        finally { _gate.Release(); }
    }

    private int AdminCount(string tenantId) => _data.Memberships.Count(x => x.TenantId == tenantId && x.Role == "admin");
    private static bool SameEmail(string? a, string? b) => a is not null && b is not null && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private async Task PersistAsync(Persisted next)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(next, JsonOptions));
            File.Move(temp, _path, true);
            _data = next;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    // ---------- validation ----------
    public static readonly string[] Roles = ["viewer", "operator", "admin"];

    /// <summary>Normalizes registration/profile input; returns null when anything is invalid.</summary>
    public static TenantInput? Normalize(TenantInput input)
    {
        var name = input.Name?.Trim();
        var city = string.IsNullOrWhiteSpace(input.City) ? null : input.City.Trim();
        var country = (input.Country ?? "SV").Trim().ToUpperInvariant();
        var phone = string.IsNullOrWhiteSpace(input.Phone) ? null : input.Phone.Trim();
        var timeZone = string.IsNullOrWhiteSpace(input.TimeZone) ? "America/El_Salvador" : input.TimeZone.Trim();
        if (name is null || name.Length is < 2 or > 80 || name.Any(char.IsControl)) return null;
        if (city is not null && (city.Length > 80 || city.Any(char.IsControl))) return null;
        if (country.Length != 2 || !country.All(char.IsAsciiLetterUpper)) return null;
        if (phone is not null && (phone.Length is < 6 or > 24 || !phone.All(c => char.IsAsciiDigit(c) || c is '+' or ' ' or '-' or '(' or ')'))) return null;
        if (timeZone.Length > 64 || !TimeZoneInfo.TryFindSystemTimeZoneById(timeZone, out _)) return null;
        return new TenantInput(name, city, country, phone, timeZone);
    }

    public static string? NormalizeEmail(string? email)
    {
        var value = email?.Trim();
        if (value is null || value.Length is < 3 or > 254 || value.Any(c => char.IsWhiteSpace(c) || char.IsControl(c))) return null;
        var at = value.IndexOf('@');
        return at > 0 && at == value.LastIndexOf('@') && value.IndexOf('.', at) > at + 1 && !value.EndsWith('.') ? value.ToLowerInvariant() : null;
    }

    public static TimeZoneInfo Zone(Tenant? tenant) =>
        tenant is not null && TimeZoneInfo.TryFindSystemTimeZoneById(tenant.TimeZone, out var zone) ? zone : TimeZoneInfo.Utc;
}

/// <summary>Everything one carwash owns.</summary>
public sealed class TenantContext(string id, ArrivalStore arrivals, JobStore jobs, OperationsStore operations, PhotoStore photos, DeviceStore devices)
{
    public string Id { get; } = id;
    public ArrivalStore Arrivals { get; } = arrivals;
    public JobStore Jobs { get; } = jobs;
    public OperationsStore Operations { get; } = operations;
    public PhotoStore Photos { get; } = photos;
    public DeviceStore Devices { get; } = devices;
    public ChangeFeed Changes { get; } = new();
}

public sealed class TenantRegistry(string tenantsDirectory, TenantContext defaultContext, int photoMaxCount)
{
    private readonly ConcurrentDictionary<string, Lazy<TenantContext>> _contexts = new(
        [new(TenantDirectory.DefaultTenantId, new Lazy<TenantContext>(defaultContext))]);

    public TenantContext For(string tenantId) => _contexts.GetOrAdd(tenantId, id => new Lazy<TenantContext>(() =>
    {
        // Tenant ids are generated server-side ("t" + hex), but never trust them for a path without checking.
        if (!id.All(char.IsAsciiLetterOrDigit)) throw new ArgumentException("Invalid tenant id", nameof(tenantId));
        var root = Path.Combine(tenantsDirectory, id);
        return new TenantContext(id, new ArrivalStore(Path.Combine(root, "arrivals.json")), new JobStore(Path.Combine(root, "jobs.json")),
            new OperationsStore(Path.Combine(root, "operations.json")), new PhotoStore(Path.Combine(root, "photos"), photoMaxCount),
            new DeviceStore(Path.Combine(root, "devices.json")));
    })).Value;
}
