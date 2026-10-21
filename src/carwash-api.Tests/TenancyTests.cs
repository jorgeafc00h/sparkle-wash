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

public sealed class TenancyTests : IAsyncLifetime
{
    // token -> identity. "legacy-admin" is configured through SPARKLEWASH_STAFF_ROLES for the default carwash.
    private sealed class FakeGoogle : IGoogleIdentityVerifier
    {
        private static readonly Dictionary<string, GoogleIdentity> Identities = new()
        {
            ["owner-a"] = new("1001", "ana@lavado-a.com", true, "Ana Owner"),
            ["owner-b"] = new("2002", "beto@lavado-b.com", true, "Beto Owner"),
            ["worker"] = new("3003", "Carla@Example.com", true, "Carla"),
            ["unverified"] = new("4004", "dani@example.com", false, "Dani"),
            ["legacy-admin"] = new("9009", "legacy@example.com", true, "Legacy"),
        };
        public Task<string?> VerifySubjectAsync(string idToken, string clientId) => Task.FromResult(Identities.GetValueOrDefault(idToken)?.Subject);
        public Task<GoogleIdentity?> VerifyAsync(string idToken, string clientId) =>
            Task.FromResult(clientId == "tenancy-client" ? Identities.GetValueOrDefault(idToken) : null);
    }

    private readonly string _directory = Path.Combine(Path.GetTempPath(), "sparklewash-tenancy-" + Guid.NewGuid().ToString("N"));
    private WebApplication _app = null!;
    private Uri _base = null!;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_directory);
        _app = await Start();
        _base = new Uri(_app.Urls.First());
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        Directory.Delete(_directory, true);
    }

    private async Task<WebApplication> Start(params string[] extra)
    {
        var app = CarwashApi.Program.BuildApp([
            "--urls", "http://127.0.0.1:0", "--SPARKLEWASH_INGEST_KEY", "legacy-key",
            "--SPARKLEWASH_TENANTS_DIR", Path.Combine(_directory, "tenants"),
            "--SPARKLEWASH_ARRIVALS_FILE", Path.Combine(_directory, "arrivals.json"),
            "--SPARKLEWASH_JOBS_FILE", Path.Combine(_directory, "jobs.json"),
            "--SPARKLEWASH_OPERATIONS_FILE", Path.Combine(_directory, "operations.json"),
            "--SPARKLEWASH_DEVICES_FILE", Path.Combine(_directory, "devices.json"),
            "--SPARKLEWASH_DATA_FILE", Path.Combine(_directory, "stations.json"),
            "--SPARKLEWASH_PHOTO_DIR", Path.Combine(_directory, "photos"),
            "--SPARKLEWASH_GOOGLE_CLIENT_ID", "tenancy-client",
            "--SPARKLEWASH_STAFF_ROLES", "9009=admin", .. extra], new FakeGoogle());
        await app.StartAsync();
        return app;
    }

    private HttpClient Client(string? token = null)
    {
        var client = new HttpClient { BaseAddress = _base };
        if (token is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<(string Token, string TenantId)> Register(string idToken, string name = "Lavado Central")
    {
        var response = await Client().PostAsJsonAsync("/api/tenants/register", new
        {
            idToken, name, city = "San Salvador", country = "sv", phone = "+503 2222-3333", timeZone = "America/El_Salvador"
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.GetProperty("role").GetString().Should().Be("admin");
        return (json.RootElement.GetProperty("sessionToken").GetString()!, json.RootElement.GetProperty("tenant").GetProperty("id").GetString()!);
    }

    private async Task<string> Login(string idToken)
    {
        var response = await Client().PostAsJsonAsync("/api/auth/google", new { idToken });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("sessionToken").GetString()!;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.Clone();
    }

    private static async Task<(string Id, string Key)> AddDevice(HttpClient admin, string cameraId, string role)
    {
        var response = await admin.PostAsJsonAsync("/api/devices", new { name = $"Cámara {cameraId}", cameraId, role });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await Json(response);
        return (body.GetProperty("device").GetProperty("id").GetString()!, body.GetProperty("deviceKey").GetString()!);
    }

    private static Task<HttpResponseMessage> Observe(HttpClient device, string cameraId, string plate, string eventId) =>
        device.PostAsJsonAsync("/api/arrivals/observations", new
        {
            deviceEventId = eventId, cameraId, plateCandidate = plate, confidence = 0.9, capturedAt = DateTimeOffset.UtcNow
        });

    private HttpClient DeviceClient(string key)
    {
        var client = Client();
        client.DefaultRequestHeaders.Add("X-SparkleWash-Device-Key", key);
        return client;
    }

    [Fact]
    public async Task RegistrationValidatesInputAndOneAccountOwnsOneCarwash()
    {
        (await Client().GetFromJsonAsync<JsonElement>("/api/tenants/registration")).GetProperty("open").GetBoolean().Should().BeTrue();
        (await Client().PostAsJsonAsync("/api/tenants/register", new { idToken = "owner-a", name = "X" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Client().PostAsJsonAsync("/api/tenants/register", new { idToken = "owner-a", name = "Lavado", timeZone = "Mars/Olympus" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await Client().PostAsJsonAsync("/api/tenants/register", new { idToken = "forged", name = "Lavado" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var (token, tenantId) = await Register("owner-a");
        tenantId.Should().StartWith("t");
        var session = await Client(token).GetFromJsonAsync<JsonElement>("/api/auth/session");
        session.GetProperty("tenant").GetProperty("name").GetString().Should().Be("Lavado Central");
        session.GetProperty("tenant").GetProperty("country").GetString().Should().Be("SV");
        session.GetProperty("email").GetString().Should().Be("ana@lavado-a.com");

        (await Client().PostAsJsonAsync("/api/tenants/register", new { idToken = "owner-a", name = "Otro lavado" })).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Client().PostAsJsonAsync("/api/tenants/register", new { idToken = "legacy-admin", name = "Otro lavado" })).StatusCode.Should().Be(HttpStatusCode.Conflict);

        // Signing in later lands in the same carwash, also after a restart.
        await _app.DisposeAsync();
        _app = await Start();
        _base = new Uri(_app.Urls.First());
        var again = await Client(await Login("owner-a")).GetFromJsonAsync<JsonElement>("/api/auth/session");
        again.GetProperty("tenant").GetProperty("id").GetString().Should().Be(tenantId);
        again.GetProperty("role").GetString().Should().Be("admin");
    }

    [Fact]
    public async Task RegistrationCanBeClosed()
    {
        await _app.DisposeAsync();
        _app = await Start("--SPARKLEWASH_REGISTRATION_OPEN", "false");
        _base = new Uri(_app.Urls.First());
        (await Client().GetFromJsonAsync<JsonElement>("/api/tenants/registration")).GetProperty("open").GetBoolean().Should().BeFalse();
        (await Client().PostAsJsonAsync("/api/tenants/register", new { idToken = "owner-a", name = "Lavado" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CarwashesNeverSeeEachOthersData()
    {
        var (tokenA, _) = await Register("owner-a", "Lavado A");
        var (tokenB, _) = await Register("owner-b", "Lavado B");
        using var adminA = Client(tokenA);
        using var adminB = Client(tokenB);
        var (_, keyA) = await AddDevice(adminA, "entrance-cam", "entry");

        var created = await Observe(DeviceClient(keyA), "entrance-cam", "AAA111", "a-1");
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var arrivalId = (await Json(created)).GetProperty("observation").GetProperty("id").GetString();

        (await adminA.GetFromJsonAsync<JsonElement>("/api/arrivals")).GetArrayLength().Should().Be(1);
        (await adminB.GetFromJsonAsync<JsonElement>("/api/arrivals")).GetArrayLength().Should().Be(0);
        using var legacy = Client(await Login("legacy-admin"));
        (await legacy.GetFromJsonAsync<JsonElement>("/api/arrivals")).GetArrayLength().Should().Be(0);
        (await adminB.PostAsJsonAsync($"/api/arrivals/{arrivalId}/confirm", new { plate = "AAA111", vehicleClass = "car" }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await adminB.GetAsync($"/api/arrivals/{arrivalId}/photo")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await adminB.GetFromJsonAsync<JsonElement>("/api/devices")).GetArrayLength().Should().Be(0);
        (await adminB.GetFromJsonAsync<JsonElement>("/api/bays")).GetProperty("stations").GetArrayLength().Should().Be(0);

        // The legacy shared key still feeds the default carwash only.
        using var legacyDevice = Client();
        legacyDevice.DefaultRequestHeaders.Add("X-SparkleWash-Ingest-Key", "legacy-key");
        (await Observe(legacyDevice, "entrance-cam", "LEG001", "l-1")).StatusCode.Should().Be(HttpStatusCode.Created);
        (await legacy.GetFromJsonAsync<JsonElement>("/api/arrivals")).GetArrayLength().Should().Be(1);
        (await adminA.GetFromJsonAsync<JsonElement>("/api/arrivals")).GetArrayLength().Should().Be(1);
    }

    [Fact]
    public async Task DeviceKeysAreBoundToOneCameraAndCanBeRotatedOrDisabled()
    {
        var (token, _) = await Register("owner-a");
        using var admin = Client(token);
        var (deviceId, key) = await AddDevice(admin, "Entrance-Cam", "entry");
        (await admin.PostAsJsonAsync("/api/devices", new { name = "Duplicada", cameraId = "entrance-cam", role = "entry" }))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await admin.PostAsJsonAsync("/api/devices", new { name = "X", cameraId = "bad id!", role = "entry" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await admin.PostAsJsonAsync("/api/devices", new { name = "Cámara", cameraId = "cam-2", role = "lobby" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var listed = (await admin.GetStringAsync("/api/devices"));
        listed.Should().NotContain(key.Split('.')[3]).And.NotContain("keyHash");
        using (var list = JsonDocument.Parse(listed))
        {
            list.RootElement[0].GetProperty("cameraId").GetString().Should().Be("entrance-cam");
            list.RootElement[0].GetProperty("online").GetBoolean().Should().BeFalse();
        }

        (await Observe(DeviceClient(key), "exit-cam", "AAA111", "spoof-1")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await Observe(DeviceClient(key[..^2] + "zz"), "entrance-cam", "AAA111", "bad-1")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await Observe(DeviceClient("swd.tnope.0123456789abcdef.secret"), "entrance-cam", "AAA111", "bad-2")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var beat = await DeviceClient(key).PostAsJsonAsync("/api/devices/heartbeat", new { rssi = -61, uptimeMs = 120000, fps = 2.5, ip = "192.168.1.50", firmware = "1.2.0" });
        beat.StatusCode.Should().Be(HttpStatusCode.OK);
        var device = (await admin.GetFromJsonAsync<JsonElement>("/api/devices"))[0];
        device.GetProperty("online").GetBoolean().Should().BeTrue();
        device.GetProperty("lastStatus").GetProperty("rssi").GetInt32().Should().Be(-61);

        var rotated = await Json(await admin.PostAsync($"/api/devices/{deviceId}/rotate", null));
        var newKey = rotated.GetProperty("deviceKey").GetString()!;
        newKey.Should().NotBe(key);
        (await Observe(DeviceClient(key), "entrance-cam", "AAA111", "old-key")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await Observe(DeviceClient(newKey), "entrance-cam", "AAA111", "new-key")).StatusCode.Should().Be(HttpStatusCode.Created);
        (await admin.GetFromJsonAsync<JsonElement>("/api/devices"))[0].GetProperty("observations").GetInt32().Should().Be(1);

        (await admin.PostAsJsonAsync($"/api/devices/{deviceId}/status", new { disabled = true })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await Observe(DeviceClient(newKey), "entrance-cam", "BBB222", "disabled")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        // The camera id is free again once its device is disabled; re-enabling the old one then conflicts.
        await AddDevice(admin, "entrance-cam", "entry");
        (await admin.PostAsJsonAsync($"/api/devices/{deviceId}/status", new { disabled = false })).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task DeviceRolesDecideWhatASightingMeans()
    {
        var (token, _) = await Register("owner-a");
        using var admin = Client(token);
        var (_, entry) = await AddDevice(admin, "entrance-cam", "entry");
        var (_, bay) = await AddDevice(admin, "bay1-cam", "bay");
        var (_, exit) = await AddDevice(admin, "exit-cam", "exit");

        // Unknown plates seen by bay or exit cameras are noise, not new customers.
        (await Observe(DeviceClient(bay), "bay1-cam", "ZZZ999", "bay-unknown")).StatusCode.Should().Be(HttpStatusCode.Created);
        (await Observe(DeviceClient(exit), "exit-cam", "ZZZ998", "exit-unknown")).StatusCode.Should().Be(HttpStatusCode.Created);
        (await admin.GetFromJsonAsync<JsonElement>("/api/arrivals?pending=true")).GetArrayLength().Should().Be(0);

        var arrival = await Json(await Observe(DeviceClient(entry), "entrance-cam", "P123456", "e-1"));
        var arrivalId = arrival.GetProperty("observation").GetProperty("id").GetString()!;
        (await admin.PostAsJsonAsync($"/api/arrivals/{arrivalId}/confirm", new { plate = "P123456", vehicleClass = "car" })).EnsureSuccessStatusCode();
        var job = await Json(await Send(admin, "/api/jobs", new { arrivalId, packageId = "quick" }, "role-open-1"));
        var jobId = job.GetProperty("id").GetString()!;
        foreach (var (status, key) in new[] { ("queued", "role-queue-1"), ("in_progress", "role-start-1") })
            (await Send(admin, $"/api/jobs/{jobId}/transition", new { status }, key)).EnsureSuccessStatusCode();

        var atBay = await Json(await Observe(DeviceClient(bay), "bay1-cam", "P123456", "bay-known"));
        atBay.GetProperty("trackedJobId").GetString().Should().Be(jobId);
        atBay.GetProperty("suggestComplete").GetBoolean().Should().BeFalse();
        var leaving = await Json(await Observe(DeviceClient(exit), "exit-cam", "P123456", "exit-known"));
        leaving.GetProperty("trackedJobId").GetString().Should().Be(jobId);
        leaving.GetProperty("suggestComplete").GetBoolean().Should().BeTrue();
        leaving.GetProperty("observation").GetProperty("cameraRole").GetString().Should().Be("exit");
    }

    [Fact]
    public async Task ConfirmedArrivalsWithoutAJobStayInReviewUntilDismissed()
    {
        var (token, _) = await Register("owner-a");
        using var admin = Client(token);
        var (_, entry) = await AddDevice(admin, "entrance-cam", "entry");
        var first = (await Json(await Observe(DeviceClient(entry), "entrance-cam", "P777777", "dup-1"))).GetProperty("observation").GetProperty("id").GetString()!;
        (await admin.PostAsJsonAsync($"/api/arrivals/{first}/confirm", new { plate = "P777777", vehicleClass = "car" })).EnsureSuccessStatusCode();
        (await Send(admin, "/api/jobs", new { arrivalId = first, packageId = "quick" }, "dup-open-1")).EnsureSuccessStatusCode();

        // Same car read again at the entrance before the first sighting linked: a duplicate arrival.
        var second = (await Json(await Observe(DeviceClient(entry), "entrance-cam", "P777778", "dup-2"))).GetProperty("observation").GetProperty("id").GetString()!;
        (await admin.PostAsJsonAsync($"/api/arrivals/{second}/confirm", new { plate = "P777777", vehicleClass = "car" })).EnsureSuccessStatusCode();
        (await Send(admin, "/api/jobs", new { arrivalId = second, packageId = "quick" }, "dup-open-2")).StatusCode.Should().Be(HttpStatusCode.Conflict);

        // Before: confirmed arrivals left the queue even though no job was opened. Now they stay visible...
        var pending = await admin.GetFromJsonAsync<JsonElement>("/api/arrivals?pending=true");
        pending.EnumerateArray().Select(x => x.GetProperty("id").GetString()).Should().Equal(second);
        // ...until staff dismiss them with a reason.
        using var viewer = Client(token);
        (await admin.PostAsJsonAsync($"/api/arrivals/{second}/dismiss", new { reason = "hacker" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var dismissed = await Json(await admin.PostAsJsonAsync($"/api/arrivals/{second}/dismiss", new { reason = "duplicate" }));
        dismissed.GetProperty("dismissReason").GetString().Should().Be("duplicate");
        (await admin.GetFromJsonAsync<JsonElement>("/api/arrivals?pending=true")).GetArrayLength().Should().Be(0);
        (await admin.PostAsJsonAsync($"/api/arrivals/{first}/dismiss", new { reason = "duplicate" })).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await Send(admin, "/api/jobs", new { arrivalId = second, packageId = "quick" }, "dup-open-3")).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task AdminsInviteStaffByEmailAndManageRoles()
    {
        var (token, tenantId) = await Register("owner-a");
        using var admin = Client(token);
        (await admin.PostAsJsonAsync("/api/team/invitations", new { email = "not-an-email", role = "operator" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await admin.PostAsJsonAsync("/api/team/invitations", new { email = "carla@example.com", role = "owner" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await admin.PostAsJsonAsync("/api/team/invitations", new { email = " CARLA@example.com ", role = "operator" })).StatusCode.Should().Be(HttpStatusCode.Created);
        (await admin.PostAsJsonAsync("/api/team/invitations", new { email = "carla@example.com", role = "viewer" })).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var dani = await Json(await admin.PostAsJsonAsync("/api/team/invitations", new { email = "dani@example.com", role = "viewer" }));

        // An unverified email can't claim an invitation.
        (await Client().PostAsJsonAsync("/api/auth/google", new { idToken = "unverified" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await admin.DeleteAsync($"/api/team/invitations/{dani.GetProperty("id").GetString()}")).StatusCode.Should().Be(HttpStatusCode.OK);

        var workerToken = await Login("worker");
        using var worker = Client(workerToken);
        var session = await worker.GetFromJsonAsync<JsonElement>("/api/auth/session");
        session.GetProperty("role").GetString().Should().Be("operator");
        session.GetProperty("tenant").GetProperty("id").GetString().Should().Be(tenantId);
        (await worker.GetAsync("/api/team")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await worker.PostAsJsonAsync("/api/devices", new { name = "Cam", cameraId = "x", role = "entry" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var team = await admin.GetFromJsonAsync<JsonElement>("/api/team");
        team.GetProperty("members").GetArrayLength().Should().Be(2);
        team.GetProperty("invitations").GetArrayLength().Should().Be(0);

        // Promoting ends the person's current sessions so the new role applies on next sign-in.
        (await admin.PostAsJsonAsync("/api/team/members/3003/role", new { role = "admin" })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await worker.GetAsync("/api/auth/session")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        using var promoted = Client(await Login("worker"));
        (await promoted.GetAsync("/api/team")).StatusCode.Should().Be(HttpStatusCode.OK);

        (await admin.DeleteAsync("/api/team/members/1001")).StatusCode.Should().Be(HttpStatusCode.Conflict); // yourself
        (await promoted.DeleteAsync("/api/team/members/1001")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await admin.GetAsync("/api/auth/session")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await promoted.PostAsJsonAsync("/api/team/members/3003/role", new { role = "viewer" })).StatusCode.Should().Be(HttpStatusCode.Conflict); // last admin
        (await Client().PostAsJsonAsync("/api/auth/google", new { idToken = "owner-a" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AdminsEditTheCarwashProfile()
    {
        var (token, _) = await Register("owner-a");
        using var admin = Client(token);
        (await admin.PutAsJsonAsync("/api/tenant", new { name = "", country = "SV" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var updated = await Json(await admin.PutAsJsonAsync("/api/tenant", new { name = "Lavado Escalón", city = "San Salvador", country = "SV", timeZone = "America/El_Salvador" }));
        updated.GetProperty("name").GetString().Should().Be("Lavado Escalón");
        (await admin.GetFromJsonAsync<JsonElement>("/api/tenant")).GetProperty("name").GetString().Should().Be("Lavado Escalón");
        var summary = await admin.GetFromJsonAsync<JsonElement>("/api/jobs/summary");
        summary.TryGetProperty("completedToday", out _).Should().BeTrue();
    }

    private static Task<HttpResponseMessage> Send(HttpClient client, string path, object body, string key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key);
        return client.SendAsync(request);
    }
}

public class MultipleClientIdTests
{
    private sealed class PerClient : IGoogleIdentityVerifier
    {
        public Task<string?> VerifySubjectAsync(string idToken, string clientId) => Task.FromResult<string?>(null);
        // Tokens name the client they were issued to, like Google's "aud" claim.
        public Task<GoogleIdentity?> VerifyAsync(string idToken, string clientId) =>
            Task.FromResult(idToken == $"token-for-{clientId}" ? new GoogleIdentity("555", "ios@example.com", true, "iOS") : null);
    }

    [Fact]
    public async Task TokensFromAnyConfiguredClientAreAccepted()
    {
        await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
            "--SPARKLEWASH_GOOGLE_CLIENT_ID", "web-client, ios-client", "--SPARKLEWASH_STAFF_ROLES", "555=viewer",
            "--SPARKLEWASH_TENANTS_DIR", Path.Combine(Path.GetTempPath(), "sparklewash-aud-" + Guid.NewGuid().ToString("N"))], new PerClient());
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        (await client.PostAsJsonAsync("/api/auth/google", new { idToken = "token-for-web-client" })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.PostAsJsonAsync("/api/auth/google", new { idToken = "token-for-ios-client" })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.PostAsJsonAsync("/api/auth/google", new { idToken = "token-for-other-client" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
