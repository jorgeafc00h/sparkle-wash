using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Xunit;

namespace CarwashApi.Tests;

public class StationIngestionTests
{
    [Fact]
    public async Task AuthenticatedTelemetryAndWashSurviveRestart()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var dataFile = Path.Combine(directory, "stations.json");
        try
        {
            await using (var app = await Start(dataFile))
            {
                using var client = NewClient(app);
                var telemetry = new { name = "Test bay", status = "washing", pressurePsi = 42, soapLevelDm = 30 };
                (await client.PostAsJsonAsync("/api/stations/test-1/telemetry", telemetry)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
                (await client.GetAsync("/api/metrics/summary")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
                (await client.GetAsync("/api/washes/history")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
                client.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "test-key");
                (await client.PostAsJsonAsync("/api/stations/test-1/telemetry", new { name = "Test bay", status = "washing", pressurePsi = -1, soapLevelDm = 30 })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await client.PostAsJsonAsync("/api/stations/test-1/telemetry", telemetry)).StatusCode.Should().Be(HttpStatusCode.Created);
                (await client.PostAsJsonAsync("/api/stations/test-1/washes", new { category = "basic", revenueUsd = 12.50m })).StatusCode.Should().Be(HttpStatusCode.Created);

                var metrics = await client.GetAsync("/api/metrics");
                metrics.Headers.GetValues("X-SparkleWash-Data-Source").Single().Should().Be("station-ingest");
                using var stations = JsonDocument.Parse(await metrics.Content.ReadAsStringAsync());
                stations.RootElement.GetArrayLength().Should().Be(1);
                stations.RootElement[0].GetProperty("stationId").GetString().Should().Be("test-1");
                using var alerts = JsonDocument.Parse(await client.GetStringAsync("/api/metrics/alerts"));
                alerts.RootElement.EnumerateArray().Select(x => x.GetProperty("code").GetString()).Should().Contain(new[] { "lowPressure", "lowSoapLevel" });
                using var summary = JsonDocument.Parse(await client.GetStringAsync("/api/metrics/summary"));
                summary.RootElement.GetProperty("washCount").GetInt32().Should().Be(1);
                summary.RootElement.GetProperty("revenueUsd").GetDecimal().Should().Be(12.50m);
            }
            await using (var restarted = await Start(dataFile))
            {
                using var client = NewClient(restarted);
                client.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "test-key");
                using var stations = JsonDocument.Parse(await client.GetStringAsync("/api/metrics"));
                stations.RootElement.GetArrayLength().Should().Be(1);
                using var history = JsonDocument.Parse(await client.GetStringAsync("/api/washes/history"));
                history.RootElement.GetArrayLength().Should().Be(1);
            }
        }
        finally { Directory.Delete(directory, true); }
    }

    private static async Task<WebApplication> Start(string dataFile)
    {
        var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0", "--SPARKLEWASH_DATA_FILE", dataFile, "--SPARKLEWASH_INGEST_KEY", "test-key"]);
        await app.StartAsync();
        return app;
    }
    private static HttpClient NewClient(WebApplication app) => new() { BaseAddress = new Uri(app.Urls.First()) };
}
