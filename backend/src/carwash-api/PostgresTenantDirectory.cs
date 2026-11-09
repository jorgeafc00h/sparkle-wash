using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace CarwashApi;

internal sealed class PostgresTenantDirectory(NpgsqlDataSource database, int maxTenants) : TenantDirectory
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    public override Task<Tenant?> GetAsync(string id) =>
        One<Tenant>("SELECT to_jsonb(t) FROM sparklewash.tenants t WHERE id = $1", id);

    public override Task<Membership?> MembershipForAsync(string subject) =>
        One<Membership>("SELECT to_jsonb(m) FROM sparklewash.memberships m WHERE subject = $1", subject);

    public override async Task<(Membership[] Members, Invitation[] Invitations)> TeamAsync(string tenantId)
    {
        await using var connection = await database.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var members = await Many<Membership>(connection,
            "SELECT to_jsonb(m) FROM sparklewash.memberships m WHERE tenant_id=$1 ORDER BY added_at, subject", tenantId);
        var invites = await Many<Invitation>(connection,
            "SELECT to_jsonb(i) FROM sparklewash.invitations i WHERE tenant_id=$1 AND accepted_at IS NULL ORDER BY invited_at DESC, id",
            tenantId);
        await transaction.CommitAsync();
        return (members, invites);
    }

    public override async Task<Tenant?> RegisterAsync(GoogleIdentity identity, TenantInput input)
    {
        await using var connection = await database.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await Execute(connection, "LOCK TABLE sparklewash.tenants IN SHARE ROW EXCLUSIVE MODE");
        var id = "t" + Guid.NewGuid().ToString("N")[..15];
        var tenant = await One<Tenant>(connection, """
            INSERT INTO sparklewash.tenants (id, name, city, country, phone, time_zone, created_at, owner_subject)
            SELECT $1,$2,$3,$4,$5,$6,now(),$7
            WHERE (SELECT count(*) FROM sparklewash.tenants) < $8
            RETURNING to_jsonb(tenants)
            """, id, input.Name, input.City, input.Country, input.Phone, input.TimeZone, identity.Subject, maxTenants);
        if (tenant is null) return null;
        if (await Execute(connection, """
            INSERT INTO sparklewash.memberships (tenant_id, subject, email, name, role, added_at, added_by)
            VALUES ($1,$2,$3,$4,'admin',now(),$2) ON CONFLICT (subject) DO NOTHING
            """, id, identity.Subject, identity.Email, identity.Name) != 1) return null;
        await transaction.CommitAsync();
        return tenant;
    }

    public override Task<Tenant?> UpdateAsync(string id, TenantInput input) =>
        One<Tenant>("""
            UPDATE sparklewash.tenants SET name=$2, city=$3, country=$4, phone=$5, time_zone=$6
            WHERE id=$1 RETURNING to_jsonb(tenants)
            """, id, input.Name, input.City, input.Country, input.Phone, input.TimeZone);

    public override async Task<Invitation?> InviteAsync(string tenantId, string email, string role, string actor)
    {
        await using var connection = await database.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await LockTenant(connection, tenantId);
        var result = await One<Invitation>(connection, """
            INSERT INTO sparklewash.invitations (tenant_id,id,email,role,invited_at,invited_by)
            SELECT $1,$2,$3,$4,now(),$5
            WHERE NOT EXISTS (
                SELECT FROM sparklewash.memberships WHERE tenant_id=$1 AND lower(email)=lower($3)
            ) AND (SELECT count(*) FROM sparklewash.invitations WHERE tenant_id=$1 AND accepted_at IS NULL) < 100
            ON CONFLICT DO NOTHING RETURNING to_jsonb(invitations)
            """, tenantId, Guid.NewGuid().ToString("N"), email, role, actor);
        await transaction.CommitAsync();
        return result;
    }

    public override async Task<bool> RevokeInvitationAsync(string tenantId, string id)
    {
        await using var connection = await database.OpenConnectionAsync();
        return await Execute(connection, """
            DELETE FROM sparklewash.invitations WHERE tenant_id=$1 AND id=$2 AND accepted_at IS NULL
            """, tenantId, id) == 1;
    }

    public override async Task<Membership?> AcceptInvitationAsync(GoogleIdentity identity)
    {
        if (!identity.EmailVerified || string.IsNullOrWhiteSpace(identity.Email)) return null;
        await using var connection = await database.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        var invite = await One<Invitation>(connection, """
            SELECT to_jsonb(i) FROM sparklewash.invitations i
            WHERE accepted_at IS NULL AND lower(email)=lower($1)
            ORDER BY invited_at, tenant_id, id LIMIT 1 FOR UPDATE
            """, identity.Email);
        if (invite is null) return null;
        var result = await One<Membership>(connection, """
            INSERT INTO sparklewash.memberships (tenant_id,subject,email,name,role,added_at,added_by)
            VALUES ($1,$2,$3,$4,$5,now(),$6) ON CONFLICT (subject) DO NOTHING RETURNING to_jsonb(memberships)
            """, invite.TenantId, identity.Subject, identity.Email, identity.Name, invite.Role, invite.InvitedBy);
        if (result is null) return null;
        await Execute(connection, """
            UPDATE sparklewash.invitations SET accepted_at=now(), accepted_by=$3 WHERE tenant_id=$1 AND id=$2
            """, invite.TenantId, invite.Id, identity.Subject);
        await transaction.CommitAsync();
        return result;
    }

    public override Task<TeamChangeStatus> SetRoleAsync(string tenantId, string subject, string role) =>
        ChangeMembership(tenantId, subject, role);

    public override Task<TeamChangeStatus> RemoveAsync(string tenantId, string subject) =>
        ChangeMembership(tenantId, subject, null);

    private async Task<TeamChangeStatus> ChangeMembership(string tenantId, string subject, string? role)
    {
        await using var connection = await database.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await LockTenant(connection, tenantId);
        var member = await One<Membership>(connection,
            "SELECT to_jsonb(m) FROM sparklewash.memberships m WHERE tenant_id=$1 AND subject=$2", tenantId, subject);
        if (member is null) return TeamChangeStatus.NotFound;
        if (member.Role == "admin" && role != "admin")
        {
            await using var count = Command(connection,
                "SELECT count(*) FROM sparklewash.memberships WHERE tenant_id=$1 AND role='admin'", tenantId);
            if ((long)(await count.ExecuteScalarAsync())! <= 1) return TeamChangeStatus.LastAdmin;
        }
        if (role is null)
            await Execute(connection, "DELETE FROM sparklewash.memberships WHERE tenant_id=$1 AND subject=$2", tenantId, subject);
        else
            await Execute(connection, "UPDATE sparklewash.memberships SET role=$3 WHERE tenant_id=$1 AND subject=$2", tenantId, subject, role);
        await Execute(connection, "DELETE FROM sparklewash.staff_sessions WHERE tenant_id=$1 AND subject=$2", tenantId, subject);
        await transaction.CommitAsync();
        return TeamChangeStatus.Done;
    }

    private static async Task LockTenant(NpgsqlConnection connection, string tenantId)
    {
        await using var command = Command(connection, "SELECT id FROM sparklewash.tenants WHERE id=$1 FOR UPDATE", tenantId);
        await command.ExecuteScalarAsync();
    }

    private async Task<T?> One<T>(string sql, params object?[] values) where T : class
    {
        await using var connection = await database.OpenConnectionAsync();
        return await One<T>(connection, sql, values);
    }

    private static async Task<T?> One<T>(NpgsqlConnection connection, string sql, params object?[] values) where T : class
    {
        await using var command = Command(connection, sql, values);
        return await command.ExecuteScalarAsync() is string json ? JsonSerializer.Deserialize<T>(json, JsonOptions) : null;
    }

    private static async Task<T[]> Many<T>(NpgsqlConnection connection, string sql, params object?[] values)
    {
        await using var command = Command(connection, sql, values);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<T>();
        while (await reader.ReadAsync()) rows.Add(JsonSerializer.Deserialize<T>(reader.GetString(0), JsonOptions)!);
        return rows.ToArray();
    }

    private static async Task<int> Execute(NpgsqlConnection connection, string sql, params object?[] values)
    {
        await using var command = Command(connection, sql, values);
        return await command.ExecuteNonQueryAsync();
    }

    private static NpgsqlCommand Command(NpgsqlConnection connection, string sql, params object?[] values)
    {
        var command = new NpgsqlCommand(sql, connection);
        foreach (var value in values)
        {
            if (value is null) command.Parameters.AddWithValue(NpgsqlDbType.Text, DBNull.Value);
            else command.Parameters.AddWithValue(value);
        }
        return command;
    }
}
