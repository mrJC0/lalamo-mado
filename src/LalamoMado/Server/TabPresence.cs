namespace LalamoMado.Server;

/// <summary>
/// Is a review page still there? Only the page's own inbox polls count (they carry a tab id), so a stray poller
/// can't fake a tab. A page-close beacon makes the verdict fast; a reload re-polls within the grace and cancels it;
/// silence without a beacon (sleep, crash) waits much longer, and a page that comes back afterwards is "resumed".
/// </summary>
public sealed class TabPresence
{
    public const string Closed = "closed";
    public const string Lost = "lost";

    static readonly TimeSpan LeaveGrace = TimeSpan.FromSeconds(3);
    static readonly TimeSpan LostGrace = TimeSpan.FromSeconds(
        int.TryParse(Environment.GetEnvironmentVariable("EDIT_MD_LOST_GRACE_SECONDS"), out var seconds) && seconds > 0 ? seconds : 45);

    readonly Lock gate = new();
    int activePolls;
    int generation;
    bool leaving;
    bool goneReported;

    public bool Connected
    {
        get { lock (gate) return activePolls > 0; }
    }

    /// <returns>true when this poll brings back a page already reported gone.</returns>
    public bool PollStarted()
    {
        lock (gate)
        {
            activePolls++;
            generation++;
            leaving = false;
            var returning = goneReported;
            goneReported = false;
            return returning;
        }
    }

    public void PollEnded(Action<string> onGone)
    {
        lock (gate)
        {
            if (--activePolls > 0)
                return;
        }
        ScheduleVerdict(onGone);
    }

    public void Leaving(Action<string> onGone)
    {
        lock (gate)
            leaving = true;
        ScheduleVerdict(onGone);
    }

    void ScheduleVerdict(Action<string> onGone)
    {
        int seen;
        TimeSpan grace;
        lock (gate)
        {
            seen = generation;
            grace = leaving ? LeaveGrace : LostGrace;
        }
        _ = Task.Delay(grace).ContinueWith(_ =>
        {
            string reason;
            lock (gate)
            {
                if (activePolls > 0 || seen != generation || goneReported)
                    return;
                goneReported = true;
                reason = leaving ? Closed : Lost;
            }
            onGone(reason);
        }, TaskScheduler.Default);
    }
}
