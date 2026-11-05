using System.Collections.Concurrent;
using System.Threading.Channels;

namespace CarwashApi;

public sealed class StationHub
{
    private readonly ConcurrentDictionary<Guid, (string StationId, Channel<StationSnapshot> Channel)> _clients = new();
    private int _count;
    public const int MaxClients = 50;

    public (Guid Id, ChannelReader<StationSnapshot> Reader)? Subscribe(string stationId)
    {
        if (Interlocked.Increment(ref _count) > MaxClients)
        {
            Interlocked.Decrement(ref _count);
            return null;
        }
        var channel = Channel.CreateBounded<StationSnapshot>(new BoundedChannelOptions(1)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        var id = Guid.NewGuid();
        _clients[id] = (stationId, channel);
        return (id, channel.Reader);
    }

    public void Unsubscribe(Guid id)
    {
        if (_clients.TryRemove(id, out var client))
        {
            client.Channel.Writer.TryComplete();
            Interlocked.Decrement(ref _count);
        }
    }

    public void Publish(StationSnapshot snapshot)
    {
        foreach (var client in _clients.Values)
            if (client.StationId == snapshot.StationId) client.Channel.Writer.TryWrite(snapshot);
    }
}
