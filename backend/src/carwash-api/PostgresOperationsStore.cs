using System.Text.Json;
using Npgsql;

namespace CarwashApi;

internal sealed class PostgresOperationsStore(PostgresWorkflowDatabase database) : OperationsStore
{
    private static readonly JsonSerializerOptions RowJson = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    public override Task<Employee[]> EmployeesAsync() => database.RunAsync(false, async connection =>
        (await Rows<Employee>(connection, "employees", "ORDER BY created_at,id")).ToArray());

    public override Task<Employee?> AddEmployeeAsync(string name) =>
        WithEmployees(store => store.AddEmployeeAsync(name));

    public override Task<Employee?> SetEmployeeActiveAsync(string id, bool active) =>
        WithEmployees(store => store.SetEmployeeActiveAsync(id, active));

    public override Task<InventoryItem?> AddItemAsync(InventoryItemInput input) =>
        database.RunAsync(true, async connection =>
        {
            var items = await Rows<InventoryItem>(connection, "items", "AND sku=$2", input.Sku!.Trim().ToUpperInvariant());
            return await Core(connection, new([], items, [], [])).AddItemAsync(input);
        });

    public override Task<InventoryView[]> ItemsAsync() => database.RunAsync(false, async connection =>
    {
        await using var command = database.Query(connection, """
            SELECT to_jsonb(i), COALESCE(m.on_hand,0), COALESCE(r.reserved,0)
            FROM sparklewash.items i
            LEFT JOIN (SELECT item_id,sum(delta) on_hand FROM sparklewash.movements WHERE tenant_id=$1 GROUP BY item_id) m
                ON m.item_id=i.id
            LEFT JOIN (SELECT item_id,sum(remaining) reserved FROM sparklewash.reservations WHERE tenant_id=$1 GROUP BY item_id) r
                ON r.item_id=i.id
            WHERE i.tenant_id=$1 ORDER BY i.created_at,i.id
            """);
        await using var reader = await command.ExecuteReaderAsync();
        var items = new List<InventoryView>();
        while (await reader.ReadAsync())
        {
            var item = JsonSerializer.Deserialize<InventoryItem>(reader.GetString(0), RowJson)!;
            var onHand = reader.GetDecimal(1);
            var reserved = reader.GetDecimal(2);
            items.Add(new(item, onHand, reserved, onHand - reserved, onHand <= item.ReorderPoint));
        }
        return items.ToArray();
    });

    public override Task<StockMovement[]> MovementsAsync(string? itemId = null, string? jobId = null) =>
        database.RunAsync(false, async connection =>
            (await Rows<StockMovement>(connection, "movements",
                "AND ($2='' OR item_id=$2) AND ($3='' OR job_id=$3) ORDER BY at DESC,id",
                itemId ?? "", jobId ?? "")).ToArray());

    public override Task<StockMovement?> MovementByKeyAsync(string key) => database.RunAsync(false, async connection =>
        (await Rows<StockMovement>(connection, "movements", "AND operation_key=$2", key)).SingleOrDefault());

    public override Task<StockReservation?> ReservationByKeyAsync(string key) => database.RunAsync(false, async connection =>
        (await Rows<StockReservation>(connection, "reservations", "AND operation_key=$2", key)).SingleOrDefault());

    public override Task<StockActionResult<StockMovement>> MoveAsync(string itemId, StockMovementInput input, string key, string actor) =>
        database.RunAsync(true, async connection =>
        {
            var movements = await Rows<StockMovement>(connection, "movements",
                "AND (item_id=$2 OR operation_key=$3) ORDER BY at,id", itemId, key);
            if (input.Type == "consume" && !movements.Any(row => row.OperationKey == key))
            {
                var job = input.JobId is null ? null : (await database.Jobs(connection, "AND id=$2", input.JobId)).SingleOrDefault();
                if (job?.Status != "in_progress" || !job.Assignments.Any(row => row.EmployeeId == input.EmployeeId))
                    return new StockActionResult<StockMovement>(StockActionStatus.Conflict, null);
            }
            var items = await Rows<InventoryItem>(connection, "items", "AND id=$2", itemId);
            var reservations = await Rows<StockReservation>(connection, "reservations", "AND item_id=$2 ORDER BY at,id", itemId);
            return await Core(connection, new([], items, movements, reservations)).MoveAsync(itemId, input, key, actor);
        });

    public override Task<StockActionResult<StockReservation>> ReserveAsync(string itemId, string jobId, decimal quantity, string key, string actor) =>
        database.RunAsync(true, async connection =>
        {
            var reservations = await Rows<StockReservation>(connection, "reservations",
                "AND (item_id=$2 OR operation_key=$3) ORDER BY at,id", itemId, key);
            if (!reservations.Any(row => row.OperationKey == key))
            {
                var job = (await database.Jobs(connection, "AND id=$2", jobId)).SingleOrDefault();
                if (job?.Status is not ("arrived" or "queued" or "in_progress"))
                    return new StockActionResult<StockReservation>(StockActionStatus.Conflict, null);
            }
            var items = await Rows<InventoryItem>(connection, "items", "AND id=$2", itemId);
            var movements = await Rows<StockMovement>(connection, "movements", "AND item_id=$2", itemId);
            return await Core(connection, new([], items, movements, reservations)).ReserveAsync(itemId, jobId, quantity, key, actor);
        });

    public override async Task ReleaseJobAsync(string jobId) =>
        await database.RunAsync(true, async connection => { await ReleaseAsync(database, connection, jobId); return true; });

    internal static async Task ReleaseAsync(PostgresWorkflowDatabase database, NpgsqlConnection connection, string jobId)
    {
        await using var command = database.Query(connection,
            "UPDATE sparklewash.reservations SET remaining=0 WHERE tenant_id=$1 AND job_id=$2 AND remaining>0", jobId);
        await command.ExecuteNonQueryAsync();
    }

    private Task<Employee?> WithEmployees(Func<OperationsStore, Task<Employee?>> operation) =>
        database.RunAsync(true, async connection =>
            await operation(Core(connection, new(await Rows<Employee>(connection, "employees", ""), [], [], []))));

    private OperationsStore Core(NpgsqlConnection connection, Persisted records) =>
        new(records, async (previous, next) =>
        {
            await SaveChanges(connection, "employees", "DO UPDATE SET active=excluded.active", previous.Employees, next.Employees, row => row.Id);
            await SaveChanges(connection, "items", "", previous.Items, next.Items, row => row.Id);
            await SaveChanges(connection, "movements", "", previous.Movements, next.Movements, row => row.Id);
            await SaveChanges(connection, "reservations", "DO UPDATE SET remaining=excluded.remaining",
                previous.Reservations, next.Reservations, row => row.Id);
        });

    private async Task SaveChanges<T>(NpgsqlConnection connection, string table, string onConflict,
        List<T> previous, List<T> next, Func<T, string> id)
    {
        if (ReferenceEquals(previous, next)) return;
        var old = previous.ToDictionary(id);
        var sql = $"INSERT INTO sparklewash.{table} SELECT * FROM jsonb_populate_record(NULL::sparklewash.{table}, $1)";
        if (onConflict.Length > 0) sql += " ON CONFLICT (tenant_id,id) " + onConflict;
        foreach (var row in next)
            if (!old.TryGetValue(id(row), out var prior) || !EqualityComparer<T>.Default.Equals(row, prior))
                await database.Save(connection, sql, row);
    }

    private async Task<List<T>> Rows<T>(NpgsqlConnection connection, string table, string filter, params object[] values)
    {
        await using var command = database.Query(connection,
            $"SELECT to_jsonb(r) FROM sparklewash.{table} r WHERE tenant_id=$1 {filter}", values);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<T>();
        while (await reader.ReadAsync()) rows.Add(JsonSerializer.Deserialize<T>(reader.GetString(0), RowJson)!);
        return rows;
    }
}
