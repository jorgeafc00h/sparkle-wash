using System.Text.Json;

namespace CarwashApi;

public sealed record PaymentPosConfig(string? Provider, string? DeviceName, string? TerminalId,
    string? MerchantId, string? Currency, bool CardPresentRequired, bool CardNonPresentPermitted, DateTimeOffset UpdatedAt);
public sealed record PaymentPosConfigInput(string? Provider, string? DeviceName, string? TerminalId,
    string? MerchantId, string? Currency, bool? CardPresentRequired, bool? CardNonPresentPermitted);

// A POS payment reference: a thin server-side trace for the POS device's own transaction ref
// (no card data, no amount — the POS device's ref is the evidence; the job's PriceUsd is the pricing record).
public sealed record PaymentPosRecord(string Id, string JobId, string Provider, string ProviderRef,
    string? OrderRef, string? EmployeeId, string Note, DateTimeOffset RecordedAt, string Actor);

public sealed class PaymentPosStore
{
    private sealed record Persisted(PaymentPosConfig? Config, List<PaymentPosRecord> Records);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private Persisted _data;

    public PaymentPosStore(string path)
    {
        _path = path;
        _data = File.Exists(path)
            ? JsonSerializer.Deserialize<Persisted>(File.ReadAllText(path), JsonOptions) ?? new Persisted(null, [])
            : new Persisted(null, []);
    }

    public async Task<PaymentPosConfig?> GetConfigAsync()
    {
        await _gate.WaitAsync();
        try { return _data.Config; }
        finally { _gate.Release(); }
    }

    /// <summary>Create or replace the whole POS device config. Partial updates are a caller concern.</summary>
    public async Task<PaymentPosConfig> UpsertConfigAsync(PaymentPosConfigInput input)
    {
        await _gate.WaitAsync();
        try
        {
            var next = new PaymentPosConfig(
                input.Provider, input.DeviceName, input.TerminalId, input.MerchantId, input.Currency,
                input.CardPresentRequired ?? false, input.CardNonPresentPermitted ?? false, DateTimeOffset.UtcNow);
            await PersistAsync(new Persisted(next, _data.Records));
            return next;
        }
        finally { _gate.Release(); }
    }

    /// <summary>Idempotent by (job, provider, provider-ref): a POS device replaying the same ref returns the original record.</summary>
    public async Task<(PaymentPosRecord Record, bool Duplicate)> AddAsync(PaymentPosRecord record)
    {
        await _gate.WaitAsync();
        try
        {
            var replay = _data.Records.FirstOrDefault(x => x.JobId == record.JobId
                && x.Provider == record.Provider && x.ProviderRef == record.ProviderRef);
            if (replay is not null) return (replay, true);
            var next = new Persisted(_data.Config, _data.Records.Append(record).ToList());
            await PersistAsync(next);
            return (record, false);
        }
        finally { _gate.Release(); }
    }

    public async Task<List<PaymentPosRecord>> ListForJobAsync(string jobId)
    {
        await _gate.WaitAsync();
        try { return _data.Records.Where(r => r.JobId == jobId).OrderBy(r => r.RecordedAt).ToList(); }
        finally { _gate.Release(); }
    }

    public async Task<List<PaymentPosRecord>> ListAllAsync()
    {
        await _gate.WaitAsync();
        try { return _data.Records.OrderBy(r => r.RecordedAt).ToList(); }
        finally { _gate.Release(); }
    }

    /// <summary>Look up by either the POS device's provider ref or an optional POS order ref.</summary>
    public async Task<PaymentPosRecord?> GetByRefAsync(string reference)
    {
        await _gate.WaitAsync();
        try { return _data.Records.FirstOrDefault(r => r.ProviderRef == reference || r.OrderRef == reference); }
        finally { _gate.Release(); }
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
        finally { if (!File.Exists(temp)) { } else File.Delete(temp); }
    }
}
