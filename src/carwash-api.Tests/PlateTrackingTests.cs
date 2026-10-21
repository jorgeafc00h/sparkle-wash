using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Xunit;

namespace CarwashApi.Tests;

public class PlateTrackingTests
{
    private sealed class VerifiedStaff : IGoogleIdentityVerifier
    {
        public Task<string?> VerifySubjectAsync(string idToken, string clientId) =>
            Task.FromResult<string?>(idToken == "operator-token" && clientId == "plate-client" ? "777" : null);
    }

    [Fact]
    public async Task CameraSightingsOfAnOpenJobAreTrackedInsteadOfQueuedForReview()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-plates-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            await using var app = await Start(directory);
            var baseUri = new Uri(app.Urls.First());
            using var device = new HttpClient { BaseAddress = baseUri };
            device.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "edge-key");
            using var staff = new HttpClient { BaseAddress = baseUri };
            var login = await staff.PostAsJsonAsync("/api/auth/google", new { idToken = "operator-token" });
            using (var json = JsonDocument.Parse(await login.Content.ReadAsStringAsync()))
                staff.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("sessionToken").GetString());

            (await staff.GetAsync("/api/plates/P1/timeline")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await new HttpClient { BaseAddress = baseUri }.GetAsync("/api/plates/P123456/timeline")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            var entry = await Observe(device, "entry-1", "entrance-cam", "p-123 456");
            entry.GetProperty("trackedJobId").ValueKind.Should().Be(JsonValueKind.Null);
            var arrivalId = entry.GetProperty("observation").GetProperty("id").GetString()!;
            (await Ids(staff, "/api/arrivals?pending=true")).Should().Equal(arrivalId);

            (await staff.PostAsJsonAsync($"/api/arrivals/{arrivalId}/confirm", new { plate = "P123456", vehicleClass = "car" })).EnsureSuccessStatusCode();
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/jobs") { Content = JsonContent.Create(new { arrivalId, packageId = "quick" }) };
            request.Headers.Add("Idempotency-Key", "open-plate-job-1");
            var opened = await staff.SendAsync(request);
            opened.StatusCode.Should().Be(HttpStatusCode.Created);
            string jobId;
            using (var json = JsonDocument.Parse(await opened.Content.ReadAsStringAsync())) jobId = json.RootElement.GetProperty("id").GetString()!;

            var bay = await Observe(device, "bay-1", "bay2-cam", "P123456");
            bay.GetProperty("trackedJobId").GetString().Should().Be(jobId);
            var stranger = await Observe(device, "entry-2", "entrance-cam", "XYZ987");
            stranger.GetProperty("trackedJobId").ValueKind.Should().Be(JsonValueKind.Null);
            (await Ids(staff, "/api/arrivals?pending=true")).Should().Equal(stranger.GetProperty("observation").GetProperty("id").GetString());

            (await Ids(staff, "/api/jobs?plate=p123-456")).Should().Equal(jobId);
            (await staff.GetAsync("/api/jobs?plate=%21")).StatusCode.Should().Be(HttpStatusCode.BadRequest);

            using var timeline = JsonDocument.Parse(await staff.GetStringAsync("/api/plates/p-123456/timeline"));
            timeline.RootElement.GetProperty("plate").GetString().Should().Be("P123456");
            timeline.RootElement.GetProperty("openJob").GetProperty("id").GetString().Should().Be(jobId);
            timeline.RootElement.GetProperty("visits").GetInt32().Should().Be(1);
            timeline.RootElement.GetProperty("sightings").EnumerateArray().Select(x => x.GetProperty("cameraId").GetString())
                .Should().BeEquivalentTo("entrance-cam", "bay2-cam");
            timeline.RootElement.GetProperty("sightings").EnumerateArray().All(x => x.GetProperty("jobId").GetString() == jobId)
                .Should().BeTrue();
        }
        finally { Directory.Delete(directory, true); }
    }

    private static async Task<JsonElement> Observe(HttpClient device, string eventId, string cameraId, string plate)
    {
        var response = await device.PostAsJsonAsync("/api/arrivals/observations", new
        {
            deviceEventId = eventId, cameraId, plateCandidate = plate, confidence = 0.91, capturedAt = DateTimeOffset.UtcNow
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static async Task<string?[]> Ids(HttpClient client, string path)
    {
        using var json = JsonDocument.Parse(await client.GetStringAsync(path));
        return json.RootElement.EnumerateArray().Select(x => x.GetProperty("id").GetString()).ToArray();
    }

    private static async Task<WebApplication> Start(string directory)
    {
        var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0", "--SPARKLEWASH_INGEST_KEY", "edge-key",
            "--SPARKLEWASH_ARRIVALS_FILE", Path.Combine(directory, "arrivals.json"),
            "--SPARKLEWASH_JOBS_FILE", Path.Combine(directory, "jobs.json"),
            "--SPARKLEWASH_OPERATIONS_FILE", Path.Combine(directory, "operations.json"),
            "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
            "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos"),
            "--SPARKLEWASH_GOOGLE_CLIENT_ID", "plate-client",
            "--SPARKLEWASH_STAFF_ROLES", "777=operator"], new VerifiedStaff());
        await app.StartAsync();
        return app;
    }
}

public class CorsTests
{
    [Fact]
    public async Task OnlyConfiguredConsoleOriginIsAllowed()
    {
        await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
            "--SPARKLEWASH_CORS_ORIGINS", "https://console.example"]);
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        async Task<string?> Preflight(string origin)
        {
            var request = new HttpRequestMessage(HttpMethod.Options, "/api/jobs");
            request.Headers.Add("Origin", origin);
            request.Headers.Add("Access-Control-Request-Method", "POST");
            request.Headers.Add("Access-Control-Request-Headers", "authorization,idempotency-key");
            var response = await client.SendAsync(request);
            return response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values) ? values.Single() : null;
        }
        (await Preflight("https://console.example")).Should().Be("https://console.example");
        (await Preflight("https://evil.example")).Should().BeNull();
    }
}

public class ExitCameraAndEventsTests
{
    private sealed class VerifiedStaff : IGoogleIdentityVerifier
    {
        public Task<string?> VerifySubjectAsync(string idToken, string clientId) =>
            Task.FromResult<string?>(idToken == "operator-token" ? "888" : null);
    }

    [Fact]
    public async Task ExitSightingSuggestsCompletionAndPushesChangeEvents()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-exit-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0", "--SPARKLEWASH_INGEST_KEY", "edge-key",
                "--SPARKLEWASH_ARRIVALS_FILE", Path.Combine(directory, "arrivals.json"),
                "--SPARKLEWASH_JOBS_FILE", Path.Combine(directory, "jobs.json"),
                "--SPARKLEWASH_OPERATIONS_FILE", Path.Combine(directory, "operations.json"),
                "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
                "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos"),
                "--SPARKLEWASH_GOOGLE_CLIENT_ID", "exit-client", "--SPARKLEWASH_STAFF_ROLES", "888=operator",
                "--SPARKLEWASH_EXIT_CAMERAS", "exit-cam"], new VerifiedStaff());
            await app.StartAsync();
            var baseUri = new Uri(app.Urls.First());
            using var device = new HttpClient { BaseAddress = baseUri };
            device.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "edge-key");
            using var staff = new HttpClient { BaseAddress = baseUri };
            using (var login = JsonDocument.Parse(await (await staff.PostAsJsonAsync("/api/auth/google", new { idToken = "operator-token" })).Content.ReadAsStringAsync()))
                staff.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.RootElement.GetProperty("sessionToken").GetString());

            (await new HttpClient { BaseAddress = baseUri }.GetAsync("/api/events")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            using var events = await staff.SendAsync(new HttpRequestMessage(HttpMethod.Get, "/api/events"), HttpCompletionOption.ResponseHeadersRead);
            events.Content.Headers.ContentType!.MediaType.Should().Be("text/event-stream");
            using var reader = new StreamReader(await events.Content.ReadAsStreamAsync());

            // An exit sighting of an unknown car is not a new arrival.
            var unknown = await Observe(device, "exit-0", "exit-cam", "QQQ111");
            unknown.GetProperty("suggestComplete").GetBoolean().Should().BeFalse();
            unknown.GetProperty("observation").GetProperty("cameraRole").GetString().Should().Be("exit");
            using (var pending = JsonDocument.Parse(await staff.GetStringAsync("/api/arrivals?pending=true")))
                pending.RootElement.GetArrayLength().Should().Be(0);

            var arrivalId = (await Observe(device, "entry-1", "entrance-cam", "P123456")).GetProperty("observation").GetProperty("id").GetString()!;
            (await NextTopic(reader)).Should().Be("arrivals");
            (await staff.PostAsJsonAsync($"/api/arrivals/{arrivalId}/confirm", new { plate = "P123456", vehicleClass = "car" })).EnsureSuccessStatusCode();
            var jobId = await Id(await Send(staff, "/api/jobs", new { arrivalId, packageId = "quick" }, "exit-open-1"));
            foreach (var (status, key) in new[] { ("queued", "exit-queue-1"), ("in_progress", "exit-start-1") })
                (await Send(staff, $"/api/jobs/{jobId}/transition", new { status }, key)).EnsureSuccessStatusCode();

            var leaving = await Observe(device, "exit-1", "exit-cam", "P123456");
            leaving.GetProperty("trackedJobId").GetString().Should().Be(jobId);
            leaving.GetProperty("suggestComplete").GetBoolean().Should().BeTrue();
            (await Send(staff, $"/api/jobs/{jobId}/transition", new { status = "completed" }, "exit-done-1")).EnsureSuccessStatusCode();

            // Still linked after completion: the car is seen again on its way out.
            var after = await Observe(device, "exit-2", "exit-cam", "P123456");
            after.GetProperty("trackedJobId").GetString().Should().Be(jobId);
            after.GetProperty("suggestComplete").GetBoolean().Should().BeFalse();
            using var timeline = JsonDocument.Parse(await staff.GetStringAsync("/api/plates/P123456/timeline"));
            timeline.RootElement.GetProperty("leftAt").ValueKind.Should().Be(JsonValueKind.String);
        }
        finally { Directory.Delete(directory, true); }
    }

    private static async Task<string?> NextTopic(StreamReader reader)
    {
        using var timeout = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (await reader.ReadLineAsync(timeout.Token) is { } line)
            if (line.StartsWith("data: ")) return JsonDocument.Parse(line[6..]).RootElement.GetProperty("topic").GetString();
        return null;
    }

    private static async Task<JsonElement> Observe(HttpClient device, string eventId, string cameraId, string plate)
    {
        var response = await device.PostAsJsonAsync("/api/arrivals/observations", new
        {
            deviceEventId = eventId, cameraId, plateCandidate = plate, confidence = 0.9, capturedAt = DateTimeOffset.UtcNow
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static Task<HttpResponseMessage> Send(HttpClient client, string path, object body, string key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static async Task<string> Id(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("id").GetString()!;
    }
}
