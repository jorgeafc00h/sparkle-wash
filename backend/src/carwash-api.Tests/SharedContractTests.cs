using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;

namespace CarwashApi.Tests;

[Collection("CarwashApiServer")]
public class SharedContractTests : IClassFixture<ServerFixture>
{
    private readonly HttpClient _client;
    public SharedContractTests(ServerFixture fixture) => _client = fixture.Client;

    [Theory]
    [InlineData("/api/metrics", "stations.json")]
    [InlineData("/api/metrics/alerts", "alerts.json")]
    public async Task DemoRoutesMatchSharedFixtures(string route, string fixtureName)
    {
        using var expected = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Contracts", fixtureName)));
        var response = await _client.GetAsync(route);
        response.EnsureSuccessStatusCode();
        response.Headers.GetValues("X-SparkleWash-Data-Source").Single().Should().Be("demo");
        using var actual = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        actual.RootElement.GetArrayLength().Should().Be(expected.RootElement.GetArrayLength());
        for (var i = 0; i < expected.RootElement.GetArrayLength(); i++)
        {
            foreach (var property in expected.RootElement[i].EnumerateObject())
            {
                var liveValue = actual.RootElement[i].GetProperty(property.Name);
                if (property.Name == "timestamp")
                    DateTimeOffset.TryParse(liveValue.GetString(), out _).Should().BeTrue();
                else if (property.Value.ValueKind == JsonValueKind.Number)
                    liveValue.GetDouble().Should().Be(property.Value.GetDouble());
                else
                    liveValue.ToString().Should().Be(property.Value.ToString());
            }
        }
    }
}
