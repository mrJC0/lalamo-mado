using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class ReviewThreadsTests
{
    static readonly DateTimeOffset Noon = new(2026, 11, 4, 12, 0, 0, TimeSpan.Zero);

    static AgentAnnotation Annotation(string id, string text, string? replyTo = null, string? quote = null, string? lines = null) =>
        new(id, replyTo is null ? "question" : null, text, "span", quote, lines, null, null, null, ReplyTo: replyTo);

    [Fact]
    public void A_thread_prints_its_quote_lines_and_every_turn_in_order()
    {
        var threads = new ReviewThreads();
        threads.RecordSent(Annotation("a1", "Why?", quote: "The export runs", lines: "13"), Noon);
        threads.RecordReply("a1", "Because of locks.", null, Noon.AddMinutes(1));
        threads.RecordSent(Annotation("a2", "And on Sunday?", replyTo: "a1"), Noon.AddMinutes(2));
        threads.RecordReply("a1", "Then too.", null, Noon.AddMinutes(3));

        var thread = threads.View("a1")!;

        Assert.Equal(("a1", "The export runs", "13"), (thread.Id, thread.Quote, thread.Lines));
        Assert.Equal(["Why?", "Because of locks.", "And on Sunday?", "Then too."], thread.Turns.Select(turn => turn.Text));
        Assert.Equal(["reviewer", "agent", "reviewer", "agent"], thread.Turns.Select(turn => turn.By));
    }

    [Fact]
    public void A_follow_ups_id_leads_to_its_thread()
    {
        var threads = new ReviewThreads();
        threads.RecordSent(Annotation("a1", "Why?"), Noon);
        threads.RecordSent(Annotation("a2", "And then?", replyTo: "a1"), Noon);

        Assert.Equal("a1", threads.RootOf("a2"));
        Assert.Equal("a1", threads.RootOf("a1"));
        Assert.Equal("a1", threads.View("a2")!.Id);
    }

    [Fact]
    public void A_reply_to_no_annotation_is_a_thread_the_reviewer_can_answer()
    {
        var threads = new ReviewThreads();
        threads.RecordReply("r7", "This is the replica I meant.", "reporting replica", Noon);
        threads.RecordSent(Annotation("a1", "Which one?", replyTo: "r7"), Noon.AddMinutes(1));

        var thread = threads.View("r7")!;

        Assert.Equal("reporting replica", thread.Quote);
        Assert.Equal(["agent", "reviewer"], thread.Turns.Select(turn => turn.By));
    }

    [Fact]
    public void An_unknown_thread_has_no_view()
    {
        Assert.Null(new ReviewThreads().View("a9"));
    }
}
