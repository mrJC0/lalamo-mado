using LalamoMado.Server;

namespace LalamoMado.Tests;

public class AgentEventQueueTests
{
    static readonly TimeSpan Lease = TimeSpan.FromMilliseconds(200);

    static AgentEventQueue WithOneEvent()
    {
        var queue = new AgentEventQueue(Lease);
        queue.Enqueue(seq => new AgentEvent(seq, EventKinds.Send, "d1", 1, "plan.md", DateTimeOffset.Now));
        return queue;
    }

    static Task<AgentEvent?> Take(AgentEventQueue queue, double seconds = 2) =>
        queue.TakeNextAsync("d1", TimeSpan.FromSeconds(seconds), CancellationToken.None);

    [Fact]
    public async Task An_acknowledged_event_is_never_handed_out_again()
    {
        var queue = WithOneEvent();
        var taken = await Take(queue);
        Assert.NotNull(queue.Acknowledge(taken!.Seq));

        Assert.Null(await Take(queue, seconds: 0.6));
        Assert.Equal(Delivery.Delivered, queue.History("d1").Single().State);
    }

    [Fact]
    public async Task An_event_whose_wait_died_before_acknowledging_goes_to_the_next_wait()
    {
        var queue = WithOneEvent();
        var lost = await Take(queue);
        var retaken = await Take(queue);

        Assert.Equal(lost!.Seq, retaken!.Seq);
        Assert.Equal(1, queue.PendingFor("d1"));
    }

    [Fact]
    public async Task A_wait_armed_during_the_lease_wakes_when_the_lease_runs_out()
    {
        var queue = WithOneEvent();
        await Take(queue);
        var started = DateTimeOffset.UtcNow;
        var retaken = await Take(queue);

        Assert.NotNull(retaken);
        Assert.InRange(DateTimeOffset.UtcNow - started, Lease / 2, TimeSpan.FromSeconds(1.5));
    }

    [Fact]
    public async Task Only_the_first_acknowledgement_counts()
    {
        var queue = WithOneEvent();
        var taken = await Take(queue);

        Assert.NotNull(queue.Acknowledge(taken!.Seq));
        Assert.Null(queue.Acknowledge(taken.Seq));
        Assert.Null(queue.Acknowledge(99));
    }
}
