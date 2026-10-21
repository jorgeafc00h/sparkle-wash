using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Linq;
using System.Collections.Generic;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace CarwashApi.Tests;

[Collection("CarwashApiServer")]
public class ServerTests : IClassFixture<ServerFixture>
{
    private readonly HttpClient _client;

    public ServerTests(ServerFixture fixture) => _client = fixture.Client;

    [Fact]
    public async Task Health_Returns200AndHealthyBody()
    {
        var response = await _client.GetAsync("/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("healthy", "health endpoint should report status healthy");
    }

    [Fact]
    public async Task Health_Post_Returns200()
    {
        var response = await _client.PostAsync("/health", new StringContent("{}", Encoding.UTF8, "application/json"));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Metrics_ReturnsAllFourStations()
    {
        var response = await _client.GetAsync("/api/metrics");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("b4c3", "station b4c3 (Bay #1) should be present");
        body.Should().Contain("7d5c", "station 7d5c (Bay #2) should be present");
        body.Should().Contain("a1f2", "station a1f2 (Bay #3) should be present");
        body.Should().Contain("e8f1", "station e8f1 (Bay #4) should be present");
    }

    [Fact]
    public async Task Metrics_HasFlatStationContractAndDemoMarker()
    {
        var response = await _client.GetAsync("/api/metrics");
        using var json = System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.ValueKind.Should().Be(System.Text.Json.JsonValueKind.Array);
        json.RootElement[0].ValueKind.Should().Be(System.Text.Json.JsonValueKind.Object);
        json.RootElement[0].GetProperty("stationId").GetString().Should().Be("b4c3");
        json.RootElement[0].GetProperty("pressurePsi").GetDouble().Should().Be(52);
        response.Headers.GetValues("X-SparkleWash-Data-Source").Single().Should().Be("demo");
    }

    [Theory]
    [InlineData("/healthz")]
    [InlineData("/openapi.json")]
    public async Task DocumentedInfrastructureRoutesExist(string path)
    {
        (await _client.GetAsync(path)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("/ws/app-station-streaming/b4c3")]
    [InlineData("/api/not-implemented")]
    public async Task UnsupportedRoutesNeverReturnSpaSuccess(string path)
    {
        (await _client.GetAsync(path)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Alerts_ReturnsExpectedThresholdAlerts()
    {
        var response = await _client.GetAsync("/api/metrics/alerts");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("lowPressure", "expected lowPressure alert rule");
        body.Should().Contain("highPressure", "expected highPressure alert rule");
    }

    [Fact]
    public async Task Upload_WithMultipartPhotos_ReturnsOkAndUploadId()
    {
        using var content = new MultipartFormDataContent("photos-upload-1234");
        content.Add(new StringContent("{\"stationId\":\"b4c3\"}"), "metadata", "meta.json");
        var response = await _client.PostAsync("/api/upload", content);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("ok", "successful upload should respond with ok");
        body.Should().Contain("uploadId", "successful upload should respond with an uploadId");
    }

    [Fact]
    public async Task Upload_WithoutContentLength_Returns400()
    {
        // Empty body with no content-length exercises the 400 branch.
        var body = await _client.PostAsync("/api/upload", default);
        body.StatusCode.Should().Be(HttpStatusCode.BadRequest, "upload without content-length should be rejected");
    }
}

[CollectionDefinition("CarwashApiServer")]
public class ServerCollection : ICollectionFixture<ServerFixture>
{
}

public class ServerFixture : IAsyncLifetime, IDisposable
{
    private WebApplication _app = null!;
    private string _boundUrl = "";
    public HttpClient Client { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        var app = CarwashApi.Program.BuildApp(new[] { "--urls", "http://127.0.0.1:0" });

        _app = app;
        await app.StartAsync();
        _boundUrl = app.Urls.First(); // http://127.0.0.1:<port>
        Client = new HttpClient { BaseAddress = new Uri(_boundUrl) };

    }

    public async Task DisposeAsync()
    {
        if (_app is not null) { await _app.StopAsync(); await _app.DisposeAsync(); }
        (Client as IDisposable)?.Dispose();
    }

    public void Dispose() => (Client as IDisposable)?.Dispose();
}
