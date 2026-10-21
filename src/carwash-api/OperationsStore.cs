using System.Text.Json;

namespace CarwashApi;

public sealed record Employee(string Id, string Name, bool Active, DateTimeOffset CreatedAt);
public sealed record EmployeeInput(string? Name);
public sealed record EmployeeStatusInput(bool Active);
public sealed record InventoryItem(string Id, string Sku, string Name, string Unit, decimal ReorderPoint, bool Active, DateTimeOffset CreatedAt);
public sealed record InventoryItemInput(string? Sku, string? Name, string? Unit, decimal ReorderPoint);
public sealed record StockMovement(string Id, string ItemId, string Type, decimal Delta, string Reason,
    string? JobId, string? EmployeeId, string OperationKey, DateTimeOffset At, string Actor);
public sealed record StockMovementInput(string? Type, decimal Quantity, string? Reason, string? JobId, string? EmployeeId);
public sealed record StockReservation(string Id, string ItemId, string JobId, decimal Quantity, decimal Remaining,
    string OperationKey, DateTimeOffset At, string Actor);
public sealed record StockReservationInput(string? JobId, decimal Quantity);
public sealed record InventoryView(InventoryItem Item, decimal OnHand, decimal Reserved, decimal Available,
    bool NeedsReorder);
public enum StockActionStatus { Created, Duplicate, Conflict, NotFound, Insufficient }
public sealed record StockActionResult<T>(StockActionStatus Status, T? Value);

public sealed class OperationsStore
{
    private sealed record Persisted(List<Employee> Employees, List<InventoryItem> Items,
        List<StockMovement> Movements, List<StockReservation> Reservations);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private Persisted _data;

    public OperationsStore(string path)
    {
        _path = path;
        _data = File.Exists(path) ? JsonSerializer.Deserialize<Persisted>(File.ReadAllText(path), JsonOptions)
            ?? throw new InvalidDataException("Empty operations data file") : new Persisted([], [], [], []);
    }

    public async Task<Employee[]> EmployeesAsync()
    {
        await _gate.WaitAsync();
        try { return _data.Employees.ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<Employee?> AddEmployeeAsync(string name)
    {
        await _gate.WaitAsync();
        try
        {
            if (_data.Employees.Any(x => x.Active && x.Name.Equals(name, StringComparison.OrdinalIgnoreCase))) return null;
            var employee = new Employee(Guid.NewGuid().ToString("N"), name, true, DateTimeOffset.UtcNow);
            await PersistAsync(_data with { Employees = _data.Employees.Append(employee).ToList() });
            return employee;
        }
        finally { _gate.Release(); }
    }

    public async Task<Employee?> SetEmployeeActiveAsync(string id, bool active)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _data.Employees.FindIndex(x => x.Id == id);
            if (index < 0) return null;
            var employee = _data.Employees[index] with { Active = active };
            var next = _data.Employees.ToList();
            next[index] = employee;
            await PersistAsync(_data with { Employees = next });
            return employee;
        }
        finally { _gate.Release(); }
    }

    public async Task<InventoryView[]> ItemsAsync()
    {
        await _gate.WaitAsync();
        try { return _data.Items.Select(View).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<InventoryItem?> AddItemAsync(InventoryItemInput input)
    {
        await _gate.WaitAsync();
        try
        {
            var sku = input.Sku!.Trim().ToUpperInvariant();
            if (_data.Items.Any(x => x.Sku == sku)) return null;
            var item = new InventoryItem(Guid.NewGuid().ToString("N"), sku, input.Name!.Trim(), input.Unit!,
                input.ReorderPoint, true, DateTimeOffset.UtcNow);
            await PersistAsync(_data with { Items = _data.Items.Append(item).ToList() });
            return item;
        }
        finally { _gate.Release(); }
    }

    public async Task<StockMovement[]> MovementsAsync(string? itemId = null, string? jobId = null)
    {
        await _gate.WaitAsync();
        try { return _data.Movements.Where(x => (itemId is null || x.ItemId == itemId) &&
            (jobId is null || x.JobId == jobId)).OrderByDescending(x => x.At).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<StockMovement?> MovementByKeyAsync(string key)
    {
        await _gate.WaitAsync();
        try { return _data.Movements.FirstOrDefault(x => x.OperationKey == key); }
        finally { _gate.Release(); }
    }

    public async Task<StockReservation?> ReservationByKeyAsync(string key)
    {
        await _gate.WaitAsync();
        try { return _data.Reservations.FirstOrDefault(x => x.OperationKey == key); }
        finally { _gate.Release(); }
    }

    public async Task<StockActionResult<StockMovement>> MoveAsync(string itemId, StockMovementInput input, string key, string actor)
    {
        await _gate.WaitAsync();
        try
        {
            var prior = _data.Movements.FirstOrDefault(x => x.OperationKey == key);
            var delta = input.Type == "adjustment" ? input.Quantity : input.Type == "receipt" ? input.Quantity : -input.Quantity;
            if (prior is not null)
                return new(prior.ItemId == itemId && prior.Type == input.Type && prior.Delta == delta &&
                    prior.JobId == input.JobId && prior.EmployeeId == input.EmployeeId && prior.Reason == input.Reason
                    ? StockActionStatus.Duplicate : StockActionStatus.Conflict, prior);
            var item = _data.Items.FirstOrDefault(x => x.Id == itemId && x.Active);
            if (item is null) return new(StockActionStatus.NotFound, null);
            var view = View(item);
            var ownReservation = input.JobId is null ? 0 : _data.Reservations.Where(x => x.ItemId == itemId && x.JobId == input.JobId).Sum(x => x.Remaining);
            if (view.OnHand + delta < 0 || view.Available + Math.Min(ownReservation, input.Type == "consume" ? input.Quantity : 0) + delta < 0)
                return new(StockActionStatus.Insufficient, null);
            var movement = new StockMovement(Guid.NewGuid().ToString("N"), itemId, input.Type!, delta, input.Reason!,
                input.JobId, input.EmployeeId, key, DateTimeOffset.UtcNow, actor);
            var reservations = _data.Reservations.ToList();
            if (input.Type == "consume" && ownReservation > 0)
            {
                var remainingToRelease = Math.Min(ownReservation, input.Quantity);
                for (var i = 0; i < reservations.Count && remainingToRelease > 0; i++)
                {
                    var reservation = reservations[i];
                    if (reservation.ItemId != itemId || reservation.JobId != input.JobId || reservation.Remaining <= 0) continue;
                    var amount = Math.Min(reservation.Remaining, remainingToRelease);
                    reservations[i] = reservation with { Remaining = reservation.Remaining - amount };
                    remainingToRelease -= amount;
                }
            }
            await PersistAsync(_data with { Movements = _data.Movements.Append(movement).ToList(), Reservations = reservations });
            return new(StockActionStatus.Created, movement);
        }
        finally { _gate.Release(); }
    }

    public async Task<StockActionResult<StockReservation>> ReserveAsync(string itemId, string jobId, decimal quantity, string key, string actor)
    {
        await _gate.WaitAsync();
        try
        {
            var prior = _data.Reservations.FirstOrDefault(x => x.OperationKey == key);
            if (prior is not null)
                return new(prior.ItemId == itemId && prior.JobId == jobId && prior.Quantity == quantity
                    ? StockActionStatus.Duplicate : StockActionStatus.Conflict, prior);
            var item = _data.Items.FirstOrDefault(x => x.Id == itemId && x.Active);
            if (item is null) return new(StockActionStatus.NotFound, null);
            if (View(item).Available < quantity) return new(StockActionStatus.Insufficient, null);
            var reservation = new StockReservation(Guid.NewGuid().ToString("N"), itemId, jobId, quantity, quantity,
                key, DateTimeOffset.UtcNow, actor);
            await PersistAsync(_data with { Reservations = _data.Reservations.Append(reservation).ToList() });
            return new(StockActionStatus.Created, reservation);
        }
        finally { _gate.Release(); }
    }

    public async Task ReleaseJobAsync(string jobId)
    {
        await _gate.WaitAsync();
        try
        {
            var next = _data.Reservations.Select(x => x.JobId == jobId ? x with { Remaining = 0 } : x).ToList();
            if (next.Zip(_data.Reservations).All(pair => pair.First.Remaining == pair.Second.Remaining)) return;
            await PersistAsync(_data with { Reservations = next });
        }
        finally { _gate.Release(); }
    }

    private InventoryView View(InventoryItem item)
    {
        var onHand = _data.Movements.Where(x => x.ItemId == item.Id).Sum(x => x.Delta);
        var reserved = _data.Reservations.Where(x => x.ItemId == item.Id).Sum(x => x.Remaining);
        return new InventoryView(item, onHand, reserved, onHand - reserved, onHand <= item.ReorderPoint);
    }

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
}
