using System.Data;
using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace CarwashApi;

internal sealed record PostgresArchiveIndex(string Revision, long JobCount);

/// <summary>Reads a stable, tenant-scoped snapshot of completed jobs from PostgreSQL.</summary>
internal sealed class PostgresArchiveReader(NpgsqlDataSource source)
{
    internal async Task<PostgresArchiveIndex> GetIndexAsync(string tenantId, CancellationToken cancellationToken = default)
    {
        await using var connection = await source.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT COALESCE((SELECT revision FROM sparklewash.archive_revisions WHERE tenant_id = $1), 0),
                   (SELECT count(*) FROM sparklewash.jobs
                    WHERE tenant_id = $1 AND status = 'completed' AND completed_at IS NOT NULL)
            """, connection);
        command.Parameters.AddWithValue(tenantId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        var version = reader.GetInt64(0);
        var count = reader.GetInt64(1);
        return new PostgresArchiveIndex(Revision(tenantId, version), count);
    }

    internal async Task<ArchivedJobPage?> ReadAsync(string tenantId, string batch, int offset, int limit,
        CancellationToken cancellationToken = default)
    {
        if (!ArchivedJobReader.ValidBatch(batch) || offset < 0 || limit is < 1 or > 100)
            return null;

        await using var connection = await source.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        await using (var readOnly = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, transaction))
            await readOnly.ExecuteNonQueryAsync(cancellationToken);

        await using var state = new NpgsqlCommand("""
            SELECT COALESCE((SELECT revision FROM sparklewash.archive_revisions WHERE tenant_id = $1), 0),
                   (SELECT count(*) FROM sparklewash.jobs
                    WHERE tenant_id = $1 AND status = 'completed' AND completed_at IS NOT NULL)
            """, connection, transaction);
        state.Parameters.AddWithValue(tenantId);
        long version;
        long count;
        await using (var stateReader = await state.ExecuteReaderAsync(cancellationToken))
        {
            await stateReader.ReadAsync(cancellationToken);
            version = stateReader.GetInt64(0);
            count = stateReader.GetInt64(1);
        }

        if (count == 0 || !CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(batch), Convert.FromHexString(Revision(tenantId, version))))
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        await using var page = new NpgsqlCommand("""
            SELECT id, plate, package_name, completed_at
            FROM sparklewash.jobs
            WHERE tenant_id = $1 AND status = 'completed' AND completed_at IS NOT NULL
            ORDER BY completed_at, id
            LIMIT $2 OFFSET $3
            """, connection, transaction);
        page.Parameters.AddWithValue(tenantId);
        page.Parameters.AddWithValue(limit);
        page.Parameters.AddWithValue(offset);
        var jobs = new List<ArchivedJob>(limit);
        await using (var rows = await page.ExecuteReaderAsync(cancellationToken))
        {
            while (await rows.ReadAsync(cancellationToken))
                jobs.Add(new ArchivedJob(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetFieldValue<DateTimeOffset>(3)));
        }

        int? nextOffset = (long)offset + jobs.Count < count ? offset + jobs.Count : null;
        await transaction.CommitAsync(cancellationToken);
        return new ArchivedJobPage(batch, jobs.ToArray(), nextOffset);
    }

    private static string Revision(string tenantId, long version)
    {
        var payload = Encoding.UTF8.GetBytes($"sparklewash-completed-history-v1\0{tenantId}\0{version}");
        return Convert.ToHexStringLower(SHA256.HashData(payload));
    }
}
