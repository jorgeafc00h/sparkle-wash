using System.Text.Json;
using System.Buffers;
using MQTTnet;

namespace CarwashApi;

public sealed class MqttBridge : BackgroundService
{
    private int _subscriptionCount;
    public int SubscriptionCount => Volatile.Read(ref _subscriptionCount);
    private readonly IConfiguration _configuration;
    private readonly StationStore _store;
    private readonly StationHub _hub;
    private readonly ILogger<MqttBridge> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public MqttBridge(IConfiguration configuration, StationStore store, StationHub hub, ILogger<MqttBridge> logger)
    {
        _configuration = configuration;
        _store = store;
        _hub = hub;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = _configuration["SPARKLEWASH_MQTT_HOST"];
        if (string.IsNullOrWhiteSpace(host)) return;
        var user = _configuration["SPARKLEWASH_MQTT_USER"];
        var password = _configuration["SPARKLEWASH_MQTT_PASSWORD"];
        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(password))
        {
            _logger.LogError("MQTT host configured without credentials; bridge disabled");
            return;
        }
        var port = int.TryParse(_configuration["SPARKLEWASH_MQTT_PORT"], out var configuredPort) ? configuredPort : 8883;
        var tls = !string.Equals(_configuration["SPARKLEWASH_MQTT_TLS"], "false", StringComparison.OrdinalIgnoreCase);
        if (!tls && host is not ("localhost" or "127.0.0.1" or "::1"))
        {
            _logger.LogError("Unencrypted MQTT is allowed only for a local broker; bridge disabled");
            return;
        }
        var delaySeconds = 2;
        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();
        client.ApplicationMessageReceivedAsync += async message =>
        {
            var topic = message.ApplicationMessage.Topic.Split('/');
            if (topic.Length != 4 || topic[0] != "sparklewash" || topic[1] != "stations" || topic[3] != "telemetry" ||
                !Program.ValidStationId(topic[2])) return;
            try
            {
                var payload = message.ApplicationMessage.Payload;
                if (payload.Length > 4096) return;
                var input = JsonSerializer.Deserialize<TelemetryInput>(payload.ToArray(), JsonOptions);
                if (!Program.ValidTelemetry(input)) return;
                var saved = await _store.SaveTelemetryAsync(topic[2], input!);
                _hub.Publish(saved);
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Rejected MQTT telemetry message");
            }
        };
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var optionsBuilder = new MqttClientOptionsBuilder()
                    .WithTcpServer(host, port)
                    .WithCredentials(user, password)
                    .WithKeepAlivePeriod(TimeSpan.FromSeconds(15));
                if (tls) optionsBuilder.WithTlsOptions(new MqttClientTlsOptionsBuilder().Build());
                await client.ConnectAsync(optionsBuilder.Build(), stoppingToken);
                await client.SubscribeAsync(factory.CreateSubscribeOptionsBuilder()
                    .WithTopicFilter("sparklewash/stations/+/telemetry").Build(), stoppingToken);
                Interlocked.Increment(ref _subscriptionCount);
                delaySeconds = 2;
                _logger.LogInformation("MQTT telemetry bridge subscribed");
                while (client.IsConnected && !stoppingToken.IsCancellationRequested)
                    await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { _logger.LogWarning(exception, "MQTT bridge disconnected; retrying"); }
            try { await Task.Delay(TimeSpan.FromSeconds(delaySeconds), stoppingToken); }
            catch (OperationCanceledException) { break; }
            delaySeconds = Math.Min(delaySeconds * 2, 30);
        }
    }
}
