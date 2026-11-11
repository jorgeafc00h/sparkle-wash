using System;
using System.Collections.Generic;
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

public sealed class DesktopPosWorkflowTests : IAsyncLifetime
{
    private sealed class FakeGoogle : IGoogleIdentityVerifier
    {
        private static readonly Dictionary<string, GoogleIdentity> Identities = new()
        {
            ["admin"] = new("111", "admin@example.com", true, "Admin"),
            ["operator"] = new("222", "op@example.com", true, "Operator"),
            ["viewer"] = new("333", "viewer@example.com", true, "Viewer"),
            ["owner-b"] = new("2002", "beto@lavado-b.com", true, "Beto Owner"),
        };
        public Task<string?> VerifySubjectAsync(string idToken, string clientId) => Task.FromResult(Identities.GetValueOrDefault(idToken)?.Subject);
        public Task<GoogleIdentity?> VerifyAsync(string idToken, string clientId) =>
            Task.FromResult(clientId == "pos-client" ? Identities.GetValueOrDefault(idToken) : null);
    }

    private readonly string _directory = Path.Combine(Path.GetTempPath(), "sparklewash-pos-" + Guid.NewGuid().ToString("N"));
    private WebApplication _app = null!;
    private Uri _base = null!;
    private int _keys;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_directory);
        _app = CarwashApi.Program.BuildApp([
            "--urls", "http://127.0.0.1:0",
            "--SPARKLEWASH_TENANTS_DIR", Path.Combine(_directory, "tenants"),
            "--SPARKLEWASH_ARRIVALS_FILE", Path.Combine(_directory, "arrivals.json"),
            "--SPARKLEWASH_JOBS_FILE", Path.Combine(_directory, "jobs.json"),
            "--SPARKLEWASH_OPERATIONS_FILE", Path.Combine(_directory, "operations.json"),
            "--SPARKLEWASH_DEVICES_FILE", Path.Combine(_directory, "devices.json"),
            "--SPARKLEWASH_DATA_FILE", Path.Combine(_directory, "stations.json"),
            "--SPARKLEWASH_PHOTO_DIR", Path.Combine(_directory, "photos"),
            "--SPARKLEWASH_GOOGLE_CLIENT_ID", "pos-client",
            "--SPARKLEWASH_STAFF_ROLES", "111=admin;222=operator;333=viewer"], new FakeGoogle());
        await _app.StartAsync();
        _base = new Uri(_app.Urls.First());
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        Directory.Delete(_directory, true);
    }

    private async Task<HttpClient> Staff(string idToken)
    {
        var client = new HttpClient { BaseAddress = _base };
        var response = await client.PostAsJsonAsync("/api/auth/google", new { idToken });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", json.RootElement.GetProperty("sessionToken").GetString());
        return client;
    }

    private string Key() => "pos-test-key-" + ++_keys;

    private static Task<HttpResponseMessage> Post(HttpClient client, string url, object body, string? key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        if (key is not null) request.Headers.Add("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static async Task<JsonElement> Body(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    private static object WalkIn(string plate = "P123456", string packageId = "essential", object? extra = null) =>
        extra ?? new { plate, vehicleClass = "suv", packageId };

    private async Task<string> CreateEmployee(HttpClient admin, string name = "Juan Perez")
    {
        var created = await admin.PostAsJsonAsync("/api/employees", new { name });
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await Body(created)).GetProperty("id").GetString()!;
    }

    private async Task<int> JobCount(HttpClient client) => (await Body(await client.GetAsync("/api/jobs"))).GetArrayLength();
    private async Task<int> ArrivalCount(HttpClient client) => (await Body(await client.GetAsync("/api/arrivals"))).GetArrayLength();

    [Fact]
    public async Task WalkInCreatesReplaysAndConflicts()
    {
        using var op = await Staff("operator");
        var key = Key();
        var created = await Post(op, "/api/jobs/walk-in", new { plate = "p-123 456", vehicleClass = "suv", packageId = "essential",
            ticketNumber = "OT-A1-000001", customerName = "Maria", note = "Rayon en puerta" }, key);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var job = await Body(created);
        job.GetProperty("plate").GetString().Should().Be("P123456");
        job.GetProperty("source").GetString().Should().Be("desktop-pos");
        job.GetProperty("ticketNumber").GetString().Should().Be("OT-A1-000001");
        job.GetProperty("customerName").GetString().Should().Be("Maria");
        job.GetProperty("note").GetString().Should().Be("Rayon en puerta");
        job.GetProperty("status").GetString().Should().Be("arrived");
        job.GetProperty("payments").ValueKind.Should().Be(JsonValueKind.Array);
        job.GetProperty("payments").GetArrayLength().Should().Be(0);
        job.GetProperty("paidUsd").GetDecimal().Should().Be(0);
        job.GetProperty("paymentStatus").GetString().Should().Be("unpaid");
        job.GetProperty("paidAt").ValueKind.Should().Be(JsonValueKind.Null);
        var id = job.GetProperty("id").GetString();

        var replay = await Post(op, "/api/jobs/walk-in", new { plate = "P123456", vehicleClass = "suv", packageId = "essential" }, key);
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Body(replay)).GetProperty("id").GetString().Should().Be(id);
        (await JobCount(op)).Should().Be(1);

        var differentPackage = await Post(op, "/api/jobs/walk-in", new { plate = "P123456", vehicleClass = "suv", packageId = "supreme" }, key);
        differentPackage.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var differentPlate = await Post(op, "/api/jobs/walk-in", new { plate = "ZZZ999", vehicleClass = "suv", packageId = "essential" }, key);
        differentPlate.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var open = await Post(op, "/api/jobs/walk-in", new { plate = "P123456", vehicleClass = "suv", packageId = "essential" }, Key());
        open.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var conflict = await Body(open);
        conflict.GetProperty("error").GetString().Should().NotBeNullOrEmpty();
        conflict.GetProperty("job").GetProperty("id").GetString().Should().Be(id);
        (await JobCount(op)).Should().Be(1);
        (await ArrivalCount(op)).Should().Be(1);
    }

    [Fact]
    public async Task WalkInValidatesEverythingBeforeWriting()
    {
        using var admin = await Staff("admin");
        using var op = await Staff("operator");
        var bad = new object[]
        {
            new { plate = "!", vehicleClass = "suv", packageId = "essential" },
            new { plate = "P123456", vehicleClass = "boat", packageId = "essential" },
            new { plate = "P123456", vehicleClass = "suv", packageId = "nope" },
            new { plate = "P123456", vehicleClass = "suv", packageId = "essential", employeeId = "missing" },
            new { plate = "P123456", vehicleClass = "suv", packageId = "essential", ticketNumber = "bad ticket!" },
            new { plate = "P123456", vehicleClass = "suv", packageId = "essential", ticketNumber = new string('1', 33) },
            new { plate = "P123456", vehicleClass = "suv", packageId = "essential", customerName = new string('x', 81) },
            new { plate = "P123456", vehicleClass = "suv", packageId = "essential", note = new string('x', 201) },
            new { plate = "P123456", vehicleClass = "suv", packageId = "essential", source = "other" },
        };
        foreach (var body in bad)
            (await Post(op, "/api/jobs/walk-in", body, Key())).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Post(op, "/api/jobs/walk-in", WalkIn(), null)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Post(op, "/api/jobs/walk-in", WalkIn(), "short")).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var employeeId = await CreateEmployee(admin);
        (await admin.PostAsJsonAsync($"/api/employees/{employeeId}/status", new { active = false })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await Post(op, "/api/jobs/walk-in", new { plate = "P123456", vehicleClass = "suv", packageId = "essential", employeeId }, Key()))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        (await JobCount(op)).Should().Be(0);
        (await ArrivalCount(op)).Should().Be(0);
    }

    [Fact]
    public async Task ViewerCannotWriteAndAnonymousIsRejected()
    {
        using var op = await Staff("operator");
        using var viewer = await Staff("viewer");
        var job = await Body(await Post(op, "/api/jobs/walk-in", WalkIn(), Key()));
        var id = job.GetProperty("id").GetString();
        (await Post(viewer, "/api/jobs/walk-in", WalkIn("ABC123"), Key())).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await Post(viewer, $"/api/jobs/{id}/ticket", new { ticketNumber = "T1" }, null)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await Post(viewer, $"/api/jobs/{id}/payments", new { method = "cash", amountUsd = 5 }, Key())).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using var anonymous = new HttpClient { BaseAddress = _base };
        (await Post(anonymous, "/api/jobs/walk-in", WalkIn("ABC123"), Key())).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await viewer.GetAsync($"/api/jobs/{id}")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task WalkInAssignsEmployeeAndReplaysIt()
    {
        using var admin = await Staff("admin");
        using var op = await Staff("operator");
        var employeeId = await CreateEmployee(admin);
        var key = Key();
        var body = new { plate = "P123456", vehicleClass = "suv", packageId = "essential", employeeId };
        var created = await Post(op, "/api/jobs/walk-in", body, key);
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var assignments = (await Body(created)).GetProperty("assignments");
        assignments.GetArrayLength().Should().Be(1);
        assignments[0].GetProperty("employeeId").GetString().Should().Be(employeeId);
        assignments[0].GetProperty("employeeName").GetString().Should().Be("Juan Perez");

        var replay = await Post(op, "/api/jobs/walk-in", body, key);
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Body(replay)).GetProperty("assignments").GetArrayLength().Should().Be(1);

        var other = await CreateEmployee(admin, "Pedro Gomez");
        (await Post(op, "/api/jobs/walk-in", new { plate = "P123456", vehicleClass = "suv", packageId = "essential", employeeId = other }, key))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task StaffEnteredArrivalIsNeverPendingAndNeedsNoPhoto()
    {
        using var op = await Staff("operator");
        var job = await Body(await Post(op, "/api/jobs/walk-in", WalkIn(), Key()));
        var arrivals = await Body(await op.GetAsync("/api/arrivals"));
        arrivals.GetArrayLength().Should().Be(1);
        var arrival = arrivals[0];
        arrival.GetProperty("cameraId").GetString().Should().Be("pos-counter");
        arrival.GetProperty("cameraRole").GetString().Should().Be("entry");
        arrival.GetProperty("photoId").ValueKind.Should().Be(JsonValueKind.Null);
        arrival.GetProperty("deviceEventId").GetString().Should().StartWith("pos-");
        arrival.GetProperty("jobId").GetString().Should().Be(job.GetProperty("id").GetString());
        (await Body(await op.GetAsync("/api/arrivals?pending=true"))).GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task TicketIsWriteOnce()
    {
        using var op = await Staff("operator");
        var id = (await Body(await Post(op, "/api/jobs/walk-in", WalkIn(), Key()))).GetProperty("id").GetString();
        var first = await Post(op, $"/api/jobs/{id}/ticket", new { ticketNumber = "OT-1" }, null);
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Body(first)).GetProperty("ticketNumber").GetString().Should().Be("OT-1");
        (await Post(op, $"/api/jobs/{id}/ticket", new { ticketNumber = "OT-1" }, null)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await Post(op, $"/api/jobs/{id}/ticket", new { ticketNumber = "OT-2" }, null)).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Post(op, $"/api/jobs/{id}/ticket", new { ticketNumber = "bad ticket" }, null)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Post(op, $"/api/jobs/{id}/ticket", new { }, null)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Post(op, "/api/jobs/unknown/ticket", new { ticketNumber = "OT-1" }, null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await Body(await op.GetAsync($"/api/jobs/{id}"))).GetProperty("ticketNumber").GetString().Should().Be("OT-1");
    }

    [Fact]
    public async Task PaymentsReplayConflictAndTrackPaidStatus()
    {
        using var op = await Staff("operator");
        var job = await Body(await Post(op, "/api/jobs/walk-in", WalkIn(), Key()));
        var id = job.GetProperty("id").GetString();
        var price = job.GetProperty("priceUsd").GetDecimal();
        price.Should().BeGreaterThan(1);

        var key = Key();
        var partialBody = new { method = "cash", amountUsd = 1.00m, ticketNumber = "C1-000123", reference = "r-1" };
        var partial = await Post(op, $"/api/jobs/{id}/payments", partialBody, key);
        partial.StatusCode.Should().Be(HttpStatusCode.Created);
        var view = await Body(partial);
        view.GetProperty("paymentStatus").GetString().Should().Be("partial");
        view.GetProperty("paidUsd").GetDecimal().Should().Be(1.00m);
        view.GetProperty("paidAt").ValueKind.Should().Be(JsonValueKind.Null);
        var payment = view.GetProperty("payments")[0];
        payment.GetProperty("method").GetString().Should().Be("cash");
        payment.GetProperty("ticketNumber").GetString().Should().Be("C1-000123");
        payment.GetProperty("reference").GetString().Should().Be("r-1");
        payment.GetProperty("actor").GetString().Should().Be("222");
        payment.GetProperty("idempotencyKey").GetString().Should().Be(key);

        var replay = await Post(op, $"/api/jobs/{id}/payments", partialBody, key);
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Body(replay)).GetProperty("payments").GetArrayLength().Should().Be(1);
        (await Post(op, $"/api/jobs/{id}/payments", new { method = "card", amountUsd = 1.00m }, key)).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Post(op, $"/api/jobs/{id}/payments", new { method = "cash", amountUsd = 2.00m, ticketNumber = "C1-000123", reference = "r-1" }, key))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);

        var final = await Post(op, $"/api/jobs/{id}/payments", new { method = "card", amountUsd = price - 1.00m }, Key());
        final.StatusCode.Should().Be(HttpStatusCode.Created);
        view = await Body(final);
        view.GetProperty("paymentStatus").GetString().Should().Be("paid");
        view.GetProperty("paidUsd").GetDecimal().Should().Be(price);
        view.GetProperty("paidAt").ValueKind.Should().Be(JsonValueKind.String);
        view.GetProperty("payments").GetArrayLength().Should().Be(2);
        var paidAt = view.GetProperty("paidAt").GetString();

        var extra = await Body(await Post(op, $"/api/jobs/{id}/payments", new { method = "other", amountUsd = 1 }, Key()));
        extra.GetProperty("paidAt").GetString().Should().Be(paidAt);

        var listed = await Body(await op.GetAsync("/api/jobs"));
        listed[0].GetProperty("paymentStatus").GetString().Should().Be("paid");
    }

    [Fact]
    public async Task PaymentValidationCancelledAndUnknownJobs()
    {
        using var op = await Staff("operator");
        var id = (await Body(await Post(op, "/api/jobs/walk-in", WalkIn(), Key()))).GetProperty("id").GetString();
        foreach (var body in new object[]
        {
            new { method = "bitcoin", amountUsd = 5 }, new { amountUsd = 5 }, new { method = "cash", amountUsd = 0 },
            new { method = "cash", amountUsd = -3 }, new { method = "cash", amountUsd = 100000.01m }, new { method = "cash" },
            new { method = "cash", amountUsd = 5, reference = new string('r', 65) }, new { method = "cash", amountUsd = 5, ticketNumber = "no spaces" },
        })
            (await Post(op, $"/api/jobs/{id}/payments", body, Key())).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Post(op, $"/api/jobs/{id}/payments", new { method = "cash", amountUsd = 5 }, null)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Post(op, "/api/jobs/unknown/payments", new { method = "cash", amountUsd = 5 }, Key())).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await Post(op, $"/api/jobs/{id}/payments", new { method = "cash", amountUsd = 100000 }, Key())).StatusCode.Should().Be(HttpStatusCode.Created);

        var prepayId = (await Body(await Post(op, "/api/jobs/walk-in", WalkIn("ABC123"), Key()))).GetProperty("id").GetString();
        (await Post(op, $"/api/jobs/{prepayId}/transition", new { status = "cancelled" }, Key())).StatusCode.Should().Be(HttpStatusCode.OK);
        var cancelled = await Post(op, $"/api/jobs/{prepayId}/payments", new { method = "cash", amountUsd = 5 }, Key());
        cancelled.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Body(cancelled)).GetProperty("error").GetString().Should().Contain("cancelled");

        // Prepay on an arrived (not started) job is fine; completed jobs may still be settled.
        var other = (await Body(await Post(op, "/api/jobs/walk-in", WalkIn("XYZ789"), Key()))).GetProperty("id").GetString();
        (await Post(op, $"/api/jobs/{other}/payments", new { method = "transfer", amountUsd = 3 }, Key())).StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task LegacyJobJsonWithoutNewFieldsSerializesPaymentsAsArray()
    {
        var path = Path.Combine(_directory, "legacy-jobs.json");
        var at = DateTimeOffset.UtcNow.ToString("O");
        File.WriteAllText(path, $$"""
            [{"id":"legacy1","arrivalId":"a1","plate":"OLD123","vehicleClass":"car","packageId":"essential","packageName":"Essential",
              "services":["x"],"priceUsd":10.0,"currency":"USD","status":"arrived","arrivalAt":"{{at}}","startedAt":null,
              "completedAt":null,"cancelledAt":null,"transitions":[],"assignments":[]}]
            """);
        var jobs = await new JobStore(path).ListAsync();
        var json = JsonSerializer.SerializeToElement(jobs.Single(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        json.GetProperty("payments").ValueKind.Should().Be(JsonValueKind.Array);
        json.GetProperty("payments").GetArrayLength().Should().Be(0);
        json.GetProperty("paymentStatus").GetString().Should().Be("unpaid");
        json.GetProperty("paidUsd").GetDecimal().Should().Be(0);
        json.GetProperty("source").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task JobsOpenedThroughTheCameraFlowAreSourcedCamera()
    {
        var store = new JobStore(Path.Combine(_directory, "camera-jobs.json"));
        var arrival = new ArrivalObservation("arr1", "evt", "cam", "CAM999", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, "d",
            "CAM999", "car", "s", DateTimeOffset.UtcNow);
        var result = await store.CreateAsync(arrival, PackageCatalog.Current.Packages[0], "camera-key-1", "s");
        result.Job!.Source.Should().Be("camera");
    }

    [Fact]
    public async Task TenantsCannotSeeOrChangeEachOthersPosData()
    {
        using var op = await Staff("operator");
        var id = (await Body(await Post(op, "/api/jobs/walk-in", WalkIn(), Key()))).GetProperty("id").GetString();

        using var anon = new HttpClient { BaseAddress = _base };
        var register = await anon.PostAsJsonAsync("/api/tenants/register", new
        {
            idToken = "owner-b", name = "Lavado B", city = "San Salvador", country = "sv", phone = "+503 2222-3333", timeZone = "America/El_Salvador"
        });
        register.StatusCode.Should().Be(HttpStatusCode.Created);
        using var other = new HttpClient { BaseAddress = _base };
        other.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await Body(register)).GetProperty("sessionToken").GetString());

        (await Post(other, $"/api/jobs/{id}/ticket", new { ticketNumber = "X1" }, null)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await Post(other, $"/api/jobs/{id}/payments", new { method = "cash", amountUsd = 5 }, Key())).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await JobCount(other)).Should().Be(0);
        // The same plate and idempotency key in another carwash is independent.
        var key = Key();
        (await Post(other, "/api/jobs/walk-in", WalkIn(), key)).StatusCode.Should().Be(HttpStatusCode.Created);
        (await Post(op, "/api/jobs/walk-in", new { plate = "NEW111", vehicleClass = "car", packageId = "essential" }, key)).StatusCode.Should().Be(HttpStatusCode.Created);
        (await JobCount(op)).Should().Be(2);
        (await JobCount(other)).Should().Be(1);
    }

    [Fact]
    public async Task OpenApiListsTheDesktopPosRoutes()
    {
        using var client = new HttpClient { BaseAddress = _base };
        var paths = (await Body(await client.GetAsync("/openapi.json"))).GetProperty("paths");
        foreach (var route in new[] { "/api/jobs/walk-in", "/api/jobs/{id}/ticket", "/api/jobs/{id}/payments" })
            paths.TryGetProperty(route, out var item).Should().BeTrue(route);
    }
}
