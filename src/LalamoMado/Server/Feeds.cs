namespace LalamoMado.Server;

/// <summary>Append-only log readers replay from a cursor; a page reload re-reads from 0 and loses nothing.</summary>
public sealed class ReplayFeed<T>
{
    readonly List<T> items = [];
    readonly Lock gate = new();
    TaskCompletionSource appended = NewSignal();

    public T Append(Func<long, T> create)
    {
        TaskCompletionSource toRelease;
        T item;
        lock (gate)
        {
            item = create(items.Count + 1);
            items.Add(item);
            toRelease = appended;
            appended = NewSignal();
        }
        toRelease.SetResult();
        return item;
    }

    public async Task<IReadOnlyList<T>> ReadAfterAsync(long after, TimeSpan timeout, CancellationToken cancel)
    {
        Task signal;
        lock (gate)
        {
            if (items.Count > after)
                return items.Skip((int)Math.Max(after, 0)).ToList();
            signal = appended.Task;
        }
        if (!await Signalled(signal, timeout, cancel))
            return [];
        lock (gate)
            return items.Skip((int)Math.Max(after, 0)).ToList();
    }

    internal static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    internal static async Task<bool> Signalled(Task signal, TimeSpan timeout, CancellationToken cancel)
    {
        try
        {
            await signal.WaitAsync(timeout, cancel);
            return true;
        }
        catch (TimeoutException)
        {
            return false;
        }
    }
}

public enum Delivery { Pending, Taken, Delivered, Superseded }

/// <summary>
/// Each event is handed to exactly one <c>edit-md wait</c>; events queue while no waiter is armed.
/// A taken event counts as delivered only once that <c>wait</c> acknowledges it has printed it; unacknowledged past the lease, it goes to the next <c>wait</c>.
/// A pending event the world has since contradicted is superseded, never delivered — the agent only wakes for what is still true.
/// </summary>
public sealed class AgentEventQueue(TimeSpan? ackLease = null)
{
    readonly TimeSpan ackLease = ackLease ?? TimeSpan.FromSeconds(10);
    readonly List<(AgentEvent Event, Delivery State, DateTimeOffset LeaseEnds)> log = [];
    readonly Lock gate = new();
    TaskCompletionSource appended = ReplayFeed<AgentEvent>.NewSignal();
    int armedWaiters;

    public bool AgentListening
    {
        get { lock (gate) return armedWaiters > 0; }
    }

    public AgentEvent Enqueue(Func<long, AgentEvent> create)
    {
        TaskCompletionSource toRelease;
        AgentEvent created;
        lock (gate)
        {
            created = create(log.Count + 1);
            log.Add((created, Delivery.Pending, default));
            toRelease = appended;
            appended = ReplayFeed<AgentEvent>.NewSignal();
        }
        toRelease.SetResult();
        return created;
    }

    public async Task<AgentEvent?> TakeNextAsync(string? docId, TimeSpan timeout, CancellationToken cancel)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        lock (gate)
            armedWaiters++;
        try
        {
            while (true)
            {
                Task signal;
                var now = DateTimeOffset.UtcNow;
                var wakeAt = deadline;
                lock (gate)
                {
                    var index = log.FindIndex(entry => (docId is null || entry.Event.DocId == docId)
                        && (entry.State == Delivery.Pending || entry.State == Delivery.Taken && entry.LeaseEnds <= now));
                    if (index >= 0)
                    {
                        log[index] = (log[index].Event, Delivery.Taken, now + ackLease);
                        return log[index].Event;
                    }
                    foreach (var entry in log)
                        if (entry.State == Delivery.Taken && entry.LeaseEnds < wakeAt && (docId is null || entry.Event.DocId == docId))
                            wakeAt = entry.LeaseEnds;
                    signal = appended.Task;
                }
                var remaining = wakeAt - now;
                if (remaining > TimeSpan.Zero && await ReplayFeed<AgentEvent>.Signalled(signal, remaining, cancel))
                    continue;
                if (DateTimeOffset.UtcNow >= deadline)
                    return null;
            }
        }
        finally
        {
            lock (gate)
                armedWaiters--;
        }
    }

    /// <returns>how many pending events were withdrawn.</returns>
    public int Supersede(Func<AgentEvent, bool> contradicted)
    {
        lock (gate)
        {
            var withdrawn = 0;
            for (var i = 0; i < log.Count; i++)
            {
                if (log[i].State != Delivery.Pending || !contradicted(log[i].Event))
                    continue;
                log[i] = (log[i].Event, Delivery.Superseded, default);
                withdrawn++;
            }
            return withdrawn;
        }
    }

    /// <returns>the event, the first time its taker confirms it reached the agent; null for an unknown, untaken or already confirmed seq.</returns>
    public AgentEvent? Acknowledge(long seq)
    {
        lock (gate)
        {
            var index = (int)seq - 1;
            if (index < 0 || index >= log.Count || log[index].State != Delivery.Taken)
                return null;
            log[index] = (log[index].Event, Delivery.Delivered, default);
            return log[index].Event;
        }
    }

    public int PendingFor(string docId)
    {
        lock (gate)
            return log.Count(entry => entry.State is Delivery.Pending or Delivery.Taken && entry.Event.DocId == docId);
    }

    public IReadOnlyList<(AgentEvent Event, Delivery State)> History(string? docId)
    {
        lock (gate)
            return log.Where(entry => docId is null || entry.Event.DocId == docId).Select(entry => (entry.Event, entry.State)).ToList();
    }
}
