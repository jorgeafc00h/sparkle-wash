using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Xunit;

namespace CarwashApi.Tests;

public class N1coWebhookTests
{
    [Fact]
    public async Task SignedEventsAreBoundedDeduplicatedAndPersistedAcrossRestart()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sparklewash-n1co-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            await using (var app = await Start(directory))
            {
                using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
                var body = "{\"orderId\":\"n1co-123\",\"orderReference\":\"wash-1\",\"type\":\"SuccessPayment\"}";
                (await Send(client, body, "wrong", "42")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
                var valid = Signature(body);
                var first = await Send(client, body, valid, "42");
                first.StatusCode.Should().Be(HttpStatusCode.Accepted);
                using (var json = JsonDocument.Parse(await first.Content.ReadAsStringAsync()))
                    json.RootElement.GetProperty("duplicate").GetBoolean().Should().BeFalse();
                var replay = await Send(client, body, valid, "42");
                replay.StatusCode.Should().Be(HttpStatusCode.Accepted);
                using (var json = JsonDocument.Parse(await replay.Content.ReadAsStringAsync()))
                    json.RootElement.GetProperty("duplicate").GetBoolean().Should().BeTrue();
                var alternateDelivery = await Send(client, body, valid, "99");
                using (var json = JsonDocument.Parse(await alternateDelivery.Content.ReadAsStringAsync()))
                    json.RootElement.GetProperty("duplicate").GetBoolean().Should().BeTrue();
                (await Send(client, "{}", Signature("{}"), "43")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
                var oversized = new string('x', 65537);
                (await Send(client, oversized, Signature(oversized), "44")).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
            }
            await using (var restarted = await Start(directory))
            {
                using var client = new HttpClient { BaseAddress = new Uri(restarted.Urls.First()) };
                var body = "{\"orderId\":\"n1co-123\",\"orderReference\":\"wash-1\",\"type\":\"SuccessPayment\"}";
                var response = await Send(client, body, Signature(body), "42");
                using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                json.RootElement.GetProperty("duplicate").GetBoolean().Should().BeTrue();
            }
        }
        finally { Directory.Delete(directory, true); }
    }

    private static string Signature(string body) => Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes("test-secret"), Encoding.UTF8.GetBytes(body)));
    private static Task<HttpResponseMessage> Send(HttpClient client, string body, string signature, string eventId)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/payments/n1co/webhook") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("X-H4B-Hmac-Sha256", signature);
        request.Headers.Add("X-H4B-Event-Id", eventId);
        return client.SendAsync(request);
    }
    private static async Task<WebApplication> Start(string directory)
    {
        var app = CarwashApi.Program.BuildApp(["--urls", "http://127.0.0.1:0", "--SPARKLEWASH_N1CO_WEBHOOK_SECRET", "test-secret",
            "--SPARKLEWASH_N1CO_WEBHOOK_FILE", Path.Combine(directory, "events.json"),
            "--SPARKLEWASH_DATA_FILE", Path.Combine(directory, "stations.json"),
            "--SPARKLEWASH_PHOTO_DIR", Path.Combine(directory, "photos")]);
        await app.StartAsync();
        return app;
    }
}
