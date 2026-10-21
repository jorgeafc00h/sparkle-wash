using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Xunit;

namespace CarwashApi.Tests;

public class EmployeeWorkflowTests
{
    private sealed class VerifiedStaff : IGoogleIdentityVerifier
    {
        public Task<string?> VerifySubjectAsync(string token, string clientId) => Task.FromResult<string?>(
            clientId != "test-client" ? null : token == "admin-token" ? "111" : token == "operator-token" ? "222" : null);
    }

    private static WebApplication Build(string directory) => CarwashApi.Program.BuildApp(new[]
    {
        "--urls", "http://127.0.0.1:0",
        "--SPARKLEWASH_GOOGLE_CLIENT_ID", "test-client",
        "--SPARKLEWASH_STAFF_ROLES", "111=admin;222=operator",
        "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
        "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos"),
        "--SPARKLEWASH_ARRIVALS_FILE", Path.Combine(directory, "arrivals.json"),
        "--SPARKLEWASH_JOBS_FILE", Path.Combine(directory, "jobs.json"),
        "--SPARKLEWASH_OPERATIONS_FILE", Path.Combine(directory, "operations.json"),
    }, new VerifiedStaff());

    private static async Task<HttpClient> StaffClient(Uri baseUri, string providerToken)
    {
        var client = new HttpClient { BaseAddress = baseUri };
        var response = await client.PostAsJsonAsync("/api/auth/google", new { idToken = providerToken });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("sessionToken").GetString());
        return client;
    }

    [Fact]
    public async Task EmployeeLifecycleValidatesCreatesTogglesAndPersists()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-employees-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string createdId;
        try
        {
            await using (var app = Build(directory))
            {
                await app.StartAsync();
                var baseUri = new Uri(app.Urls.First());
                using var admin = await StaffClient(baseUri, "admin-token");
                using var worker = await StaffClient(baseUri, "operator-token");

                // Role gates: only admins manage the roster.
                (await worker.PostAsJsonAsync("/api/employees", new { name = "From Operator" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
                (await worker.PostAsJsonAsync(@"/api/employees/irrelevant/status", new { active = true })).StatusCode.Should().Be(HttpStatusCode.Forbidden);

                // Invalid names are rejected before any write.
                (await admin.PostAsJsonAsync("/api/employees", new { name = "A" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await admin.PostAsJsonAsync("/api/employees", new { name = new string('x', 101) })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
                (await admin.PostAsJsonAsync("/api/employees", new { name = "Bad\u0000Name" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

                var created = await admin.PostAsJsonAsync("/api/employees", new { name = "Juan Perez" });
                created.StatusCode.Should().Be(HttpStatusCode.Created);
                using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
                createdId = createdJson.RootElement.GetProperty("id").GetString()!;
                createdId.Should().NotBeEmpty();

                // Duplicate active-employee name is a conflict (case-insensitive),
                // as is a whitespace-padded variation of the same name.
                (await admin.PostAsJsonAsync("/api/employees", new { name = "JUAN PEREZ" })).StatusCode.Should().Be(HttpStatusCode.Conflict);
                (await admin.PostAsJsonAsync("/api/employees", new { name = "  Juan Perez  " })).StatusCode.Should().Be(HttpStatusCode.Conflict);

                // Unknown employee status update is a 404 (not an upsert).
                (await admin.PostAsJsonAsync(@"/api/employees/does-not-exist/status", new { active = true })).StatusCode.Should().Be(HttpStatusCode.NotFound);

                // Toggle inactive: the record stays listed so the UI can re-enable it.
                (await admin.PostAsJsonAsync(@"/api/employees/" + createdId + @"/status", new { active = false })).StatusCode.Should().Be(HttpStatusCode.OK);
                var list = System.Text.Json.Nodes.JsonNode.Parse(await admin.GetStringAsync("/api/employees"))!.AsArray();
                var row = list.Single(node => node["id"]!.GetValue<string>() == createdId);
                row["active"]!.GetValue<bool>().Should().BeFalse();
                row["name"]!.GetValue<string>().Should().Be("Juan Perez");

                // Re-enable for the persistence check below; an inactive employee
                // would not be assignable to a new job.
                (await admin.PostAsJsonAsync(@"/api/employees/" + createdId + @"/status", new { active = true })).StatusCode.Should().Be(HttpStatusCode.OK);
            }

            // Restart against the same data files: the active employee persists.
            await using var persistedApp = Build(directory);
            await persistedApp.StartAsync();
            using var adminAfterRestart = await StaffClient(new Uri(persistedApp.Urls.First()), "admin-token");
            using var persisted = JsonDocument.Parse(await adminAfterRestart.GetStringAsync("/api/employees"));
            persisted.RootElement.GetArrayLength().Should().Be(1);
            persisted.RootElement[0].GetProperty("id").GetString().Should().Be(createdId);
            persisted.RootElement[0].GetProperty("name").GetString().Should().Be("Juan Perez");
            persisted.RootElement[0].GetProperty("active").GetBoolean().Should().BeTrue();
        }
        finally { Directory.Delete(directory, true); }
    }
}