using System.Text.Json;

namespace CarwashApi;

public sealed record JobTransition(string Status, DateTimeOffset At, string Actor, string IdempotencyKey);
public sealed record JobAssignment(string EmployeeId, string EmployeeName, DateTimeOffset AssignedAt, string IdempotencyKey);
public sealed record JobRecord(string Id, string ArrivalId, string Plate, string VehicleClass, string PackageId,
    string PackageName, string[] Services, decimal PriceUsd, string Currency, string Status,
    DateTimeOffset ArrivalAt, DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt, DateTimeOffset? CancelledAt,
    List<JobTransition> Transitions, List<JobAssignment> Assignments);
public sealed record JobView(string Id, string ArrivalId, string Plate, string VehicleClass, string PackageId,
    string PackageName, string[] Services, decimal PriceUsd, string Currency, string Status,
    DateTimeOffset ArrivalAt, DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt, DateTimeOffset? CancelledAt,
    long ElapsedSeconds, long? ActiveSeconds, List<JobTransition> Transitions, List<JobAssignment> Assignments);
public sealed record JobSummary(int Total, int Arrived, int Queued, int InProgress, int Completed, int Cancelled,
    int ArrivalsTodayUtc, int CompletedTodayUtc, long? AverageCompletedSeconds);
public sealed record JobTransitionInput(string? Status);
public sealed record OpenJobInput(string? ArrivalId, string? PackageId);
public sealed record AssignEmployeeInput(string? EmployeeId);
public enum JobActionStatus { Created, Duplicate, Conflict, NotFound, InvalidTransition }
public sealed record JobActionResult(JobActionStatus Status, JobView? Job);

public sealed class JobStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private List<JobRecord> _jobs;

    public JobStore(string path)
    {
        _path = path;
        _jobs = File.Exists(path) ? JsonSerializer.Deserialize<List<JobRecord>>(File.ReadAllText(path), JsonOptions) ?? [] : [];
    }

    public async Task<JobView[]> ListAsync()
    {
        await _gate.WaitAsync();
        try { var now = DateTimeOffset.UtcNow; return _jobs.OrderByDescending(x => x.ArrivalAt).Select(x => View(x, now)).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<JobView?> GetAsync(string id)
    {
        await _gate.WaitAsync();
        try { var job = _jobs.FirstOrDefault(x => x.Id == id); return job is null ? null : View(job, DateTimeOffset.UtcNow); }
        finally { _gate.Release(); }
    }

    public async Task<JobView?> FindOpenByPlateAsync(string plate)
    {
        await _gate.WaitAsync();
        try
        {
            var job = _jobs.LastOrDefault(x => x.Plate == plate && x.Status is not ("completed" or "cancelled"));
            return job is null ? null : View(job, DateTimeOffset.UtcNow);
        }
        finally { _gate.Release(); }
    }

    public async Task<JobSummary> SummaryAsync()
    {
        await _gate.WaitAsync();
        try
        {
            var today = DateTimeOffset.UtcNow.UtcDateTime.Date;
            var completed = _jobs.Where(x => x.Status == "completed").ToArray();
            return new JobSummary(_jobs.Count, _jobs.Count(x => x.Status == "arrived"), _jobs.Count(x => x.Status == "queued"),
                _jobs.Count(x => x.Status == "in_progress"), completed.Length, _jobs.Count(x => x.Status == "cancelled"),
                _jobs.Count(x => x.ArrivalAt.UtcDateTime.Date == today), completed.Count(x => x.CompletedAt!.Value.UtcDateTime.Date == today),
                completed.Length == 0 ? null : (long)Math.Round(completed.Average(x => (x.CompletedAt!.Value - x.ArrivalAt).TotalSeconds)));
        }
        finally { _gate.Release(); }
    }

    public async Task<JobActionResult> CreateAsync(ArrivalObservation arrival, ServicePackage package, string key, string actor)
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
                "arrived", arrival.ReceivedAt, null, null, null, [new JobTransition("arrived", now, actor, key)], []);
            await PersistAsync(_jobs.Append(job).TakeLast(10000).ToList());
            return new(JobActionStatus.Created, View(job, now));
        }
        finally { _gate.Release(); }
    }

    public async Task<JobActionResult> TransitionAsync(string id, string status, string key, string actor)
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
            await PersistAsync(next);
            return new(JobActionStatus.Created, View(nextJob, now));
        }
        finally { _gate.Release(); }
    }

    public async Task<JobActionResult> AssignAsync(string id, Employee employee, string key)
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
            await PersistAsync(next);
            return new(JobActionStatus.Created, View(nextJob, DateTimeOffset.UtcNow));
        }
        finally { _gate.Release(); }
    }

    private static JobView View(JobRecord job, DateTimeOffset now)
    {
        var end = job.CompletedAt ?? job.CancelledAt ?? now;
        return new JobView(job.Id, job.ArrivalId, job.Plate, job.VehicleClass, job.PackageId, job.PackageName,
            job.Services, job.PriceUsd, job.Currency, job.Status, job.ArrivalAt, job.StartedAt, job.CompletedAt,
            job.CancelledAt, Math.Max(0, (long)(end - job.ArrivalAt).TotalSeconds),
            job.StartedAt is null ? null : Math.Max(0, (long)(end - job.StartedAt.Value).TotalSeconds),
            job.Transitions, job.Assignments);
    }

    private async Task PersistAsync(List<JobRecord> next)
    {
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
