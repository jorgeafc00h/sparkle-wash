using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace CarwashApi;

internal sealed class PostgresDeviceStore(NpgsqlDataSource database, string tenantId) : DeviceStore
{
    private static readonly JsonSerializerOptions RowOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private static readonly JsonSerializerOptions StatusOptions = new(JsonSerializerDefaults.Web);

    public override async Task<DeviceView[]> ListAsync()
    {
        await using var command = Command("SELECT to_jsonb(d) FROM sparklewash.devices d WHERE tenant_id=$1 ORDER BY created_at,id");
        await using var reader = await command.ExecuteReaderAsync();
        var devices = new List<DeviceView>();
        var now = DateTimeOffset.UtcNow;
        while (await reader.ReadAsync()) devices.Add(View(Decode(reader.GetString(0)), now));
        return devices.ToArray();
    }

    public override async Task<(DeviceCreateStatus Status, DeviceView? Device, string? Key)> CreateAsync(
        string requestedTenant, DeviceInput input, string actor)
    {
        RequireTenant(requestedTenant);
        var id = Guid.NewGuid().ToString("N")[..16];
        var (key, hash, hint) = NewKey(tenantId, id);
        await using var connection = await database.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var lockTenant = Command("SELECT id FROM sparklewash.tenants WHERE id=$1 FOR UPDATE", connection);
        if (await lockTenant.ExecuteScalarAsync() is null) return (DeviceCreateStatus.Conflict, null, null);
        await using var insert = Command("""
            INSERT INTO sparklewash.devices
                (tenant_id,id,name,camera_id,role,key_hash,key_hint,created_at,created_by,disabled,observations)
            SELECT $1,$2,$3,$4,$5,$6,$7,now(),$8,false,0
            WHERE (SELECT count(*) FROM sparklewash.devices WHERE tenant_id=$1 AND NOT disabled) < $9
            RETURNING to_jsonb(devices)
            """, connection, id, input.Name!, input.CameraId!, input.Role!, hash, hint, actor, MaxDevices);
        try
        {
            var device = await Read(insert);
            if (device is null) return (DeviceCreateStatus.Limit, null, null);
            await transaction.CommitAsync();
            return (DeviceCreateStatus.Created, View(device, DateTimeOffset.UtcNow), key);
        }
        catch (PostgresException error) when (CameraConflict(error))
        {
            return (DeviceCreateStatus.Conflict, null, null);
        }
    }

    public override async Task<(DeviceView Device, string Key)?> RotateAsync(string requestedTenant, string id)
    {
        RequireTenant(requestedTenant);
        var (key, hash, hint) = NewKey(tenantId, id);
        await using var command = Command("""
            UPDATE sparklewash.devices SET key_hash=$3,key_hint=$4,key_rotated_at=now()
            WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(devices)
            """, null, id, hash, hint);
        return await Read(command) is { } device ? (View(device, DateTimeOffset.UtcNow), key) : null;
    }

    public override async Task<(DeviceView? Device, bool Conflict)> SetDisabledAsync(string id, bool disabled)
    {
        await using var command = Command("""
            UPDATE sparklewash.devices SET disabled=$3 WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(devices)
            """, null, id, disabled);
        try
        {
            return (await Read(command) is { } device ? View(device, DateTimeOffset.UtcNow) : null, false);
        }
        catch (PostgresException error) when (CameraConflict(error))
        {
            await using var current = Command("SELECT to_jsonb(d) FROM sparklewash.devices d WHERE tenant_id=$1 AND id=$2", null, id);
            return (await Read(current) is { } device ? View(device, DateTimeOffset.UtcNow) : null, true);
        }
    }

    public override async Task<Device?> AuthenticateAsync(string deviceId, string secret)
    {
        await using var command = Command("""
            SELECT to_jsonb(d) FROM sparklewash.devices d WHERE tenant_id=$1 AND id=$2 AND NOT disabled
            """, null, deviceId);
        if (await Read(command) is not { } device) return null;
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
        return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(device.KeyHash), hash) ? device : null;
    }

    public override async Task<DeviceView?> TouchAsync(string id, DeviceStatus? status, bool observation)
    {
        await using var command = Command("""
            UPDATE sparklewash.devices
            SET last_seen_at=now(),last_status=COALESCE($3,last_status),observations=observations+$4
            WHERE tenant_id=$1 AND id=$2 RETURNING to_jsonb(devices)
            """, null, id);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb,
            status is null ? DBNull.Value : JsonSerializer.Serialize(status, StatusOptions));
        command.Parameters.AddWithValue(observation ? 1 : 0);
        return await Read(command) is { } device ? View(device, DateTimeOffset.UtcNow) : null;
    }

    public override async Task<string?> RoleForCameraAsync(string cameraId)
    {
        await using var command = Command("SELECT role FROM sparklewash.devices WHERE tenant_id=$1 AND camera_id=$2 AND NOT disabled",
            null, cameraId);
        return await command.ExecuteScalarAsync() as string;
    }

    private NpgsqlCommand Command(string sql, NpgsqlConnection? connection = null, params object[] values)
    {
        var command = connection is null ? database.CreateCommand(sql) : new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(tenantId);
        foreach (var value in values) command.Parameters.AddWithValue(value);
        return command;
    }

    private static async Task<Device?> Read(NpgsqlCommand command) =>
        await command.ExecuteScalarAsync() is string json ? Decode(json) : null;

    private static Device Decode(string json)
    {
        using var row = JsonDocument.Parse(json);
        var device = row.RootElement.Deserialize<Device>(RowOptions)!;
        return device with { LastStatus = row.RootElement.GetProperty("last_status").Deserialize<DeviceStatus>(StatusOptions) };
    }

    private static bool CameraConflict(PostgresException error) =>
        error.SqlState == PostgresErrorCodes.UniqueViolation && error.ConstraintName == "devices_active_camera";

    private void RequireTenant(string requestedTenant)
    {
        if (tenantId != requestedTenant) throw new ArgumentException("Mismatched device tenant.", nameof(requestedTenant));
    }
}
