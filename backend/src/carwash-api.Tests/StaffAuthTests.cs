using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Xunit;

namespace CarwashApi.Tests;

/// <summary>
/// A stand-in for the real Google ID-token verifier so the full login →
/// session → sign-out flow can be exercised without hitting Google.
/// Each call returns a fresh deterministic subject; callers can override the
/// subject to drive the role table on their side.
/// </summary>
public sealed class TestIdentityVerifier : CarwashApi.IGoogleIdentityVerifier
{
    private long _counter;
    public string? SubjectOverride { get; set; }

    public Task<string?> VerifySubjectAsync(string idToken, string clientId)
    {
        if (SubjectOverride is not null) return Task.FromResult<string?>(SubjectOverride);
        _counter += 1;
        return Task.FromResult<string?>("subject-" + _counter);
    }
}

public class StaffAuthTests
{
    private static string FreshDirectory()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-auth-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }

    private static Uri BaseAddress(WebApplication app) => new(app.Urls.First());

    private static string BaseUrl(WebApplication app) => app.Urls.First();

    [Fact]
    public async Task LoginFailsClosedWhenGoogleClientIsNotConfigured()
    {
        var directory = FreshDirectory();
        try
        {
            await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
                "--SPARKLEWASH_GOOGLE_CLIENT_ID", "", "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
                "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos")]);
            await app.StartAsync();
            using var client = new HttpClient { BaseAddress = BaseAddress(app) };
            (await client.PostAsJsonAsync("/api/auth/google", new { idToken = "untrusted" })).StatusCode
                .Should().Be(HttpStatusCode.ServiceUnavailable);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task LoginThenGetSessionSucceedsWhenVerifierIsConfigured()
    {
        var directory = FreshDirectory();
        try
        {
            // Use a fixed subject so we can pre-populate the role map with any
            // of the subjects the verifier will return.
            const string testSubject = "1234";
            var verifier = new TestIdentityVerifier { SubjectOverride = testSubject };
            await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
                "--SPARKLEWASH_GOOGLE_CLIENT_ID", "test-client-id",
                "--SPARKLEWASH_STAFF_ROLES", testSubject + "=operator",
                "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
                "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos")], verifier);
            await app.StartAsync();
            using var client = new HttpClient { BaseAddress = BaseAddress(app) };

            // 1) Login with the (fake, trusted) id token.
            var login = await client.PostAsJsonAsync("/api/auth/google", new { idToken = "trusted" });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
            var loginBody = (await login.Content.ReadAsStringAsync());
            using var loginJson = System.Text.Json.JsonDocument.Parse(loginBody);
            var token = loginJson.RootElement.GetProperty("sessionToken").GetString();
            token.Should().NotBeNullOrEmpty();
            loginJson.RootElement.GetProperty("role").GetString().Should().Be("operator");
            loginJson.RootElement.TryGetProperty("expiresAt", out _).Should().BeTrue();

            // 2) GET /api/auth/session with the bearer token returns the role
            var request = new HttpRequestMessage(HttpMethod.Get, BaseUrl(app) + "/api/auth/session")
            {
                Headers = { { "Authorization", $"Bearer {token}" } },
            };
            var session = await client.SendAsync(request);
            session.EnsureSuccessStatusCode();
            var sessionText = await session.Content.ReadAsStringAsync();
            var sessionJson = System.Text.Json.JsonDocument.Parse(sessionText);
            sessionJson.RootElement.GetProperty("role").GetString().Should().Be("operator");
            sessionJson.RootElement.GetProperty("subject").GetString().Should().Be(testSubject);
            sessionJson.RootElement.TryGetProperty("expiresAt", out _).Should().BeTrue();
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task GetSessionWithoutTokenIsUnauthorized()
    {
        var directory = FreshDirectory();
        try
        {
            await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
                "--SPARKLEWASH_GOOGLE_CLIENT_ID", "test-client-id",
                "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
                "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos")]);
            await app.StartAsync();
            using var client = new HttpClient { BaseAddress = BaseAddress(app) };
            var response = await client.GetAsync("/api/auth/session");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task DeleteSessionWithoutTokenIsUnauthorized()
    {
        var directory = FreshDirectory();
        try
        {
            await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
                "--SPARKLEWASH_GOOGLE_CLIENT_ID", "test-client-id",
                "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
                "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos")]);
            await app.StartAsync();
            using var client = new HttpClient { BaseAddress = BaseAddress(app) };
            var response = await client.DeleteAsync("/api/auth/session");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task DeleteSessionSignsOutSuccessfullyWithValidToken()
    {
        var directory = FreshDirectory();
        try
        {
            const string testSubject = "1234";
            var verifier = new TestIdentityVerifier { SubjectOverride = testSubject };
            await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
                "--SPARKLEWASH_GOOGLE_CLIENT_ID", "test-client-id",
                "--SPARKLEWASH_STAFF_ROLES", testSubject + "=operator",
                "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
                "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos")], verifier);
            await app.StartAsync();
            using var client = new HttpClient { BaseAddress = BaseAddress(app) };

            var login = await client.PostAsJsonAsync("/api/auth/google", new { idToken = "trusted" });
            login.StatusCode.Should().Be(HttpStatusCode.OK);
            var loginBody = await login.Content.ReadAsStringAsync();
            using var loginJson = System.Text.Json.JsonDocument.Parse(loginBody);
            var token = loginJson.RootElement.GetProperty("sessionToken").GetString();

            // Sign out.
            var signout = new HttpRequestMessage(HttpMethod.Delete, BaseUrl(app) + "/api/auth/session")
            {
                Headers = { { "Authorization", $"Bearer {token}" } },
            };
            var signoutResponse = await client.SendAsync(signout);
            signoutResponse.StatusCode.Should().Be(HttpStatusCode.OK);
            (await signoutResponse.Content.ReadAsStringAsync()).Should().Contain("ok");

            // The token is no longer valid.
            var followUp = new HttpRequestMessage(HttpMethod.Get, BaseUrl(app) + "/api/auth/session")
            {
                Headers = { { "Authorization", $"Bearer {token}" } },
            };
            (await client.SendAsync(followUp)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

            // A second DELETE is also unauthorized (the session was removed).
            var second = new HttpRequestMessage(HttpMethod.Delete, BaseUrl(app) + "/api/auth/session")
            {
                Headers = { { "Authorization", $"Bearer {token}" } },
            };
            (await client.SendAsync(second)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public async Task LoginIsNotAuthorizedWhenSubjectHasNoRole()
    {
        var directory = FreshDirectory();
        try
        {
            // No SPARKLEWASH_STAFF_ROLES — the role table is empty, so any
            // subject returned by the verifier fails the lookup and the login
            // returns null (Unauthorized).
            var verifier = new TestIdentityVerifier { SubjectOverride = "1234" };
            await using var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0",
                "--SPARKLEWASH_GOOGLE_CLIENT_ID", "test-client-id",
                "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
                "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos")], verifier);
            await app.StartAsync();
            using var client = new HttpClient { BaseAddress = BaseAddress(app) };
            (await client.PostAsJsonAsync("/api/auth/google", new { idToken = "trusted" })).StatusCode
                .Should().Be(HttpStatusCode.Unauthorized);
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void ParseRolesValidatesSubjectIdsAndRoleNames()
    {
        StaffAuth.ParseRoles("1=viewer;2=operator;3=admin;bad;4=;999=hacker;5=operator;6=operato")
            .Should().BeEquivalentTo(new Dictionary<string, string>
            {
                ["1"] = "viewer",
                ["2"] = "operator",
                ["3"] = "admin",
                ["5"] = "operator",
            });
    }
}
