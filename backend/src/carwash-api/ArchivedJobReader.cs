using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace CarwashApi;

internal sealed record ArchivedJob(string Id, string Plate, string PackageName, DateTimeOffset CompletedAt);
internal sealed record ArchivedJobPage(string Batch, ArchivedJob[] Jobs, int? NextOffset);

internal static class ArchivedJobReader
{
    private const int CompressedLimit = 4 * 1024 * 1024;
    private const int ExpandedLimit = 16 * 1024 * 1024;
    private sealed record Row(string TenantId, string Id, string Plate, string PackageName, string Status, DateTimeOffset? CompletedAt);
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    internal static bool ValidBatch(string batch) =>
        batch.Length == 64 && batch.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    internal static string[] ListBatches(string root, string tenant, string? after, int limit)
    {
        if (!ValidTenant(tenant)) return [];
        var directory = Path.Combine(root, tenant);
        try
        {
            return Directory.EnumerateFiles(directory, "*.json.gz", SearchOption.TopDirectoryOnly)
                .Select(path => Path.GetFileName(path)[..^".json.gz".Length])
                .Where(batch => ValidBatch(batch) && (after is null || string.CompareOrdinal(batch, after) > 0))
                .Order(StringComparer.Ordinal)
                .Take(limit)
                .ToArray();
        }
        catch (DirectoryNotFoundException)
        {
            return [];
        }
    }

    private static bool ValidTenant(string tenant) =>
        !string.IsNullOrEmpty(tenant) && tenant.All(char.IsAsciiLetterOrDigit);

    internal static async Task<ArchivedJobPage?> ReadAsync(string root, string tenant, string batch, int offset, int limit,
        CancellationToken cancellationToken)
    {
        if (!ValidBatch(batch) || !ValidTenant(tenant))
            return null;
        var path = Path.Combine(root, tenant, batch + ".json.gz");
        try
        {
            await using var source = File.OpenRead(path);
            using var compressed = await ReadBoundedAsync(source, CompressedLimit, cancellationToken);
            var digest = Convert.ToHexStringLower(SHA256.HashData(compressed.GetBuffer().AsSpan(0, (int)compressed.Length)));
            if (digest != batch) throw new InvalidDataException("Archive digest mismatch");
            using var gzip = new GZipStream(compressed, CompressionMode.Decompress);
            using var expanded = await ReadBoundedAsync(gzip, ExpandedLimit, cancellationToken);
            using var document = await JsonDocument.ParseAsync(expanded, cancellationToken: cancellationToken);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("jobs", out var jobs) || jobs.ValueKind != JsonValueKind.Array)
                throw new InvalidDataException("Archive jobs are missing");
            var rows = jobs.Deserialize<Row[]>(JsonOptions);
            if (rows is null || rows.Any(row => row is null || row.TenantId != tenant || row.Status != "completed" ||
                    row.CompletedAt is null || string.IsNullOrWhiteSpace(row.Id) ||
                    string.IsNullOrWhiteSpace(row.Plate) || string.IsNullOrWhiteSpace(row.PackageName)))
                throw new InvalidDataException("Invalid archived jobs");
            var page = rows.Skip(offset).Take(limit)
                .Select(row => new ArchivedJob(row.Id, row.Plate, row.PackageName, row.CompletedAt!.Value)).ToArray();
            return new ArchivedJobPage(batch, page, (long)offset + page.Length < rows.Length ? offset + page.Length : null);
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
    }

    private static async Task<MemoryStream> ReadBoundedAsync(Stream input, int limit, CancellationToken cancellationToken)
    {
        var output = new MemoryStream();
        try
        {
            var buffer = new byte[8192];
            int count;
            while ((count = await input.ReadAsync(buffer, cancellationToken)) != 0)
            {
                if (output.Length + count > limit) throw new InvalidDataException("Archive exceeds the size limit");
                output.Write(buffer, 0, count);
            }
            output.Position = 0;
            return output;
        }
        catch
        {
            output.Dispose();
            throw;
        }
    }
}
