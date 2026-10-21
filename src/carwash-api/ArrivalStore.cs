using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CarwashApi;

public sealed record ArrivalInput(string? DeviceEventId, string? CameraId, string? PlateCandidate,
    double? Confidence, DateTimeOffset CapturedAt, string? PhotoBase64);
public sealed record ConfirmArrivalInput(string? Plate, string? VehicleClass);
public sealed record ArrivalObservation(string Id, string DeviceEventId, string CameraId, string? PlateCandidate,
    double? Confidence, DateTimeOffset CapturedAt, DateTimeOffset ReceivedAt, string? PhotoId,
    string EvidenceDigest, string? ConfirmedPlate, string? VehicleClass, string? ConfirmedBy, DateTimeOffset? ConfirmedAt,
    string? JobId = null, string? CameraRole = null);
public enum ArrivalAddStatus { Created, Duplicate, Conflict }
public sealed record ArrivalAddResult(ArrivalAddStatus Status, ArrivalObservation Observation);
public enum ArrivalConfirmStatus { Confirmed, Duplicate, Conflict, NotFound }
public sealed record ArrivalConfirmResult(ArrivalConfirmStatus Status, ArrivalObservation? Observation);

public sealed class ArrivalStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _path;
    private List<ArrivalObservation> _arrivals;

    public ArrivalStore(string path)
    {
        _path = path;
        _arrivals = File.Exists(path)
            ? JsonSerializer.Deserialize<List<ArrivalObservation>>(File.ReadAllText(path), JsonOptions) ?? [] : [];
    }

    public static string? NormalizePlate(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return null;
        var normalized = new string(candidate.ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).ToArray());
        return normalized.Length is >= 3 and <= 12 ? normalized : null;
    }

    public static bool ValidInput(ArrivalInput? input)
    {
        if (input is null || !ValidToken(input.DeviceEventId, 128) || !ValidToken(input.CameraId, 64)) return false;
        if (input.PlateCandidate is not null && NormalizePlate(input.PlateCandidate) is null) return false;
        if (input.Confidence is not null && (!double.IsFinite(input.Confidence.Value) || input.Confidence is < 0 or > 1)) return false;
        if (input.CapturedAt < DateTimeOffset.UtcNow.AddDays(-2) || input.CapturedAt > DateTimeOffset.UtcNow.AddMinutes(5)) return false;
        return input.PlateCandidate is not null || input.PhotoBase64 is not null;
    }

    private static bool ValidToken(string? value, int max) => value is not null && value.Length >= 1 && value.Length <= max &&
        value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    public async Task<ArrivalObservation[]> ListAsync()
    {
        await _gate.WaitAsync();
        try { return _arrivals.OrderByDescending(x => x.ReceivedAt).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<ArrivalAddResult> AddAsync(ArrivalInput input, byte[]? photo, PhotoStore photos, string cameraRole = "entry")
    {
        var plate = NormalizePlate(input.PlateCandidate);
        var digestInput = $"{input.CameraId}|{input.DeviceEventId}|{plate}|{input.Confidence}|{input.CapturedAt.ToUnixTimeMilliseconds()}|" +
            (photo is null ? "" : Convert.ToHexString(SHA256.HashData(photo)));
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(digestInput)));
        await _gate.WaitAsync();
        try
        {
            var prior = _arrivals.FirstOrDefault(x => x.CameraId == input.CameraId && x.DeviceEventId == input.DeviceEventId);
            if (prior is not null) return new(prior.EvidenceDigest == digest ? ArrivalAddStatus.Duplicate : ArrivalAddStatus.Conflict, prior);
            string? photoId = null;
            if (photo is not null) photoId = (await photos.SaveAsync(input.CameraId!, [photo]))[0].Id;
            var observation = new ArrivalObservation(Guid.NewGuid().ToString("N"), input.DeviceEventId!, input.CameraId!, plate,
                input.Confidence, input.CapturedAt, DateTimeOffset.UtcNow, photoId, digest, null, null, null, null, null, cameraRole);
            var next = _arrivals.Append(observation).TakeLast(10000).ToList();
            await PersistAsync(next);
            return new(ArrivalAddStatus.Created, observation);
        }
        finally { _gate.Release(); }
    }

    public async Task<ArrivalConfirmResult> ConfirmAsync(string id, string plate, string vehicleClass, string subject)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _arrivals.FindIndex(x => x.Id == id);
            if (index < 0) return new(ArrivalConfirmStatus.NotFound, null);
            var prior = _arrivals[index];
            if (prior.ConfirmedAt is not null)
                return new(prior.ConfirmedPlate == plate && prior.VehicleClass == vehicleClass
                    ? ArrivalConfirmStatus.Duplicate : ArrivalConfirmStatus.Conflict, prior);
            var confirmed = prior with { ConfirmedPlate = plate, VehicleClass = vehicleClass,
                ConfirmedBy = subject, ConfirmedAt = DateTimeOffset.UtcNow };
            var next = _arrivals.ToList();
            next[index] = confirmed;
            await PersistAsync(next);
            return new(ArrivalConfirmStatus.Confirmed, confirmed);
        }
        finally { _gate.Release(); }
    }

    // Ties a camera sighting to the job it belongs to, so it leaves the staff review queue and joins the plate timeline.
    public async Task<ArrivalObservation?> LinkJobAsync(string id, string jobId)
    {
        await _gate.WaitAsync();
        try
        {
            var index = _arrivals.FindIndex(x => x.Id == id);
            if (index < 0) return null;
            if (_arrivals[index].JobId is not null) return _arrivals[index];
            var next = _arrivals.ToList();
            next[index] = next[index] with { JobId = jobId };
            await PersistAsync(next);
            return next[index];
        }
        finally { _gate.Release(); }
    }

    private async Task PersistAsync(List<ArrivalObservation> next)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(_path))!);
        var temp = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(next, JsonOptions));
            File.Move(temp, _path, true);
            _arrivals = next;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
