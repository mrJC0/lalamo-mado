using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class ReviewDocumentTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-document-").FullName;

    public void Dispose() => Directory.Delete(folder, recursive: true);

    [Fact]
    public void A_quote_across_table_cells_reaches_the_agent_without_blank_lines()
    {
        var table = Path.Combine(folder, "table.md");
        File.WriteAllText(table, "| a | b |\n|---|---|\n| one | two |\n");
        var document = new ReviewDocument("d1", table, new LastSeenVersions(Path.Combine(folder, "last-seen")));
        document.Load();

        var located = document.Locate(new ClientAnnotation("a1", "comment", null, "span",
            new ClientAnchor("one\n\n\n\ttwo", "", "", 0, 0, File.ReadAllText(table).Length)));

        Assert.Equal("one\ntwo", located.Quote);
        Assert.True(located.Exact);
    }

    [Fact]
    public void Several_labels_reach_the_agent_with_the_first_as_label_and_one_label_stays_lean()
    {
        var plan = Path.Combine(folder, "plan.md");
        File.WriteAllText(plan, "# Plan\n");
        var document = new ReviewDocument("d1", plan, new LastSeenVersions(Path.Combine(folder, "last-seen")));
        document.Load();

        var several = document.Locate(new ClientAnnotation("a1", "question", "Why?", "general", null, ["question", "change"]));
        var single = document.Locate(new ClientAnnotation("a2", "question", "Why?", "general", null, ["question"]));

        Assert.Null(several.Dictated);
        Assert.True(document.Locate(new ClientAnnotation("a3", "comment", "the secret results", "general", null, SpokenRanges: [[0, 18]])).Dictated);
        Assert.Equal("question", several.Label);
        Assert.Equal(["question", "change"], several.Labels!);
        Assert.Null(single.Labels);
    }

    [Fact]
    public void A_picked_block_is_located_by_its_own_range_with_no_quote_to_find()
    {
        var plan = Path.Combine(folder, "plan.md");
        File.WriteAllText(plan, "# Plan\n\n```mermaid\nflowchart LR\n  a --> b\n```\n");
        var document = new ReviewDocument("d1", plan, new LastSeenVersions(Path.Combine(folder, "last-seen")));
        document.Load();

        var located = document.Locate(new ClientAnnotation("a1", "good", "", AnnotationScopes.Block,
            new ClientAnchor("ab", "", "", 0, 8, 45)));

        Assert.Equal("3-6", located.Lines);
        Assert.True(located.Exact);
        Assert.Equal("ab", located.Quote);
    }

    [Fact]
    public void Named_skills_reach_the_agent()
    {
        var plan = Path.Combine(folder, "plan.md");
        File.WriteAllText(plan, "# Plan\n");
        var document = new ReviewDocument("d1", plan, new LastSeenVersions(Path.Combine(folder, "last-seen")));
        document.Load();

        var located = document.Locate(new ClientAnnotation("a1", "comment", "/probe this", "general", null, Skills: ["probe"]));

        Assert.Equal(["probe"], located.Skills!);
    }

    [Fact]
    public void Locals_transcript_of_a_fix_reaches_the_agent_whole_and_its_differing_spoken_words_as_maybe()
    {
        var plan = Path.Combine(folder, "plan.md");
        File.WriteAllText(plan, "# Plan\n");
        var document = new ReviewDocument("d1", plan, new LastSeenVersions(Path.Combine(folder, "last-seen")));
        document.Load();
        const string text = "Check: the secret results show every mark";
        const string heardByLocal = "Check the seek results show every mark in the chapter.";

        var located = document.Locate(new ClientAnnotation("f1", "comment", text, "general", null,
            SpokenRanges: [[7, text.Length]], Alternatives: [new(text, [heardByLocal])], LocalTranscript: heardByLocal));

        Assert.Equal(heardByLocal, located.LocalTranscript);
        Assert.Equal(["seek"], located.Maybe!["secret"]);
        Assert.Single(located.Maybe!);
    }

    [Fact]
    public void A_follow_up_reaches_the_agent_lean_and_named_after_its_thread()
    {
        var plan = Path.Combine(folder, "plan.md");
        File.WriteAllText(plan, "# Plan\n\nThe export runs at night.\n");
        var document = new ReviewDocument("d1", plan, new LastSeenVersions(Path.Combine(folder, "last-seen")));
        document.Load();
        document.Threads.RecordSent(document.Locate(new ClientAnnotation("a1", "question", "Why?", "span",
            new ClientAnchor("The export runs", "", "", 0, 8, 33))), DateTimeOffset.Now);

        var first = document.Locate(new ClientAnnotation("a2", null, "And on Sunday?", "span", null, ReplyTo: "a1"));
        document.Threads.RecordSent(first, DateTimeOffset.Now);
        var second = document.Locate(new ClientAnnotation("a3", null, "And on Monday?", "span", null, ReplyTo: "a2"));

        Assert.Equal("a1", first.ReplyTo);
        Assert.Null(first.Label);
        Assert.Null(first.Quote);
        Assert.Null(first.Lines);
        Assert.Equal("a1", second.ReplyTo);
    }
}
