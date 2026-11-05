using System.Collections.Concurrent;
using System.Threading.Channels;

namespace CarwashApi;

/// <summary>Fan-out of "something changed" topics to staff consoles, so they refetch right away instead of polling.</summary>
public sealed class ChangeFeed
{
    public const int MaxSubscribers = 100;
    private readonly ConcurrentDictionary<Guid, Channel<string>> _subscribers = new();
    private int _count;

    public (Guid Id, ChannelReader<string> Reader)? Subscribe()
    {
        if (Interlocked.Increment(ref _count) > MaxSubscribers)
        {
            Interlocked.Decrement(ref _count);
            return null;
        }
        // A slow console only needs to know *that* a topic changed; old notifications can be dropped.
        var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(16)
        {
            SingleReader = true,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        var id = Guid.NewGuid();
        _subscribers[id] = channel;
        return (id, channel.Reader);
    }

    public void Unsubscribe(Guid id)
    {
        if (_subscribers.TryRemove(id, out var channel))
        {
            channel.Writer.TryComplete();
            Interlocked.Decrement(ref _count);
        }
    }

    public void Publish(string topic)
    {
        foreach (var channel in _subscribers.Values) channel.Writer.TryWrite(topic);
    }
}
