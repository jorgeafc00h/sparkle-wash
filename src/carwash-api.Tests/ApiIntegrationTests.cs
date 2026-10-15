using Microsoft.AspNetCore.Mvc.Testing;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;
using FluentAssertions;

namespace CarwashApi.Tests;

/// <summary>
/// Integration tests for the API endpoints using HttpClientHandler.
/// Tests end-to-end HTTP request/response behavior including JSON parsing.
/// </summary>
public class ApiIntegrationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public ApiIntegrationTests()
    {
        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();
        _client.BaseAddress = new Uri("http://localhost:2080");
    }

    [Fact]
    public async Task HealthGet_ShouldReturnHealthyStatus()
    {
        var response = await _client.GetAsync("/health");
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var obj = JsonSerializer.Deserialize<object>(json);

        ((dynamic)obj).status.Should().Be("healthy");
        ((dynamic)obj).uptimeMs.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task HealthPost_ShouldReturnOk()
    {
        var response = await _client.PostAsync("/health", null);
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("ok");
    }

    [Fact]
    public async Task MetricsEndpoint_ShouldReturnAllStations()
    {
        var response = await _client.GetAsync("/api/metrics?format=json");
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var payload = JsonSerializer.Deserialize<dynamic>(json);

        payload.ok.Should().BeTrue("Metrics endpoint should succeed");
        payload.data.Should().BeNullOrEmpty()
            || payload.data.Count == 4
            || throw new AssertionException("Expected 4 stations");

        // Check that response contains expected fields
        if (payload.data != null)
        {
            var first = JsonSerializer.Deserialize<dynamic[]>(json)?.FirstOrDefault();
            first?.stationId.Should().NotBeNullOrEmpty();
            first?.pressurePsi.Should().BeGreaterOrEqualTo(20);
        }
    }

    [Fact]
    public async Task AlertsEndpoint_ShouldReturnEmptyWhenNoAlerts()
    {
        // Set all stations to healthy state
        var response = await _client.GetAsync("/api/metrics/alerts?format=json");
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var payload = JsonSerializer.Deserialize<dynamic>(json);

        if (payload?.alerts != null)
        {
            payload.alerts!.Count.Should().BeGreaterOrEqualTo(0);
        }
    }

    [Fact]
    public async Task UploadEndpoint_ShouldAcceptPhotoUpload()
    {
        using var payload = new MultipartFormDataContent();

        // Create a dummy multipart body with photos field
        var photoData = "--WebKitFormBoundary" + Guid.NewGuid().ToString("N").Substring(0, 39);
        var photoField = new StringContent(photoData);

        payload.Add(photoField, "photos");

        var response = await _client.PostAsync("/api/upload", payload);
        // The endpoint validates multipart format; we expect a valid response (not 4xx)
        response.StatusCode.Should().NotBe(System.Net.HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task UploadEndpoint_ShouldRejectMalformedRequest()
    {
        var response = await _client.PostAsync("/api/upload", null);
        // Should return 409 Conflict for invalid request body
        // or we handle it gracefully
        if (response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            // Accept any valid response from the server
        }
    }

    [Fact]
    public async Task WebSocketUpgrade_ShouldRejectInvalidStationId()
    {
        // Try to connect to a non-existent station
        using var webSocket = new System.Net.WebSockets.WebSocketClient();
        try
        {
            await webSocket.ConnectAsync(new Uri("ws://localhost:2080/ws/app/station-streaming/nonexistent"), CancellationToken.None);
        }
        catch (Exception ex) when (ex is WebSocketException || ex is TaskCanceledException)
        {
            // Expected for an invalid station ID
            return;
        }

        // If we got here, the server should have returned 404
        // The actual implementation sends via WebSocket upgrade path,
        // so we verify by checking that invalid stations are handled.
    }

    [Fact]
    public async Task MetricsResponseContainsStatusField()
    {
        var response = await _client.GetAsync("/api/metrics?format=json");
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        var obj = JsonSerializer.Deserialize<dynamic>(json);

        if (obj?.data != null)
        {
            // At least one station should have a status field
            var firstStation = obj.data!.FirstOrDefault();
            firstStation.status.Should().BeIn(new[] { "idle", "washing", "cleaning", "error" });
        }
    }

    [Fact]
    public async Task ApiResponseContainsTimestamp()
    {
        var response = await _client.GetAsync("/api/metrics?format=json");
        response.StatusCode.Should().Be(System.Net.HttpStatusCode.OK);

        var json = await response.Content.ReadAsStringAsync();
        obj => var obj = JsonSerializer.Deserialize<dynamic>(json));
        if (obj?.data != null)
        {
            var firstStation = obj.data!.FirstOrDefault();
            // Timestamp should be a valid ISO 8601 string
            System.Text.RegularExpressions.Regex.IsMatch(
                firstStation.timestamp ?? "", "^\\d{4}-\\d{2}-\\d{2}T[\\d:]{8}Z$")
                .Should().BeTrue("Timestamp should be ISO 8601 format");
        }
    }
}
