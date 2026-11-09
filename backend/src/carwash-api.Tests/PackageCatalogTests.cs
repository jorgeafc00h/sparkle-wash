using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Xunit;

namespace CarwashApi.Tests;

[Collection("CarwashApiServer")]
public class PackageCatalogTests : IClassFixture<ServerFixture>
{
    private readonly HttpClient _client;
    public PackageCatalogTests(ServerFixture fixture) => _client = fixture.Client;

    [Fact]
    public async Task ApiPublishesExactSharedMenu()
    {
        var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Contracts", "service-packages.json")));
        var actual = JsonNode.Parse(await _client.GetStringAsync("/api/packages"));
        JsonNode.DeepEquals(actual, expected).Should().BeTrue();
    }

    [Theory]
    [InlineData("car", 15)]
    [InlineData("suv", 18)]
    [InlineData("xl", 21)]
    [InlineData("pickup", 24)]
    public async Task SuggestionUsesVehicleClassPriceWithoutCreatingACharge(string vehicleClass, int expectedPrice)
    {
        var suggestion = JsonNode.Parse(await _client.GetStringAsync("/api/packages/suggestion?vehicleClass=" + vehicleClass))!;
        suggestion["packageId"]!.GetValue<string>().Should().Be("essential");
        suggestion["priceUsd"]!.GetValue<int>().Should().Be(expectedPrice);
        suggestion["reason"]!.GetValue<string>().Should().Contain("staff confirm");
    }

    [Fact]
    public async Task UnknownVehicleClassIsRejected()
    {
        (await _client.GetAsync("/api/packages/suggestion?vehicleClass=bus")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
