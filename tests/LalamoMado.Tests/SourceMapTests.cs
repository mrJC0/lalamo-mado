using System.Text.RegularExpressions;
using LalamoMado.Markdown;

namespace LalamoMado.Tests;

public class SourceMapTests
{
    const string Source = """
        # Title

        The export runs once per night.
        The export runs on the **reporting replica**.

        - Drop the nightly FTP upload.
        """;

    static readonly SourceMap Map = new(Source);

    static TextQuote InWholeDoc(string quote, string prefix = "", string suffix = "") => new(quote, prefix, suffix, 0, Source.Length);

    [Fact]
    public void Prefix_disambiguates_a_repeated_quote()
    {
        var first = Map.Locate(InWholeDoc("The export runs", prefix: "Title\n"));
        var second = Map.Locate(InWholeDoc("The export runs", prefix: "once per night.\n"));

        Assert.Equal("3", first.Lines);
        Assert.Equal("4", second.Lines);
        Assert.True(second.Exact);
    }

    [Fact]
    public void Quote_across_inline_markup_still_maps_exactly()
    {
        var location = Map.Locate(InWholeDoc("the reporting replica"));

        Assert.True(location.Exact);
        Assert.Equal("the **reporting replica", Source[location.SourceStart..location.SourceEnd]);
    }

    [Fact]
    public void Unmatched_quote_falls_back_to_the_block()
    {
        var blockStart = Source.IndexOf("- Drop", StringComparison.Ordinal);
        var location = Map.Locate(new TextQuote("not in source", "", "", blockStart, Source.Length));

        Assert.False(location.Exact);
        Assert.Equal("6", location.Lines);
    }

    [Fact]
    public void Insert_point_lands_after_the_prefix()
    {
        var location = Map.Locate(InWholeDoc("", prefix: "Drop the nightly"));

        Assert.Equal(location.SourceStart, location.SourceEnd);
        Assert.StartsWith(" FTP upload", Source[location.SourceStart..]);
    }

    [Fact]
    public void Selection_across_a_heading_into_code_markup_maps_exactly()
    {
        const string doc = "# Release checklist\n\nIt is a test document for `edit-md`: select any text.\n";
        var location = new SourceMap(doc).Locate(new TextQuote("Release checklist\nIt is a test document for edit-md: select", "", "", 0, doc.Length));

        Assert.True(location.Exact);
        Assert.Equal("1-3", location.Lines);
        Assert.Equal("Release checklist\n\nIt is a test document for `edit-md`: select", doc[location.SourceStart..location.SourceEnd]);
    }

    [Fact]
    public void Link_text_list_items_and_table_cells_map_exactly()
    {
        const string doc = "- see the [portal](https://x.cz/p) first\n- then **wait**\n\n| Wave | Branch |\n|------|--------|\n| 1    | Brno   |\n";
        var map = new SourceMap(doc);

        var acrossItems = map.Locate(new TextQuote("portal first\nthen wait", "", "", 0, doc.Length));
        var tableCells = map.Locate(new TextQuote("1\nBrno", "", "", 0, doc.Length));

        Assert.True(acrossItems.Exact);
        Assert.Equal("1-2", acrossItems.Lines);
        Assert.True(tableCells.Exact);
        Assert.Equal("6", tableCells.Lines);
    }

    [Theory]
    [InlineData("Run `edit-md serve` first.", "Run edit-md serve", "Run `edit-md serve`")]
    [InlineData("Ship **v2** today.", "Ship v2", "Ship **v2**")]
    [InlineData("See [the portal](https://x.cz) now.", "See the portal", "See [the portal](https://x.cz)")]
    public void Insert_point_at_a_span_end_lands_after_its_closing_syntax(string doc, string renderedPrefix, string sourceBeforePoint)
    {
        var location = new SourceMap(doc).Locate(new TextQuote("", renderedPrefix, "", 0, doc.Length));

        Assert.Equal(sourceBeforePoint, doc[..location.SourceStart]);
        Assert.Equal(location.SourceStart, location.SourceEnd);
    }

    [Fact]
    public void Rendered_blocks_carry_source_offsets_that_cover_their_text()
    {
        var html = MarkdownRendering.ToAnnotatableHtml(Source);
        var heading = Regex.Match(html, "<h1[^>]*data-src-start=\"(\\d+)\" data-src-end=\"(\\d+)\"");

        Assert.True(heading.Success);
        Assert.Equal("# Title", Source[int.Parse(heading.Groups[1].Value)..int.Parse(heading.Groups[2].Value)]);
    }

    [Fact]
    public void Raw_html_and_script_links_are_neutralised()
    {
        var html = MarkdownRendering.ToAnnotatableHtml("<script>alert(1)</script>\n\n[x](javascript:alert(1))");

        Assert.DoesNotContain("<script>", html);
        Assert.DoesNotContain("javascript:", html);
    }

    [Fact]
    public void A_numbered_line_inside_a_paragraph_keeps_its_number()
    {
        const string source = """
            The plan has steps:
            6. is the last one, and it waits.
            """;
        var location = new SourceMap(source).Locate(new TextQuote("steps: 6. is the last", "", "", 0, source.Length));

        Assert.True(location.Exact);
        Assert.Equal("steps:\n6. is the last", source[location.SourceStart..location.SourceEnd].ReplaceLineEndings("\n"));
    }

    [Fact]
    public void A_numbered_list_item_still_drops_its_marker()
    {
        const string source = """
            Steps:

            6. Export
            7. Upload
            """;
        var location = new SourceMap(source).Locate(new TextQuote("Export\nUpload", "", "", 0, source.Length));

        Assert.True(location.Exact);
        Assert.Equal("Export\n7. Upload", source[location.SourceStart..location.SourceEnd].ReplaceLineEndings("\n"));
    }
}
