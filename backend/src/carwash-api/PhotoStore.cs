using System.Text.Json;

namespace CarwashApi;

public sealed record PhotoRecord(string Id, string StationId, DateTimeOffset UploadedAt, int SizeBytes);

public sealed class PhotoStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _directory;
    private readonly int _maxCount;
    public int MaxCount => _maxCount;
    private readonly TimeSpan _maxAge = TimeSpan.FromDays(30);
    private const long MaxStoredBytes = 50L * 1024 * 1024;

    public PhotoStore(string directory, int maxCount = 1000)
    {
        _directory = directory;
        _maxCount = Math.Clamp(maxCount, 1, 1000);
        Directory.CreateDirectory(directory);
    }

    public async Task<PhotoRecord[]> SaveAsync(string stationId, IReadOnlyList<byte[]> photos)
    {
        await _gate.WaitAsync();
        try
        {
            await PruneAsync();
            var saved = new List<PhotoRecord>();
            try
            {
                foreach (var bytes in photos)
                {
                    var record = new PhotoRecord(Guid.NewGuid().ToString("N"), stationId, DateTimeOffset.UtcNow, bytes.Length);
                    saved.Add(record);
                    await File.WriteAllBytesAsync(ImagePath(record.Id), bytes);
                    await File.WriteAllTextAsync(MetadataPath(record.Id), JsonSerializer.Serialize(record, JsonOptions));
                }
                await PruneAsync();
                return saved.ToArray();
            }
            catch
            {
                foreach (var record in saved) Delete(record.Id);
                throw;
            }
        }
        finally { _gate.Release(); }
    }

    public async Task<PhotoRecord[]> ListAsync(string stationId)
    {
        await _gate.WaitAsync();
        try { await PruneAsync(); return ReadMetadata().Where(x => x.StationId == stationId).OrderByDescending(x => x.UploadedAt).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<byte[]?> GetAsync(string id)
    {
        if (id.Length != 32 || !id.All(Uri.IsHexDigit)) return null;
        await _gate.WaitAsync();
        try
        {
            await PruneAsync();
            return File.Exists(MetadataPath(id)) && File.Exists(ImagePath(id)) ? await File.ReadAllBytesAsync(ImagePath(id)) : null;
        }
        finally { _gate.Release(); }
    }

    private IEnumerable<PhotoRecord> ReadMetadata()
    {
        foreach (var path in Directory.EnumerateFiles(_directory, "*.json"))
        {
            PhotoRecord? record = null;
            try { record = JsonSerializer.Deserialize<PhotoRecord>(File.ReadAllText(path), JsonOptions); }
            catch (JsonException) { }
            if (record is not null && record.Id.Length == 32 && record.Id.All(Uri.IsHexDigit) && File.Exists(ImagePath(record.Id)))
                yield return record with { SizeBytes = (int)new FileInfo(ImagePath(record.Id)).Length };
        }
    }

    private Task PruneAsync()
    {
        var records = ReadMetadata().OrderBy(x => x.UploadedAt).ToList();
        var validIds = records.Select(x => x.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var imagePath in Directory.EnumerateFiles(_directory, "*.jpg"))
            if (!validIds.Contains(Path.GetFileNameWithoutExtension(imagePath))) File.Delete(imagePath);
        foreach (var metadataPath in Directory.EnumerateFiles(_directory, "*.json"))
            if (!validIds.Contains(Path.GetFileNameWithoutExtension(metadataPath))) File.Delete(metadataPath);
        var totalBytes = records.Sum(x => (long)x.SizeBytes);
        var cutoff = DateTimeOffset.UtcNow - _maxAge;
        foreach (var record in records.ToArray())
        {
            if (record.UploadedAt >= cutoff) continue;
            Delete(record.Id);
            records.Remove(record);
            totalBytes -= record.SizeBytes;
        }
        while (records.Count > _maxCount || totalBytes > MaxStoredBytes)
        {
            var oldest = records[0];
            Delete(oldest.Id);
            records.RemoveAt(0);
            totalBytes -= oldest.SizeBytes;
        }
        return Task.CompletedTask;
    }

    private void Delete(string id)
    {
        File.Delete(ImagePath(id));
        File.Delete(MetadataPath(id));
    }
    private string ImagePath(string id) => Path.Combine(_directory, id + ".jpg");
    private string MetadataPath(string id) => Path.Combine(_directory, id + ".json");

    // Validate segment boundaries and the required SOF/SOS/EOI sequence before storage.
    public static bool IsJpeg(ReadOnlySpan<byte> data)
    {
        if (data.Length < 8 || data[0] != 0xff || data[1] != 0xd8) return false;
        var offset = 2;
        var frame = false;
        var scan = false;
        while (offset < data.Length)
        {
            if (data[offset++] != 0xff) return false;
            while (offset < data.Length && data[offset] == 0xff) offset++;
            if (offset >= data.Length) return false;
            var marker = data[offset++];
            if (marker == 0xd9) return frame && scan && offset == data.Length;
            if (marker is 0xd8 or 0x00) return false;
            if (marker is >= 0xd0 and <= 0xd7) continue;
            if (offset + 2 > data.Length) return false;
            var length = (data[offset] << 8) | data[offset + 1];
            if (length < 2 || offset + length > data.Length) return false;
            if (marker is >= 0xc0 and <= 0xcf && marker is not (0xc4 or 0xc8 or 0xcc)) frame = true;
            offset += length;
            if (marker != 0xda) continue;
            scan = true;
            while (offset + 1 < data.Length)
            {
                if (data[offset] != 0xff) { offset++; continue; }
                var next = data[offset + 1];
                if (next == 0x00 || next is >= 0xd0 and <= 0xd7) { offset += 2; continue; }
                break;
            }
        }
        return false;
    }
}
