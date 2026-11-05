using System.Text.Json;

namespace CarwashApi;

public sealed record StationSnapshot(string StationId, string Name, string Status, double PressurePsi, double SoapLevelDm, DateTimeOffset Timestamp);
public sealed record StationAlert(string StationId, string Code, double Value, double Threshold, string Severity);
public sealed record WashRecord(string Id, string StationId, string Category, decimal RevenueUsd, DateTimeOffset CompletedAt);
public sealed record TelemetryInput(string? Name, string? Status, double PressurePsi, double SoapLevelDm);
public sealed record WashInput(string? Category, decimal RevenueUsd);

public sealed class StationStore
{
    private sealed record Persisted(List<StationSnapshot> Stations, List<WashRecord> Washes);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private Persisted _data;

    public StationStore(string path)
    {
        _path = path;
        _data = File.Exists(path)
            ? JsonSerializer.Deserialize<Persisted>(File.ReadAllText(path), JsonOptions) ?? throw new InvalidDataException("Empty station data file")
            : new Persisted([], []);
    }

    public async Task<StationSnapshot[]> GetStationsAsync()
    {
        await _gate.WaitAsync();
        try { return _data.Stations.ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<WashRecord[]> GetWashesAsync()
    {
        await _gate.WaitAsync();
        try { return _data.Washes.OrderByDescending(x => x.CompletedAt).Take(1000).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<StationSnapshot> SaveTelemetryAsync(string id, TelemetryInput input)
    {
        await _gate.WaitAsync();
        try
        {
            var station = new StationSnapshot(id, input.Name!, input.Status!, input.PressurePsi, input.SoapLevelDm, DateTimeOffset.UtcNow);
            var stations = _data.Stations.Where(x => x.StationId != id).Append(station).OrderBy(x => x.StationId).ToList();
            await PersistAsync(new Persisted(stations, _data.Washes));
            return station;
        }
        finally { _gate.Release(); }
    }

    public async Task<WashRecord> AddWashAsync(string stationId, WashInput input)
    {
        await _gate.WaitAsync();
        try
        {
            var record = new WashRecord(Guid.NewGuid().ToString(), stationId, input.Category!, input.RevenueUsd, DateTimeOffset.UtcNow);
            var washes = _data.Washes.Append(record).TakeLast(1000).ToList();
            await PersistAsync(new Persisted(_data.Stations, washes));
            return record;
        }
        finally { _gate.Release(); }
    }

    private async Task PersistAsync(Persisted next)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(next, JsonOptions));
            File.Move(temp, _path, true);
            _data = next;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    public static StationAlert[] DeriveAlerts(IEnumerable<StationSnapshot> stations) => stations.SelectMany(station =>
    {
        var alerts = new List<StationAlert>();
        if (station.PressurePsi < 45) alerts.Add(new(station.StationId, "lowPressure", station.PressurePsi, 45, "warning"));
        if (station.PressurePsi > 60) alerts.Add(new(station.StationId, "highPressure", station.PressurePsi, 60, "danger"));
        if (station.SoapLevelDm < 35) alerts.Add(new(station.StationId, "lowSoapLevel", station.SoapLevelDm, 35, "danger"));
        return alerts;
    }).ToArray();
}
