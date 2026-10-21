using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CarwashApi;

// Linked ESP32-CAM modules. Each device gets its own key, shown once at creation or rotation and
// stored only as a SHA-256 hash. The key pins the device to one tenant and one cameraId, so a
// leaked key can't post as another camera or another carwash, and an admin can revoke one camera
// without touching the others.
public sealed record DeviceStatus(int? Rssi, long? UptimeMs, long? FreeHeap, string? Firmware, double? Fps, string? Ip);
public sealed record Device(string Id, string Name, string CameraId, string Role, string KeyHash, string KeyHint,
    DateTimeOffset CreatedAt, string CreatedBy, bool Disabled, DateTimeOffset? LastSeenAt, DeviceStatus? LastStatus,
    int Observations, DateTimeOffset? KeyRotatedAt);
public sealed record DeviceView(string Id, string Name, string CameraId, string Role, string KeyHint, DateTimeOffset CreatedAt,
    bool Disabled, bool Online, DateTimeOffset? LastSeenAt, DeviceStatus? LastStatus, int Observations, DateTimeOffset? KeyRotatedAt);
public sealed record DeviceInput(string? Name, string? CameraId, string? Role);
public sealed record DeviceStatusInput(bool Disabled);
public sealed record DeviceHeartbeatInput(int? Rssi, long? UptimeMs, long? FreeHeap, string? Firmware, double? Fps, string? Ip);
public enum DeviceCreateStatus { Created, Conflict, Limit }

public sealed class DeviceStore
{
    public const int MaxDevices = 50;
    public static readonly TimeSpan OnlineWindow = TimeSpan.FromMinutes(2);
    public static readonly string[] Roles = ["entry", "bay", "exit"];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private List<Device> _devices;

    public DeviceStore(string path)
    {
        _path = path;
        _devices = File.Exists(path) ? JsonSerializer.Deserialize<List<Device>>(File.ReadAllText(path), JsonOptions) ?? [] : [];
    }

    public async Task<DeviceView[]> ListAsync()
    {
        await _gate.WaitAsync();
        try { var now = DateTimeOffset.UtcNow; return _devices.OrderBy(x => x.CreatedAt).Select(x => View(x, now)).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<(DeviceCreateStatus Status, DeviceView? Device, string? Key)> CreateAsync(string tenantId, DeviceInput input, string actor)
    {
        await _gate.WaitAsync();
        try
        {
            if (_devices.Count(x => !x.Disabled) >= MaxDevices) return (DeviceCreateStatus.Limit, null, null);
            if (_devices.Any(x => x.CameraId == input.CameraId && !x.Disabled)) return (DeviceCreateStatus.Conflict, null, null);
            var id = Guid.NewGuid().ToString("N")[..16];
            var (key, hash, hint) = NewKey(tenantId, id);
            var device = new Device(id, input.Name!, input.CameraId!, input.Role!, hash, hint, DateTimeOffset.UtcNow, actor,
                false, null, null, 0, null);
            await PersistAsync([.. _devices, device]);
            return (DeviceCreateStatus.Created, View(device, DateTimeOffset.UtcNow), key);
        }
        finally { _gate.Release(); }
    }

    public async Task<(DeviceView Device, string Key)?> RotateAsync(string tenantId, string id)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _devices.FindIndex(x => x.Id == id);
            if (index < 0) return null;
            var (key, hash, hint) = NewKey(tenantId, id);
            var next = _devices.ToList();
            next[index] = next[index] with { KeyHash = hash, KeyHint = hint, KeyRotatedAt = DateTimeOffset.UtcNow };
            await PersistAsync(next);
            return (View(next[index], DateTimeOffset.UtcNow), key);
        }
        finally { _gate.Release(); }
    }

    public async Task<(DeviceView? Device, bool Conflict)> SetDisabledAsync(string id, bool disabled)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _devices.FindIndex(x => x.Id == id);
            if (index < 0) return (null, false);
            var device = _devices[index];
            // Re-enabling must not create two active devices for one camera.
            if (!disabled && device.Disabled && _devices.Any(x => x.Id != id && !x.Disabled && x.CameraId == device.CameraId))
                return (View(device, DateTimeOffset.UtcNow), true);
            var next = _devices.ToList();
            next[index] = device with { Disabled = disabled };
            await PersistAsync(next);
            return (View(next[index], DateTimeOffset.UtcNow), false);
        }
        finally { _gate.Release(); }
    }

    /// <summary>The active device whose key this is, or null. Constant-time hash comparison.</summary>
    public async Task<Device?> AuthenticateAsync(string deviceId, string secret)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        await _gate.WaitAsync();
        try
        {
            var device = _devices.FirstOrDefault(x => x.Id == deviceId);
            if (device is null || device.Disabled) return null;
            return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(device.KeyHash), hash) ? device : null;
        }
        finally { _gate.Release(); }
    }

    public async Task<DeviceView?> TouchAsync(string id, DeviceStatus? status, bool observation)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _devices.FindIndex(x => x.Id == id);
            if (index < 0) return null;
            var next = _devices.ToList();
            next[index] = next[index] with
            {
                LastSeenAt = DateTimeOffset.UtcNow, LastStatus = status ?? next[index].LastStatus,
                Observations = next[index].Observations + (observation ? 1 : 0)
            };
            await PersistAsync(next);
            return View(next[index], DateTimeOffset.UtcNow);
        }
        finally { _gate.Release(); }
    }

    public async Task<string?> RoleForCameraAsync(string cameraId)
    {
        await _gate.WaitAsync();
        try { return _devices.FirstOrDefault(x => x.CameraId == cameraId && !x.Disabled)?.Role; }
        finally { _gate.Release(); }
    }

    /// <summary>Device keys look like <c>swd.{tenantId}.{deviceId}.{secret}</c>, so the API can find the
    /// tenant and device without scanning every carwash.</summary>
    public static (string TenantId, string DeviceId, string Secret)? ParseKey(string? key)
    {
        if (key is null || key.Length > 160) return null;
        var parts = key.Split('.');
        if (parts.Length != 4 || parts[0] != "swd" || parts.Skip(1).Any(p => p.Length == 0) ||
            !parts[1].All(char.IsAsciiLetterOrDigit) || !parts[2].All(char.IsAsciiHexDigit)) return null;
        return (parts[1], parts[2], parts[3]);
    }

    public static DeviceInput? Normalize(DeviceInput input)
    {
        var name = input.Name?.Trim();
        var cameraId = input.CameraId?.Trim().ToLowerInvariant();
        if (name is null || name.Length is < 2 or > 60 || name.Any(char.IsControl)) return null;
        if (cameraId is null || cameraId.Length is < 1 or > 64 || !cameraId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')) return null;
        if (input.Role is null || !Roles.Contains(input.Role)) return null;
        return new DeviceInput(name, cameraId, input.Role);
    }

    private static (string Key, string Hash, string Hint) NewKey(string tenantId, string deviceId)
    {
        var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));
        return ($"swd.{tenantId}.{deviceId}.{secret}", hash, "…" + secret[^4..]);
    }

    private static DeviceView View(Device d, DateTimeOffset now) => new(d.Id, d.Name, d.CameraId, d.Role, d.KeyHint, d.CreatedAt,
        d.Disabled, !d.Disabled && d.LastSeenAt is not null && now - d.LastSeenAt.Value <= OnlineWindow, d.LastSeenAt, d.LastStatus,
        d.Observations, d.KeyRotatedAt);

    private async Task PersistAsync(List<Device> next)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(next, JsonOptions));
            File.Move(temp, _path, true);
            _devices = next;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
