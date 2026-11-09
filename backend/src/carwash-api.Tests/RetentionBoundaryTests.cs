using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace CarwashApi.Tests;

public class RetentionBoundaryTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task ArrivalBeyondTenThousandKeepsOriginalDeduplicationRecord()
    {
        var root = Directory.CreateTempSubdirectory("sparklewash-retention-");
        try
        {
            var path = Path.Combine(root.FullName, "arrivals.json");
            var photos = new PhotoStore(Path.Combine(root.FullName, "photos"));
            var input = new ArrivalInput("first-event", "entry", "ABC123", 0.9, DateTimeOffset.UtcNow, null);
            var first = (await new ArrivalStore(path).AddAsync(input, null, photos)).Observation;
            var records = Enumerable.Range(0, 10000).Select(index =>
                first with { Id = $"arrival-{index}", DeviceEventId = index == 0 ? input.DeviceEventId! : $"event-{index}" });
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(records, JsonOptions));

            var store = new ArrivalStore(path);
            (await store.AddAsync(input with { DeviceEventId = "new-event" }, null, photos)).Status.Should().Be(ArrivalAddStatus.Created);
            var restarted = new ArrivalStore(path);
            (await restarted.ListAsync()).Should().HaveCount(10001);
            (await restarted.AddAsync(input, null, photos)).Status.Should().Be(ArrivalAddStatus.Duplicate);
        }
        finally { root.Delete(recursive: true); }
    }

    [Fact]
    public async Task JobBeyondTenThousandKeepsOpenWorkAndCreationRetryKeys()
    {
        var root = Directory.CreateTempSubdirectory("sparklewash-retention-");
        try
        {
            var path = Path.Combine(root.FullName, "jobs.json");
            var now = DateTimeOffset.UtcNow;
            var records = Enumerable.Range(0, 10000).Select(index => new JobRecord(
                $"job-{index}", $"arrival-{index}", $"ABC{index}", "car", "quick", "Quick", ["wash"], 10, "USD",
                index == 0 ? "queued" : "completed", now, null, index == 0 ? null : now, null,
                [new JobTransition("arrived", now, "staff", $"create-{index}")], []));
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(records, JsonOptions));
            var observation = new ArrivalObservation("new-arrival", "new-event", "entry", "XYZ123", 0.9,
                now, now, null, "digest", "XYZ123", "car", "staff", now);
            var package = PackageCatalog.Current.Packages.First();
            var store = new JobStore(path);
            (await store.CreateAsync(observation, package, "new-job-key", "staff")).Status.Should().Be(JobActionStatus.Created);

            var restarted = new JobStore(path);
            (await restarted.ListAsync()).Should().HaveCount(10001);
            (await restarted.FindOpenByPlateAsync("ABC0")).Should().NotBeNull();
            var originalArrival = observation with { Id = "arrival-0", ConfirmedPlate = "ABC0" };
            (await restarted.CreateAsync(originalArrival, package, "create-0", "staff")).Status.Should().Be(JobActionStatus.Duplicate);
        }
        finally { root.Delete(recursive: true); }
    }
}
