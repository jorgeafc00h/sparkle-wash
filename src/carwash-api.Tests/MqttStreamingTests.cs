using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using MQTTnet;
using MQTTnet.Protocol;
using MQTTnet.Server;
using Xunit;

namespace CarwashApi.Tests;

public class MqttStreamingTests
{
    [Fact]
    public async Task BrokerTelemetryReachesAuthenticatedWebSocketAndReconnects()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        var dataFile = Path.Combine(Path.GetTempPath(), "sparklewash-mqtt-" + Guid.NewGuid().ToString("N"), "stations.json");
        var brokerFactory = new MqttServerFactory();
        using var broker = brokerFactory.CreateMqttServer(brokerFactory.CreateServerOptionsBuilder()
            .WithDefaultEndpoint().WithDefaultEndpointPort(port).WithDefaultEndpointBoundIPAddress(IPAddress.Loopback).WithDefaultEndpointBoundIPV6Address(IPAddress.None).Build());
        var authenticated = 0;
        broker.ValidatingConnectionAsync += request =>
        {
            if (request.UserName != "bridge-user" || request.Password != "bridge-pass")
                request.ReasonCode = MqttConnectReasonCode.BadUserNameOrPassword;
            else Interlocked.Increment(ref authenticated);
            return Task.CompletedTask;
        };
        await broker.StartAsync();
        var app = CarwashApi.Program.BuildApp([
            "--urls", "http://127.0.0.1:0", "--SPARKLEWASH_DATA_FILE", dataFile,
            "--SPARKLEWASH_MQTT_HOST", "127.0.0.1", "--SPARKLEWASH_MQTT_PORT", port.ToString(),
            "--SPARKLEWASH_MQTT_USER", "bridge-user", "--SPARKLEWASH_MQTT_PASSWORD", "bridge-pass",
            "--SPARKLEWASH_MQTT_TLS", "false", "--SPARKLEWASH_STREAM_KEY", "stream-secret",
            "--SPARKLEWASH_STREAM_HEARTBEAT_SECONDS", "1"
        ]);
        try
        {
            await app.StartAsync();
            var bridge = app.Services.GetRequiredService<CarwashApi.MqttBridge>();
            await WaitFor(() => bridge.SubscriptionCount >= 1);
            authenticated.Should().BeGreaterThan(0);
            var address = new Uri(app.Urls.First().Replace("http:", "ws:") + "/ws/app-station-streaming/mqtt-1");
            using var denied = new ClientWebSocket();
            Func<Task> unauthenticated = async () => await denied.ConnectAsync(address, CancellationToken.None);
            await unauthenticated.Should().ThrowAsync<WebSocketException>();
            using var heartbeatSocket = new ClientWebSocket();
            heartbeatSocket.Options.SetRequestHeader("X-SparkleWash-Stream-Key", "stream-secret");
            await heartbeatSocket.ConnectAsync(new Uri(app.Urls.First().Replace("http:", "ws:") + "/ws/app-station-streaming/quiet"), CancellationToken.None);
            using (var heartbeat = await Receive(heartbeatSocket))
                heartbeat.RootElement.GetProperty("type").GetString().Should().Be("heartbeat");
            await heartbeatSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);

            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("X-SparkleWash-Stream-Key", "stream-secret");
            await socket.ConnectAsync(address, CancellationToken.None);
            await Publish(broker, 40);
            using var first = await ReceiveStation(socket);
            first.RootElement.GetProperty("type").GetString().Should().Be("station");
            first.RootElement.GetProperty("station").GetProperty("pressurePsi").GetDouble().Should().Be(40);

            await broker.StopAsync();
            await broker.StartAsync();
            await WaitFor(() => bridge.SubscriptionCount >= 2, TimeSpan.FromSeconds(12));
            await Publish(broker, 55);
            using var second = await ReceiveStation(socket);
            second.RootElement.GetProperty("station").GetProperty("pressurePsi").GetDouble().Should().Be(55);
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
            await broker.StopAsync();
            var directory = Path.GetDirectoryName(dataFile)!;
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void StreamHubEnforcesClientLimit()
    {
        var hub = new CarwashApi.StationHub();
        var subscriptions = Enumerable.Range(0, CarwashApi.StationHub.MaxClients).Select(_ => hub.Subscribe("bay")).ToArray();
        subscriptions.Should().OnlyContain(x => x.HasValue);
        hub.Subscribe("bay").Should().BeNull();
        hub.Unsubscribe(subscriptions[0]!.Value.Id);
        hub.Subscribe("bay").Should().NotBeNull();
    }

    private static async Task Publish(MqttServer broker, int pressure)
    {
        var message = new MqttApplicationMessageBuilder().WithTopic("sparklewash/stations/mqtt-1/telemetry")
            .WithPayload(JsonSerializer.Serialize(new { name = "MQTT bay", status = "washing", pressurePsi = pressure, soapLevelDm = 50 })).Build();
        await broker.InjectApplicationMessage(new InjectedMqttApplicationMessage(message) { SenderClientId = "test-publisher" });
    }

    private static async Task<JsonDocument> Receive(ClientWebSocket socket)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var buffer = new byte[4096];
        var result = await socket.ReceiveAsync(buffer, timeout.Token);
        result.MessageType.Should().Be(WebSocketMessageType.Text);
        return JsonDocument.Parse(buffer.AsMemory(0, result.Count));
    }

    private static async Task<JsonDocument> ReceiveStation(ClientWebSocket socket)
    {
        for (var i = 0; i < 10; i++)
        {
            var frame = await Receive(socket);
            if (frame.RootElement.GetProperty("type").GetString() == "station") return frame;
            frame.Dispose();
        }
        throw new TimeoutException("No station frame received");
    }

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(5));
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("MQTT bridge did not subscribe");
            await Task.Delay(50);
        }
    }
}
