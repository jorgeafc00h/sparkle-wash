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

public class ArrivalWorkflowTests
{
    private sealed class VerifiedTestIdentity : IGoogleIdentityVerifier
    {
        public Task<string?> VerifySubjectAsync(string idToken, string clientId) =>
            Task.FromResult<string?>(idToken == "valid-provider-token" && clientId == "sparklewash-test-client" ? "123456" : null);
    }

    [Fact]
    public async Task DeviceObservationNeedsStaffConfirmationAndSurvivesRestart()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-arrivals-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var image = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "tiny.jpg"));
        string id;
        string jobId;
        try
        {
            await using (var app = await Start(directory))
            {
                using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
                var input = new { deviceEventId = "camera-event-1", cameraId = "entrance-cam", plateCandidate = "p-123 456",
                    confidence = 0.42, capturedAt = DateTimeOffset.UtcNow, photoBase64 = Convert.ToBase64String(image) };
                (await client.PostAsJsonAsync("/api/arrivals/observations", input)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
                client.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "device-secret");
                var created = await client.PostAsJsonAsync("/api/arrivals/observations", input);
                created.StatusCode.Should().Be(HttpStatusCode.Created);
                using (var json = JsonDocument.Parse(await created.Content.ReadAsStringAsync()))
                {
                    var observation = json.RootElement.GetProperty("observation");
                    id = observation.GetProperty("id").GetString()!;
                    observation.GetProperty("plateCandidate").GetString().Should().Be("P123456");
                    observation.GetProperty("confirmedPlate").ValueKind.Should().Be(JsonValueKind.Null);
                    observation.GetProperty("photoId").GetString().Should().NotBeNullOrWhiteSpace();
                }
                var replay = await client.PostAsJsonAsync("/api/arrivals/observations", input);
                replay.StatusCode.Should().Be(HttpStatusCode.OK);
                using (var json = JsonDocument.Parse(await replay.Content.ReadAsStringAsync()))
                    json.RootElement.GetProperty("duplicate").GetBoolean().Should().BeTrue();
                (await client.PostAsJsonAsync("/api/arrivals/observations", new { input.deviceEventId, input.cameraId,
                    plateCandidate = "P999999", input.confidence, input.capturedAt, input.photoBase64 })).StatusCode.Should().Be(HttpStatusCode.Conflict);

                (await client.GetAsync("/api/arrivals")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
                (await client.PostAsJsonAsync("/api/arrivals/" + id + "/confirm", new { plate = "P123456", vehicleClass = "suv" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
                var login = await client.PostAsJsonAsync("/api/auth/google", new { idToken = "valid-provider-token" });
                login.StatusCode.Should().Be(HttpStatusCode.OK);
                using var loginJson = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", loginJson.RootElement.GetProperty("sessionToken").GetString());
                var pending = await client.GetStringAsync("/api/arrivals");
                using (var json = JsonDocument.Parse(pending)) json.RootElement[0].GetProperty("confirmedPlate").ValueKind.Should().Be(JsonValueKind.Null);
                (await client.GetByteArrayAsync("/api/arrivals/" + id + "/photo")).Should().Equal(image);
                var confirmed = await client.PostAsJsonAsync("/api/arrivals/" + id + "/confirm", new { plate = "P-123 456", vehicleClass = "suv" });
                confirmed.StatusCode.Should().Be(HttpStatusCode.OK);
                using (var json = JsonDocument.Parse(await confirmed.Content.ReadAsStringAsync()))
                    json.RootElement.GetProperty("confirmedPlate").GetString().Should().Be("P123456");
                (await client.PostAsJsonAsync("/api/arrivals/" + id + "/confirm", new { plate = "P999999", vehicleClass = "car" })).StatusCode.Should().Be(HttpStatusCode.Conflict);
                var opened = await PostWithKey(client, "/api/jobs", new { arrivalId = id, packageId = "renew" }, "open-job-123");
                opened.StatusCode.Should().Be(HttpStatusCode.Created);
                using (var json = JsonDocument.Parse(await opened.Content.ReadAsStringAsync()))
                {
                    jobId = json.RootElement.GetProperty("id").GetString()!;
                    json.RootElement.GetProperty("priceUsd").GetDecimal().Should().Be(30);
                    json.RootElement.GetProperty("plate").GetString().Should().Be("P123456");
                    json.RootElement.GetProperty("status").GetString().Should().Be("arrived");
                }
                (await PostWithKey(client, "/api/jobs", new { arrivalId = id, packageId = "renew" }, "open-job-123")).StatusCode.Should().Be(HttpStatusCode.OK);
                (await PostWithKey(client, "/api/jobs/" + jobId + "/transition", new { status = "completed" }, "skip-to-done-1")).StatusCode.Should().Be(HttpStatusCode.Conflict);
                foreach (var (status, key) in new[] { ("queued", "queue-job-123"), ("in_progress", "start-job-123"), ("completed", "finish-job-123") })
                    (await PostWithKey(client, "/api/jobs/" + jobId + "/transition", new { status }, key)).StatusCode.Should().Be(HttpStatusCode.OK);
                (await PostWithKey(client, "/api/jobs/" + jobId + "/transition", new { status = "completed" }, "finish-job-123")).StatusCode.Should().Be(HttpStatusCode.OK);
                using (var summary = JsonDocument.Parse(await client.GetStringAsync("/api/jobs/summary")))
                {
                    summary.RootElement.GetProperty("total").GetInt32().Should().Be(1);
                    summary.RootElement.GetProperty("completed").GetInt32().Should().Be(1);
                    summary.RootElement.GetProperty("inProgress").GetInt32().Should().Be(0);
                }
            }
            await using (var restarted = await Start(directory))
            {
                using var client = new HttpClient { BaseAddress = new Uri(restarted.Urls.First()) };
                var login = await client.PostAsJsonAsync("/api/auth/google", new { idToken = "valid-provider-token" });
                using var json = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("sessionToken").GetString());
                using var arrivals = JsonDocument.Parse(await client.GetStringAsync("/api/arrivals"));
                arrivals.RootElement.GetArrayLength().Should().Be(1);
                arrivals.RootElement[0].GetProperty("id").GetString().Should().Be(id);
                arrivals.RootElement[0].GetProperty("confirmedPlate").GetString().Should().Be("P123456");
                using var job = JsonDocument.Parse(await client.GetStringAsync("/api/jobs/" + jobId));
                job.RootElement.GetProperty("status").GetString().Should().Be("completed");
                job.RootElement.GetProperty("transitions").GetArrayLength().Should().Be(4);
            }
        }
        finally { Directory.Delete(directory, true); }
    }

    private static Task<HttpResponseMessage> PostWithKey(HttpClient client, string path, object body, string key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static async Task<WebApplication> Start(string directory)
    {
        var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0", "--SPARKLEWASH_INGEST_KEY", "device-secret",
            "--SPARKLEWASH_ARRIVALS_FILE", Path.Combine(directory, "arrivals.json"),
            "--SPARKLEWASH_JOBS_FILE", Path.Combine(directory, "jobs.json"),
            "--SPARKLEWASH_OPERATIONS_FILE", Path.Combine(directory, "operations.json"),
            "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
            "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos"),
            "--SPARKLEWASH_GOOGLE_CLIENT_ID", "sparklewash-test-client",
            "--SPARKLEWASH_STAFF_ROLES", "123456=operator"], new VerifiedTestIdentity());
        await app.StartAsync();
        return app;
    }
}
