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

public class InventoryWorkflowTests
{
    private sealed class VerifiedStaff : IGoogleIdentityVerifier
    {
        public Task<string?> VerifySubjectAsync(string token, string clientId) => Task.FromResult<string?>(
            clientId != "test-client" ? null : token == "admin-token" ? "111" : token == "operator-token" ? "222" : null);
    }

    [Fact]
    public async Task JobAssignmentsAndCompoundLedgerRejectOveruseAndPersist()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-stock-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string jobId;
        string itemId;
        try
        {
            await using (var app = await Start(directory))
            {
                var baseUri = new Uri(app.Urls.First());
                using var admin = await StaffClient(baseUri, "admin-token");
                using var worker = await StaffClient(baseUri, "operator-token");
                using var device = new HttpClient { BaseAddress = baseUri };
                device.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "device-key");
                (await worker.PostAsJsonAsync("/api/employees", new { name = "Ana" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
                var employee = await admin.PostAsJsonAsync("/api/employees", new { name = "Ana" });
                employee.StatusCode.Should().Be(HttpStatusCode.Created);
                var employeeId = await Id(employee);
                var item = await admin.PostAsJsonAsync("/api/inventory/items", new { sku = "SOAP-A", name = "Espuma activa", unit = "ml", reorderPoint = 250 });
                item.StatusCode.Should().Be(HttpStatusCode.Created);
                itemId = await Id(item);
                (await PostWithKey(admin, $"/api/inventory/items/{itemId}/movements", new { type = "receipt", quantity = 1000, reason = "Supplier delivery" }, "stock-receipt-1")).StatusCode.Should().Be(HttpStatusCode.Created);
                (await PostWithKey(admin, $"/api/inventory/items/{itemId}/movements", new { type = "receipt", quantity = 1000, reason = "Supplier delivery" }, "stock-receipt-1")).StatusCode.Should().Be(HttpStatusCode.OK);

                var arrival = await device.PostAsJsonAsync("/api/arrivals/observations", new { deviceEventId = "stock-car-1", cameraId = "entry",
                    plateCandidate = "P123456", confidence = 0.8, capturedAt = DateTimeOffset.UtcNow });
                var arrivalId = await ObservationId(arrival);
                (await worker.PostAsJsonAsync($"/api/arrivals/{arrivalId}/confirm", new { plate = "P123456", vehicleClass = "car" })).StatusCode.Should().Be(HttpStatusCode.OK);
                var job = await PostWithKey(worker, "/api/jobs", new { arrivalId, packageId = "essential" }, "open-stock-job-1");
                jobId = await Id(job);
                (await PostWithKey(worker, $"/api/jobs/{jobId}/employees", new { employeeId }, "assign-ana-1")).StatusCode.Should().Be(HttpStatusCode.OK);
                (await PostWithKey(worker, $"/api/inventory/items/{itemId}/reservations", new { jobId, quantity = 800 }, "reserve-soap-1")).StatusCode.Should().Be(HttpStatusCode.Created);
                (await PostWithKey(worker, $"/api/inventory/items/{itemId}/reservations", new { jobId, quantity = 300 }, "reserve-soap-2")).StatusCode.Should().Be(HttpStatusCode.Conflict);
                (await PostWithKey(worker, $"/api/jobs/{jobId}/transition", new { status = "queued" }, "queue-stock-1")).StatusCode.Should().Be(HttpStatusCode.OK);
                (await PostWithKey(worker, $"/api/jobs/{jobId}/transition", new { status = "in_progress" }, "start-stock-1")).StatusCode.Should().Be(HttpStatusCode.OK);
                var use = new { type = "consume", quantity = 600, reason = "Foam wash", jobId, employeeId };
                (await PostWithKey(worker, $"/api/inventory/items/{itemId}/movements", use, "consume-soap-1")).StatusCode.Should().Be(HttpStatusCode.Created);
                (await PostWithKey(worker, $"/api/inventory/items/{itemId}/movements", new { type = "consume", quantity = 500, reason = "Too much", jobId, employeeId }, "consume-soap-2")).StatusCode.Should().Be(HttpStatusCode.Conflict);
                using (var stock = JsonDocument.Parse(await worker.GetStringAsync("/api/inventory/items")))
                {
                    stock.RootElement[0].GetProperty("onHand").GetDecimal().Should().Be(400);
                    stock.RootElement[0].GetProperty("reserved").GetDecimal().Should().Be(200);
                    stock.RootElement[0].GetProperty("available").GetDecimal().Should().Be(200);
                }
                using (var material = JsonDocument.Parse(await worker.GetStringAsync($"/api/jobs/{jobId}/materials")))
                    material.RootElement.GetArrayLength().Should().Be(1);
                var competing = await Task.WhenAll(
                    PostWithKey(worker, $"/api/inventory/items/{itemId}/movements", new { type = "consume", quantity = 300, reason = "Second pass", jobId, employeeId }, "consume-soap-race-a"),
                    PostWithKey(worker, $"/api/inventory/items/{itemId}/movements", new { type = "consume", quantity = 300, reason = "Second pass", jobId, employeeId }, "consume-soap-race-b"));
                competing.Count(response => response.StatusCode == HttpStatusCode.Created).Should().Be(1);
                competing.Count(response => response.StatusCode == HttpStatusCode.Conflict).Should().Be(1);
                (await PostWithKey(worker, $"/api/jobs/{jobId}/transition", new { status = "completed" }, "finish-stock-1")).StatusCode.Should().Be(HttpStatusCode.OK);
                (await PostWithKey(worker, $"/api/inventory/items/{itemId}/movements", use, "consume-soap-1")).StatusCode.Should().Be(HttpStatusCode.OK);
                using (var stock = JsonDocument.Parse(await worker.GetStringAsync("/api/inventory/items")))
                {
                    stock.RootElement[0].GetProperty("onHand").GetDecimal().Should().Be(100);
                    stock.RootElement[0].GetProperty("reserved").GetDecimal().Should().Be(0);
                }
            }
            await using (var restarted = await Start(directory))
            {
                using var admin = await StaffClient(new Uri(restarted.Urls.First()), "admin-token");
                using var stock = JsonDocument.Parse(await admin.GetStringAsync("/api/inventory/items"));
                stock.RootElement[0].GetProperty("item").GetProperty("id").GetString().Should().Be(itemId);
                stock.RootElement[0].GetProperty("onHand").GetDecimal().Should().Be(100);
                using var job = JsonDocument.Parse(await admin.GetStringAsync($"/api/jobs/{jobId}"));
                job.RootElement.GetProperty("assignments").GetArrayLength().Should().Be(1);
                job.RootElement.GetProperty("status").GetString().Should().Be("completed");
            }
        }
        finally { Directory.Delete(directory, true); }
    }

    private static async Task<WebApplication> Start(string directory)
    {
        var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0", "--SPARKLEWASH_INGEST_KEY", "device-key",
            "--SPARKLEWASH_ARRIVALS_FILE", Path.Combine(directory, "arrivals.json"),
            "--SPARKLEWASH_JOBS_FILE", Path.Combine(directory, "jobs.json"),
            "--SPARKLEWASH_OPERATIONS_FILE", Path.Combine(directory, "operations.json"),
            "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
            "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos"),
            "--SPARKLEWASH_GOOGLE_CLIENT_ID", "test-client", "--SPARKLEWASH_STAFF_ROLES", "111=admin;222=operator"], new VerifiedStaff());
        await app.StartAsync();
        return app;
    }
    private static async Task<HttpClient> StaffClient(Uri baseUri, string providerToken)
    {
        var client = new HttpClient { BaseAddress = baseUri };
        var response = await client.PostAsJsonAsync("/api/auth/google", new { idToken = providerToken });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("sessionToken").GetString());
        return client;
    }
    private static Task<HttpResponseMessage> PostWithKey(HttpClient client, string path, object body, string key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key);
        return client.SendAsync(request);
    }
    private static async Task<string> Id(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("id").GetString()!;
    }
    private static async Task<string> ObservationId(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("observation").GetProperty("id").GetString()!;
    }
}
