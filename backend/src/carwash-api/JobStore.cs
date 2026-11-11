using System.Text.Json;

namespace CarwashApi;

public sealed record JobTransition(string Status, DateTimeOffset At, string Actor, string IdempotencyKey);
public sealed record JobAssignment(string EmployeeId, string EmployeeName, DateTimeOffset AssignedAt, string IdempotencyKey);
public sealed record JobPayment(string Id, string Method, decimal AmountUsd, string? TicketNumber, string? Reference,
    DateTimeOffset RecordedAt, string Actor, string IdempotencyKey);
public sealed record JobRecord(string Id, string ArrivalId, string Plate, string VehicleClass, string PackageId,
    string PackageName, string[] Services, decimal PriceUsd, string Currency, string Status,
    DateTimeOffset ArrivalAt, DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt, DateTimeOffset? CancelledAt,
    List<JobTransition> Transitions, List<JobAssignment> Assignments,
    string? Source = null, string? TicketNumber = null, string? CustomerName = null, string? Note = null,
    List<JobPayment>? Payments = null, DateTimeOffset? PaidAt = null);
public sealed record JobView(string Id, string ArrivalId, string Plate, string VehicleClass, string PackageId,
    string PackageName, string[] Services, decimal PriceUsd, string Currency, string Status,
    DateTimeOffset ArrivalAt, DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt, DateTimeOffset? CancelledAt,
    long ElapsedSeconds, long? ActiveSeconds, List<JobTransition> Transitions, List<JobAssignment> Assignments,
    string? Source = null, string? TicketNumber = null, string? CustomerName = null, string? Note = null,
    List<JobPayment>? Payments = null, decimal PaidUsd = 0, string PaymentStatus = "unpaid", DateTimeOffset? PaidAt = null);
public sealed record JobSummary(int Total, int Arrived, int Queued, int InProgress, int Completed, int Cancelled,
    int ArrivalsTodayUtc, int CompletedTodayUtc, long? AverageCompletedSeconds,
    int ArrivalsToday = 0, int CompletedToday = 0);
public sealed record JobTransitionInput(string? Status);
public sealed record OpenJobInput(string? ArrivalId, string? PackageId);
public sealed record AssignEmployeeInput(string? EmployeeId);
public sealed record WalkInInput(string? Plate, string? VehicleClass, string? PackageId, string? EmployeeId,
    string? TicketNumber, string? CustomerName, string? Note, string? Source);
public sealed record TicketInput(string? TicketNumber);
public sealed record PaymentInput(string? Method, decimal? AmountUsd, string? TicketNumber, string? Reference);
/// <summary>Optional fields set when a job is opened (camera jobs leave them null).</summary>
public sealed record JobOpenDetails(string Source = "camera", string? TicketNumber = null, string? CustomerName = null, string? Note = null);
public enum JobActionStatus { Created, Duplicate, Conflict, NotFound, InvalidTransition }
public sealed record JobActionResult(JobActionStatus Status, JobView? Job);

public class JobStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private List<JobRecord> _jobs;

    private readonly Func<JobRecord, Task>? _saveRecord;

    protected JobStore() { _path = ""; _jobs = []; }

    internal JobStore(List<JobRecord> records, Func<JobRecord, Task>? saveRecord = null)
    {
        _path = "";
        _jobs = records;
        _saveRecord = saveRecord;
    }

    public JobStore(string path)
    {
        _path = path;
        _jobs = File.Exists(path) ? JsonSerializer.Deserialize<List<JobRecord>>(File.ReadAllText(path), JsonOptions) ?? [] : [];
    }

    public virtual async Task<JobView[]> ListAsync()
    {
        await _gate.WaitAsync();
        try { var now = DateTimeOffset.UtcNow; return _jobs.OrderByDescending(x => x.ArrivalAt).Select(x => View(x, now)).ToArray(); }
        finally { _gate.Release(); }
    }

    public virtual async Task<JobView?> GetAsync(string id)
    {
        await _gate.WaitAsync();
        try { var job = _jobs.FirstOrDefault(x => x.Id == id); return job is null ? null : View(job, DateTimeOffset.UtcNow); }
        finally { _gate.Release(); }
    }

    /// <summary>The plate's open job; with <paramref name="closedWithin"/>, also a job that finished that recently
    /// (an exit camera sees the car after staff already marked it done).</summary>
    public virtual async Task<JobView?> FindOpenByPlateAsync(string plate, TimeSpan? closedWithin = null)
    {
        await _gate.WaitAsync();
        try
        {
            var now = DateTimeOffset.UtcNow;
            var job = _jobs.LastOrDefault(x => x.Plate == plate && x.Status is not ("completed" or "cancelled")) ??
                (closedWithin is null ? null : _jobs.LastOrDefault(x => x.Plate == plate && x.Status == "completed" &&
                    now - x.CompletedAt!.Value <= closedWithin.Value));
            return job is null ? null : View(job, now);
        }
        finally { _gate.Release(); }
    }

    /// <summary>Totals plus "today" counts. Today is the carwash's local day (an El Salvador shop closing at
    /// 7 pm must not roll over to tomorrow at 6 pm UTC); the *Utc fields are kept for older clients.</summary>
    public virtual async Task<JobSummary> SummaryAsync(TimeZoneInfo? zone = null)
    {
        zone ??= TimeZoneInfo.Utc;
        await _gate.WaitAsync();
        try
        {
            var todayUtc = DateTimeOffset.UtcNow.UtcDateTime.Date;
            var today = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).Date;
            DateTime Local(DateTimeOffset at) => TimeZoneInfo.ConvertTime(at, zone).Date;
            var completed = _jobs.Where(x => x.Status == "completed").ToArray();
            return new JobSummary(_jobs.Count, _jobs.Count(x => x.Status == "arrived"), _jobs.Count(x => x.Status == "queued"),
                _jobs.Count(x => x.Status == "in_progress"), completed.Length, _jobs.Count(x => x.Status == "cancelled"),
                _jobs.Count(x => x.ArrivalAt.UtcDateTime.Date == todayUtc), completed.Count(x => x.CompletedAt!.Value.UtcDateTime.Date == todayUtc),
                completed.Length == 0 ? null : (long)Math.Round(completed.Average(x => (x.CompletedAt!.Value - x.ArrivalAt).TotalSeconds)),
                _jobs.Count(x => Local(x.ArrivalAt) == today), completed.Count(x => Local(x.CompletedAt!.Value) == today));
        }
        finally { _gate.Release(); }
    }

    public virtual async Task<JobActionResult> CreateAsync(ArrivalObservation arrival, ServicePackage package, string key, string actor, JobOpenDetails? details = null)
    {
        await _gate.WaitAsync();
        try
        {
            var sameKey = _jobs.FirstOrDefault(x => x.Transitions.Any(t => t.IdempotencyKey == key && t.Status == "arrived"));
            if (sameKey is not null)
                return new(sameKey.ArrivalId == arrival.Id && sameKey.PackageId == package.Id ? JobActionStatus.Duplicate : JobActionStatus.Conflict,
                    View(sameKey, DateTimeOffset.UtcNow));
            var existing = _jobs.FirstOrDefault(x => x.ArrivalId == arrival.Id ||
                (x.Plate == arrival.ConfirmedPlate && x.Status is not ("completed" or "cancelled")));
            if (existing is not null) return new(JobActionStatus.Conflict, View(existing, DateTimeOffset.UtcNow));
            var now = DateTimeOffset.UtcNow;
            var job = new JobRecord(Guid.NewGuid().ToString("N"), arrival.Id, arrival.ConfirmedPlate!, arrival.VehicleClass!, package.Id,
                package.Name, package.Items.ToArray(), package.Prices[arrival.VehicleClass!], PackageCatalog.Current.Currency,
                "arrived", arrival.ReceivedAt, null, null, null, [new JobTransition("arrived", now, actor, key)], [],
                details?.Source ?? "camera", details?.TicketNumber, details?.CustomerName, details?.Note, []);
            await PersistAsync(_jobs.Append(job).ToList(), job);
            return new(JobActionStatus.Created, View(job, now));
        }
        finally { _gate.Release(); }
    }

    public virtual async Task<JobActionResult> TransitionAsync(string id, string status, string key, string actor)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _jobs.FindIndex(x => x.Id == id);
            if (index < 0) return new(JobActionStatus.NotFound, null);
            var prior = _jobs[index];
            var previousKey = prior.Transitions.FirstOrDefault(x => x.IdempotencyKey == key);
            if (previousKey is not null)
                return new(previousKey.Status == status ? JobActionStatus.Duplicate : JobActionStatus.Conflict,
                    View(prior, DateTimeOffset.UtcNow));
            var allowed = status == "cancelled" && prior.Status is ("arrived" or "queued" or "in_progress") ||
                prior.Status == "arrived" && status == "queued" ||
                prior.Status == "queued" && status == "in_progress" ||
                prior.Status == "in_progress" && status == "completed";
            if (!allowed) return new(JobActionStatus.InvalidTransition, View(prior, DateTimeOffset.UtcNow));
            var now = DateTimeOffset.UtcNow;
            var nextJob = prior with
            {
                Status = status,
                StartedAt = status == "in_progress" ? now : prior.StartedAt,
                CompletedAt = status == "completed" ? now : prior.CompletedAt,
                CancelledAt = status == "cancelled" ? now : prior.CancelledAt,
                Transitions = prior.Transitions.Append(new JobTransition(status, now, actor, key)).ToList()
            };
            var next = _jobs.ToList();
            next[index] = nextJob;
            await PersistAsync(next, nextJob);
            return new(JobActionStatus.Created, View(nextJob, now));
        }
        finally { _gate.Release(); }
    }

    public virtual async Task<JobActionResult> AssignAsync(string id, Employee employee, string key)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _jobs.FindIndex(x => x.Id == id);
            if (index < 0) return new(JobActionStatus.NotFound, null);
            var prior = _jobs[index];
            var previousKey = prior.Assignments.FirstOrDefault(x => x.IdempotencyKey == key);
            if (previousKey is not null)
                return new(previousKey.EmployeeId == employee.Id ? JobActionStatus.Duplicate : JobActionStatus.Conflict,
                    View(prior, DateTimeOffset.UtcNow));
            if (prior.Status is "completed" or "cancelled" || prior.Assignments.Any(x => x.EmployeeId == employee.Id))
                return new(JobActionStatus.Conflict, View(prior, DateTimeOffset.UtcNow));
            var nextJob = prior with { Assignments = prior.Assignments.Append(
                new JobAssignment(employee.Id, employee.Name, DateTimeOffset.UtcNow, key)).ToList() };
            var next = _jobs.ToList();
            next[index] = nextJob;
            await PersistAsync(next, nextJob);
            return new(JobActionStatus.Created, View(nextJob, DateTimeOffset.UtcNow));
        }
        finally { _gate.Release(); }
    }

    /// <summary>Write-once work-ticket number: Created when set, Duplicate when identical, Conflict when different.</summary>
    public virtual async Task<JobActionResult> SetTicketAsync(string id, string ticketNumber)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _jobs.FindIndex(x => x.Id == id);
            if (index < 0) return new(JobActionStatus.NotFound, null);
            var prior = _jobs[index];
            if (prior.TicketNumber is not null)
                return new(prior.TicketNumber == ticketNumber ? JobActionStatus.Duplicate : JobActionStatus.Conflict,
                    View(prior, DateTimeOffset.UtcNow));
            var nextJob = prior with { TicketNumber = ticketNumber };
            var next = _jobs.ToList();
            next[index] = nextJob;
            await PersistAsync(next, nextJob);
            return new(JobActionStatus.Created, View(nextJob, DateTimeOffset.UtcNow));
        }
        finally { _gate.Release(); }
    }

    /// <summary>Records a payment. Same key and body replays (Duplicate); a reused key with a different body, or a
    /// cancelled job, is a Conflict.</summary>
    public virtual async Task<JobActionResult> AddPaymentAsync(string id, string method, decimal amountUsd, string? ticketNumber,
        string? reference, string key, string actor)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _jobs.FindIndex(x => x.Id == id);
            if (index < 0) return new(JobActionStatus.NotFound, null);
            var prior = _jobs[index];
            var previous = (prior.Payments ?? []).FirstOrDefault(x => x.IdempotencyKey == key);
            if (previous is not null)
                return new(previous.Method == method && previous.AmountUsd == amountUsd && previous.TicketNumber == ticketNumber &&
                    previous.Reference == reference ? JobActionStatus.Duplicate : JobActionStatus.Conflict,
                    View(prior, DateTimeOffset.UtcNow));
            if (prior.Status == "cancelled") return new(JobActionStatus.Conflict, View(prior, DateTimeOffset.UtcNow));
            var now = DateTimeOffset.UtcNow;
            var payments = (prior.Payments ?? []).Append(new JobPayment(Guid.NewGuid().ToString("N"), method, amountUsd,
                ticketNumber, reference, now, actor, key)).ToList();
            var nextJob = prior with
            {
                Payments = payments,
                PaidAt = prior.PaidAt ?? (payments.Sum(x => x.AmountUsd) >= prior.PriceUsd ? now : null)
            };
            var next = _jobs.ToList();
            next[index] = nextJob;
            await PersistAsync(next, nextJob);
            return new(JobActionStatus.Created, View(nextJob, now));
        }
        finally { _gate.Release(); }
    }

    private static JobView View(JobRecord job, DateTimeOffset now)
    {
        var end = job.CompletedAt ?? job.CancelledAt ?? now;
        var payments = (job.Payments ?? []).ToList();
        var paid = payments.Sum(x => x.AmountUsd);
        return new JobView(job.Id, job.ArrivalId, job.Plate, job.VehicleClass, job.PackageId, job.PackageName,
            job.Services, job.PriceUsd, job.Currency, job.Status, job.ArrivalAt, job.StartedAt, job.CompletedAt,
            job.CancelledAt, Math.Max(0, (long)(end - job.ArrivalAt).TotalSeconds),
            job.StartedAt is null ? null : Math.Max(0, (long)(end - job.StartedAt.Value).TotalSeconds),
            job.Transitions, job.Assignments, job.Source, job.TicketNumber, job.CustomerName, job.Note, payments, paid,
            paid >= job.PriceUsd ? "paid" : paid > 0 ? "partial" : "unpaid", job.PaidAt);
    }

    private async Task PersistAsync(List<JobRecord> next, JobRecord changed)
    {
        if (_saveRecord is not null)
        {
            await _saveRecord(changed);
            _jobs = next;
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(next, JsonOptions));
            File.Move(temp, _path, true);
            _jobs = next;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
