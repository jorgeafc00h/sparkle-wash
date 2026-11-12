using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace CarwashApi;

internal sealed class PostgresWorkflowDatabase(NpgsqlDataSource source, string tenantId)
{
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions RowJson = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private const string SaveArrivalSql = """
        INSERT INTO sparklewash.arrivals SELECT * FROM jsonb_populate_record(NULL::sparklewash.arrivals, $1)
        ON CONFLICT (tenant_id, id) DO UPDATE SET
            confirmed_plate=excluded.confirmed_plate, vehicle_class=excluded.vehicle_class,
            confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at,
            job_id=excluded.job_id, dismissed_at=excluded.dismissed_at,
            dismissed_by=excluded.dismissed_by, dismiss_reason=excluded.dismiss_reason
        """;
    private const string SaveJobSql = """
        INSERT INTO sparklewash.jobs SELECT * FROM jsonb_populate_record(NULL::sparklewash.jobs, $1)
        ON CONFLICT (tenant_id, id) DO UPDATE SET status=excluded.status,
            started_at=excluded.started_at, completed_at=excluded.completed_at, cancelled_at=excluded.cancelled_at,
            transitions=excluded.transitions, assignments=excluded.assignments,
            ticket_number=excluded.ticket_number, customer_name=excluded.customer_name, note=excluded.note,
            payments=excluded.payments, paid_at=excluded.paid_at
        """;

    internal async Task<T> RunAsync<T>(bool write, Func<NpgsqlConnection, Task<T>> operation)
    {
        await using var connection = await source.OpenConnectionAsync();
        if (!write) return await operation(connection);
        await using var transaction = await connection.BeginTransactionAsync();
        await using var tenantLock = Query(connection, "SELECT id FROM sparklewash.tenants WHERE id=$1 FOR UPDATE");
        if (await tenantLock.ExecuteScalarAsync() is null)
            throw new InvalidOperationException("Workflow tenant has not been provisioned.");
        var result = await operation(connection);
        await transaction.CommitAsync();
        return result;
    }

    internal async Task<List<ArrivalObservation>> Arrivals(NpgsqlConnection connection, string filter = "", params object[] values)
    {
        await using var command = Query(connection,
            "SELECT to_jsonb(a) FROM sparklewash.arrivals a WHERE tenant_id=$1 " + filter + " ORDER BY received_at,id", values);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<ArrivalObservation>();
        while (await reader.ReadAsync()) rows.Add(JsonSerializer.Deserialize<ArrivalObservation>(reader.GetString(0), RowJson)!);
        return rows;
    }

    internal async Task<List<JobRecord>> Jobs(NpgsqlConnection connection, string filter = "", params object[] values)
    {
        await using var command = Query(connection,
            "SELECT to_jsonb(j) FROM sparklewash.jobs j WHERE tenant_id=$1 " + filter + " ORDER BY arrival_at,id", values);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<JobRecord>();
        while (await reader.ReadAsync())
        {
            using var document = JsonDocument.Parse(reader.GetString(0));
            var row = document.RootElement;
            rows.Add(row.Deserialize<JobRecord>(RowJson)! with
            {
                Transitions = row.GetProperty("transitions").Deserialize<List<JobTransition>>(WebJson)!,
                Assignments = row.GetProperty("assignments").Deserialize<List<JobAssignment>>(WebJson)!,
                Payments = row.TryGetProperty("payments", out var payments) && payments.ValueKind == JsonValueKind.Array
                    ? payments.Deserialize<List<JobPayment>>(WebJson)! : []
            });
        }
        return rows;
    }

    internal Task SaveArrival(NpgsqlConnection connection, ArrivalObservation row) => Save(connection, SaveArrivalSql, row);
    internal Task SaveJob(NpgsqlConnection connection, JobRecord row) => Save(connection, SaveJobSql, row);

    internal async Task Save<T>(NpgsqlConnection connection, string sql, T row)
    {
        var fields = JsonSerializer.SerializeToElement(row, WebJson).EnumerateObject()
            .ToDictionary(property => JsonNamingPolicy.SnakeCaseLower.ConvertName(property.Name), property => property.Value);
        fields["tenant_id"] = JsonSerializer.SerializeToElement(tenantId);
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(NpgsqlDbType.Jsonb, JsonSerializer.Serialize(fields));
        await command.ExecuteNonQueryAsync();
    }

    internal NpgsqlCommand Query(NpgsqlConnection connection, string sql, params object[] values)
    {
        var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(tenantId);
        foreach (var value in values) command.Parameters.AddWithValue(value);
        return command;
    }
}

internal sealed class PostgresArrivalStore(PostgresWorkflowDatabase database) : ArrivalStore
{
    public override Task<ArrivalObservation[]> ListAsync() => database.RunAsync(false, async connection =>
        (await database.Arrivals(connection)).OrderByDescending(row => row.ReceivedAt).ToArray());

    public override Task<ArrivalAddResult> AddAsync(ArrivalInput input, byte[]? photo, PhotoStore photos, string cameraRole = "entry") =>
        database.RunAsync(true, async connection =>
        {
            var rows = await database.Arrivals(connection, "AND camera_id=$2 AND device_event_id=$3", input.CameraId!, input.DeviceEventId!);
            return await new ArrivalStore(rows, row => database.SaveArrival(connection, row)).AddAsync(input, photo, photos, cameraRole);
        });

    public override Task<ArrivalConfirmResult> ConfirmAsync(string id, string plate, string vehicleClass, string subject) =>
        Update(id, store => store.ConfirmAsync(id, plate, vehicleClass, subject));

    public override Task<ArrivalObservation?> DismissAsync(string id, string reason, string actor = "system") =>
        Update(id, store => store.DismissAsync(id, reason, actor));

    public override Task<ArrivalObservation?> LinkJobAsync(string id, string jobId) =>
        Update(id, store => store.LinkJobAsync(id, jobId));

    private Task<T> Update<T>(string id, Func<ArrivalStore, Task<T>> operation) => database.RunAsync(true, async connection =>
    {
        var rows = await database.Arrivals(connection, "AND id=$2", id);
        return await operation(new ArrivalStore(rows, row => database.SaveArrival(connection, row)));
    });
}

internal sealed class PostgresJobStore(PostgresWorkflowDatabase database, bool releaseStock = false) : JobStore
{
    public override Task<JobView[]> ListAsync() => database.RunAsync(false, async connection =>
        await new JobStore(await database.Jobs(connection)).ListAsync());

    public override Task<JobView?> GetAsync(string id) => database.RunAsync(false, async connection =>
        await new JobStore(await database.Jobs(connection, "AND id=$2", id)).GetAsync(id));

    public override Task<JobView?> FindOpenByPlateAsync(string plate, TimeSpan? closedWithin = null) =>
        database.RunAsync(false, async connection =>
            await new JobStore(await database.Jobs(connection, "AND plate=$2 AND status <> 'cancelled'", plate))
                .FindOpenByPlateAsync(plate, closedWithin));

    public override Task<JobView?> FindOpenByTicketAsync(string ticketNumber) => database.RunAsync(false, async connection =>
        await new JobStore(await database.Jobs(connection, "AND ticket_number=$2 AND status NOT IN ('completed','cancelled')", ticketNumber))
            .FindOpenByTicketAsync(ticketNumber));

    public override Task<JobSummary> SummaryAsync(TimeZoneInfo? zone = null) => database.RunAsync(false, async connection =>
        await new JobStore(await database.Jobs(connection)).SummaryAsync(zone));

    public override Task<JobActionResult> CreateAsync(ArrivalObservation arrival, ServicePackage package, string key, string actor,
        JobOpenDetails? details = null) =>
        database.RunAsync(true, async connection =>
        {
            var current = (await database.Arrivals(connection, "AND id=$2", arrival.Id)).SingleOrDefault();
            if (current is null || current.ConfirmedAt is null || current.DismissedAt is not null ||
                current.VehicleClass is null || !package.Prices.ContainsKey(current.VehicleClass))
                return new JobActionResult(JobActionStatus.Conflict, null);
            var candidates = await database.Jobs(connection, """
                AND (arrival_id=$2 OR ((plate=$3 OR ticket_number=$5) AND status NOT IN ('completed','cancelled'))
                    OR transitions @> jsonb_build_array(jsonb_build_object('status','arrived','idempotencyKey',$4::text)))
                """, current.Id, current.ConfirmedPlate!, key, (object?)details?.TicketNumber ?? DBNull.Value);
            var result = await new JobStore(candidates, row => database.SaveJob(connection, row))
                .CreateAsync(current, package, key, actor, details);
            if (result.Status is JobActionStatus.Created or JobActionStatus.Duplicate && result.Job is not null && current.JobId is null)
                await database.SaveArrival(connection, current with { JobId = result.Job.Id });
            return result;
        });

    public override Task<JobActionResult> TransitionAsync(string id, string status, string key, string actor) =>
        database.RunAsync(true, async connection =>
        {
            var rows = await database.Jobs(connection, "AND id=$2", id);
            var result = await new JobStore(rows, row => database.SaveJob(connection, row)).TransitionAsync(id, status, key, actor);
            if (releaseStock && (status is "completed" or "cancelled") &&
                (result.Status is JobActionStatus.Created or JobActionStatus.Duplicate))
                await PostgresOperationsStore.ReleaseAsync(database, connection, id);
            return result;
        });

    public override Task<JobActionResult> AssignAsync(string id, Employee employee, string key) =>
        Update(id, store => store.AssignAsync(id, employee, key));

    public override Task<JobActionResult> SetTicketAsync(string id, string ticketNumber) =>
        Update(id, store => store.SetTicketAsync(id, ticketNumber));

    public override Task<JobActionResult> AddPaymentAsync(string id, string method, decimal amountUsd, string? ticketNumber,
        string? reference, string key, string actor) =>
        Update(id, store => store.AddPaymentAsync(id, method, amountUsd, ticketNumber, reference, key, actor));

    private Task<JobActionResult> Update(string id, Func<JobStore, Task<JobActionResult>> operation) =>
        database.RunAsync(true, async connection =>
        {
            var rows = await database.Jobs(connection, "AND id=$2", id);
            return await operation(new JobStore(rows, row => database.SaveJob(connection, row)));
        });
}
