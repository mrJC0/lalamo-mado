using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class AgentMarksTests : IDisposable
{
    const string Plan = """
        # Plan

        The CSV encoding stays Windows-1250.

        ## Later

        The CSV encoding may move to UTF-8.
        """;

    readonly string folder = Directory.CreateTempSubdirectory("edit-md-marks-").FullName;
    readonly ReviewDocument document;

    string PlanPath => Path.Combine(folder, "plan.md");

    public AgentMarksTests()
    {
        File.WriteAllText(PlanPath, Plan);
        document = new ReviewDocument("d1", PlanPath, new LastSeenVersions(Path.Combine(folder, "last-seen")));
        document.Load();
    }

    public void Dispose() => Directory.Delete(folder, recursive: true);

    async Task<IReadOnlyList<InboxMessage>> Inbox() => await document.Inbox.ReadAfterAsync(0, TimeSpan.Zero, CancellationToken.None);

    [Fact]
    public void A_quote_not_in_the_document_is_reported_and_lines_pick_the_occurrence()
    {
        var placed = document.Mark("decisions", [
            new MarkEntry("decision", "The CSV encoding", "Keep it?", Lines: "7"),
            new MarkEntry("risk", "nightly upload"),
        ]);

        Assert.Equal(1, placed.Placed);
        Assert.Equal(["nightly upload"], placed.NotFound!);
        Assert.Equal("7", placed.Marks[0].Lines);
    }

    [Fact]
    public void Before_picks_a_repeat_within_the_line_and_the_page_gets_the_text_before_it()
    {
        File.WriteAllText(PlanPath, "# Plan\n\nA tick **focuses** at once; a dot focuses later.\n");
        document.Load();

        var placed = document.Mark("verbs", [new MarkEntry("seek", "focuses", Lines: "3", Before: "a dot ")]).Marks.Single();

        Assert.Equal("focuses later.", File.ReadAllText(PlanPath)[placed.SourceStart..].TrimEnd());
        Assert.EndsWith("at once; a dot", placed.Prefix);
    }

    [Fact]
    public async Task A_set_name_in_use_replaces_only_that_set_and_unmark_drops_it()
    {
        document.Mark("decisions", [new MarkEntry("decision", "Windows-1250")]);
        document.Mark("seek: encoding", [new MarkEntry("seek", "UTF-8")]);
        var replaced = document.Mark("decisions", [new MarkEntry("decision", "UTF-8")]);

        Assert.True(document.Unmark("seek: encoding"));
        Assert.False(document.Unmark("seek: encoding"));

        var messages = await Inbox();
        Assert.Equal(["marks", "marks", "marks", "unmark"], messages.Select(m => m.Kind));
        Assert.Equal("UTF-8", messages[2].Marks!.Single().Quote);
        Assert.NotEqual(messages[0].Marks!.Single().Id, replaced.Marks.Single().Id);
    }

    [Fact]
    public async Task Marks_outlive_a_round_and_follow_the_edited_file()
    {
        document.Mark("decisions", [new MarkEntry("decision", "may move to UTF-8")]);
        File.WriteAllText(PlanPath, "# Plan\n\nA new intro line.\n\n" + Plan);
        document.Load();
        document.StartNewRound();

        var carried = Assert.Single(await Inbox());
        Assert.Equal(("marks", "decisions", "11"), (carried.Kind, carried.Set, carried.Marks!.Single().Lines));
    }

    [Fact]
    public void An_annotation_on_a_mark_reaches_the_agent_with_its_mark_id()
    {
        var located = document.Locate(new ClientAnnotation("a1", "comment", "Keep it.", "general", null, MarkId: "m1", MarkSet: "decisions"));

        Assert.Equal(("m1", "decisions"), (located.MarkId, located.MarkSet));
    }
}
