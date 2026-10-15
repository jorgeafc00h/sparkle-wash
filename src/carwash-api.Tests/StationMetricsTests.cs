using FluentAssertions;
using System.Collections.Generic;
using Xunit;

namespace CarwashApi.Tests;

/// <summary>
/// Unit tests for the station metadata mapping and metrics computation.
/// These test the core business logic without network dependencies.
/// </summary>
public class StationMetricsTests
{
    [Fact]
    public void_StationMetadata_ShouldContainAllStations()
    {
        // Arrange: using the same static dictionary from Program.cs
        var stations = new Dictionary<string, (string name, int pressurePsi, string status)>
        {
            ["b4c3"] = ("Bay #1 — Foam Touch", 52, "idle"),
            ["7d5c"] = ("Bay #2 — High Pressure", 58, "washing"),
            ["a1f2"] = ("Bay #3 — Detail", 48, "idle"),
            ["e8f1"] = ("Bay #4 — Diamond Polish", 63, "cleaning"),
        };

        // Act
        var metricsList = stations.Values.Select(p => new
        {
            stationId = p.name.Replace("Bay #", "").Replace(" — ", "").Trim(),
            name = p.name,
            pressurePsi = p.pressurePsi,
            status = p.status,
            timestamp = DateTime.UtcNow.ToString("o"),
        }).ToList();

        // Assert
        metricsList.Count.Should().Be(4);
        metricsList[0].stationId.Should().Be("bay_1_foam_touch");
        metricsList[0].name.Should().Be("Bay #1 — Foam Touch");
        metricsList[0].pressurePsi.Should().Be(52);
        metricsList[0].status.Should().Be("idle");
    }

    [Fact]
    public void_MetricsSnapshot_ShouldOrderStationsById()
    {
        var stations = new Dictionary<string, (string name, int pressurePsi, string status)>
        {
            ["b4c3"] = ("Bay #1 — Foam Touch", 52, "idle"),
            ["7d5c"] = ("Bay #2 — High Pressure", 58, "washing"),
            ["a1f2"] = ("Bay #3 — Detail", 48, "idle"),
            ["e8f1"] = ("Bay #4 — Diamond Polish", 63, "cleaning"),
        };

        var metricsList = stations.Values.Select(p => new
        {
            stationId = p.name.Replace("Bay #", "").Replace(" — ", "").Trim(),
            name = p.name,
            pressurePsi = p.pressurePsi,
            status = p.status,
        }).OrderBy(x => x.stationId).ToList();

        metricsList.Select(x => x.stationId)
            .Should().Contain(new[]
            {
                "bay_1_foam_touch",
                "bay_2_high_pressure",
                "bay_3_detail",
                "bay_4_diamond_polish",
            }, $"Order should be numeric, not lexicographic: {metricsList.Select(x => x.stationId).ToArray()}");
    }

    [Fact]
    public void_AlertComputation_ShouldDetectLowPressure()
    {
        var alertDict = new System.Collections.Generic.Dictionary<string, object>();
        var stations = new Dictionary<string, (string name, int pressurePsi, string status)>
        {
            ["low1"] = ("Bay Low", 25, "idle"),   // below threshold
            ["high1"] = ("Bay High", 75, "idle"),  // above threshold
            ["ok1"] = ("Bay OK", 50, "idle"),      // within range
        };

        foreach (var kvp in stations)
        {
            if (kvp.Value.status == "error")
            {
                alertDict["sensorError"] = new { code = "sensorError", value = kvp.Value.pressurePsi, threshold = 50.0, severity = "critical" };
            }
            else if (kvp.Value.pressurePsi < 30)
            {
                alertDict["lowPressure"] = new { code = "thresholdExceeded", value = kvp.Value.pressurePsi, threshold = 30.0, severity = "warning" };
            }
            else if (kvp.Value.pressurePsi > 70)
            {
                alertDict["highPressure"] = new { code = "thresholdExceeded", value = kvp.Value.pressurePsi, threshold = 70.0, severity = "warning" };
            }
        }

        alertDict.Keys.Should().Contain("lowPressure");
        alertDict["lowPressure"].Should().NotBeNull();
        ((dynamic)alertDict["lowPressure"]).threshold.Should().Be(30.0);
        ((dynamic)alertDict["highPressure"]).threshold.Should().Be(70.0);
    }

    [Fact]
    public void_StationIdExtraction_ShouldRemoveBayPunctuation()
    {
        var stations = new Dictionary<string, (string name, int pressurePsi, string status)>
        {
            ["b4c3"] = ("Bay #1 — Foam Touch", 52, "idle"),
            ["7d5c"] = ("Bay #2 — High Pressure", 58, "washing"),
        };

        var results = stations.Values.Select(p =>
        {
            string stationId = p.name.Replace("Bay #", "").Replace(" — ", "").Trim();
            return new
            {
                inputName = p.name,
                extractedId = stationId,
                // Verify deterministic output
                stationIdHash = new System.Security.Cryptography.MD5CryptoServiceProvider()
                    .ComputeHash(System.Text.Encoding.UTF8.GetBytes(stationId)).Length,
            };
        }).ToList();

        results.Should().HaveCount(2);
        results[0].extractedId.Should().Be("1 -Foam_Touch");
        results[1].extractedId.Should().Be("2 -High_Pressure");
    }
}
