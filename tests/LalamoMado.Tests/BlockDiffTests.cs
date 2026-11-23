using LalamoMado.Markdown;

namespace LalamoMado.Tests;

public class BlockDiffTests
{
    const string Before = """
        # Plan

        The export runs once per night.

        - Drop the FTP upload.
        - Keep the XML export.

        | Term | Count |
        |---|---:|
        | lorem | 12 |
        | dolor | 31 |
        | ipsum | 7 |

        ```csharp
        if (ready)
            Ship();
        ```

        Closing words.
        """;

    static string Edit(string from, string to) => Before.Replace(from, to);

    static string At(string source, BlockChange change) => source[change.SrcStart..change.SrcEnd];

    static string LineAt(string source, int offset) => source.Split('\n')[source[..offset].Count(c => c == '\n')];

    [Fact]
    public void Identical_text_has_no_changes() => Assert.Empty(BlockDiff.Between(Before, Before));

    [Fact]
    public void A_reflowed_paragraph_is_not_a_change() =>
        Assert.Empty(BlockDiff.Between(Before, Edit("runs once per night.", "runs once\nper   night.")));

    [Fact]
    public void An_edited_paragraph_is_changed_and_keeps_its_old_text()
    {
        var after = Edit("once per night.", "once per night, on the replica.");
        var change = Assert.Single(BlockDiff.Between(Before, after));

        Assert.Equal(ChangeKinds.Changed, change.Kind);
        Assert.Equal("The export runs once per night, on the replica.", At(after, change));
        Assert.Equal("The export runs once per night.", change.Before);
    }

    [Fact]
    public void A_new_paragraph_is_added()
    {
        var after = Edit("Closing words.", "A brand new note about rollout.\n\nClosing words.");
        var change = Assert.Single(BlockDiff.Between(Before, after));

        Assert.Equal(ChangeKinds.Added, change.Kind);
        Assert.Equal("A brand new note about rollout.", At(after, change).Trim());
    }

    [Fact]
    public void A_removed_table_row_is_marked_before_the_row_that_now_follows_it()
    {
        var after = Edit("| dolor | 31 |\n", "");
        var change = Assert.Single(BlockDiff.Between(Before, after));

        Assert.Equal(ChangeKinds.Removed, change.Kind);
        Assert.Equal(change.SrcStart, change.SrcEnd);
        Assert.Equal("| ipsum | 7 |", LineAt(after, change.SrcStart));
        Assert.Equal("| dolor | 31 |", change.Before);
    }

    [Fact]
    public void Blocks_removed_at_the_end_are_marked_at_the_end_of_the_document()
    {
        var after = Before[..Before.IndexOf("```csharp")].TrimEnd();
        var change = Assert.Single(BlockDiff.Between(Before, after));

        Assert.Equal(ChangeKinds.Removed, change.Kind);
        Assert.Equal(after.Length, change.SrcStart);
        Assert.Contains("Ship();", change.Before);
        Assert.EndsWith("Closing words.", change.Before);
    }

    [Fact]
    public void Indentation_matters_in_code() =>
        Assert.Equal(ChangeKinds.Changed, Assert.Single(BlockDiff.Between(Before, Edit("    Ship();", "  Ship();"))).Kind);

    [Fact]
    public void An_edited_list_item_is_changed_alone()
    {
        var after = Edit("Drop the FTP upload.", "Drop the FTP upload next month.");
        var change = Assert.Single(BlockDiff.Between(Before, after));

        Assert.Equal(ChangeKinds.Changed, change.Kind);
        Assert.Equal("Drop the FTP upload next month.", At(after, change));
    }

    [Fact]
    public void A_heading_rewrite_that_keeps_a_word_is_still_one_changed_heading()
    {
        var after = Edit("# Plan", "# Rollout plan for v2");
        var change = Assert.Single(BlockDiff.Between(Before, after));

        Assert.Equal(ChangeKinds.Changed, change.Kind);
        Assert.Equal("# Plan", change.Before);
    }

    [Fact]
    public void A_paragraph_rewritten_in_place_with_no_word_in_common_is_one_changed_block()
    {
        var after = Edit("The export runs once per night.", "Export běží jednou za noc.");
        var change = Assert.Single(BlockDiff.Between(Before, after));

        Assert.Equal(ChangeKinds.Changed, change.Kind);
        Assert.Equal("The export runs once per night.", change.Before);
    }

    [Fact]
    public void A_translated_paragraph_followed_by_a_new_one_pairs_with_the_translation()
    {
        var after = Edit("The export runs once per night.", "Export běží jednou za noc.\n\nA brand new note.");
        var changes = BlockDiff.Between(Before, after);

        Assert.Equal([ChangeKinds.Changed, ChangeKinds.Added], changes.Select(change => change.Kind));
        Assert.Equal("Export běží jednou za noc.", At(after, changes[0]));
    }

    [Fact]
    public void Among_unpaired_blocks_of_one_kind_the_most_similar_takes_the_old_text()
    {
        const string before = "# Doc\n\nOld intro, see [docs](https://example.org/guide).\n";
        const string after = "# Doc\n\nCheck:\n\n- first step\n\nNový úvod, viz [dokumentace](https://example.org/guide).\n";
        var changes = BlockDiff.Between(before, after);
        var changed = Assert.Single(changes, change => change.Kind == ChangeKinds.Changed);

        Assert.StartsWith("Nový úvod", At(after, changed));
        Assert.DoesNotContain(changes, change => change.Kind == ChangeKinds.Removed);
    }

    [Fact]
    public void A_paragraph_replaced_by_a_heading_is_removed_plus_added()
    {
        var after = Edit("The export runs once per night.", "## Completely different");
        var kinds = BlockDiff.Between(Before, after).Select(change => change.Kind).Order();

        Assert.Equal([ChangeKinds.Added, ChangeKinds.Removed], kinds);
    }
}
