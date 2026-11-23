using LalamoMado.Markdown;

namespace LalamoMado.Tests;

public sealed class MarkdownRenderingTests
{
    [Theory]
    [InlineData("skill-picker", "## Skill picker")]
    [InlineData("settings", "## Settings")]
    [InlineData("popover", "# Popover")]
    public void A_heading_cannot_take_the_id_of_an_element_of_the_page(string pageId, string heading)
    {
        foreach (var html in new[] { MarkdownRendering.ToAnnotatableHtml(heading), MarkdownRendering.ToHtml(heading) })
        {
            Assert.DoesNotContain($"id=\"{pageId}\"", html);
            Assert.Contains($"id=\"md-{pageId}\"", html);
        }
    }

    [Fact]
    public void A_link_inside_the_document_still_reaches_its_heading()
    {
        var html = MarkdownRendering.ToAnnotatableHtml("## Skill picker\n\nSee [the picker](#skill-picker).\n");

        Assert.Contains("href=\"#md-skill-picker\"", html);
        Assert.Contains("id=\"md-skill-picker\"", html);
    }

    [Fact]
    public void Front_matter_shows_verbatim_and_annotatable_not_as_a_heading()
    {
        const string skill = "---\nname: xtbl\ndescription: Query with <T> & friends.\nallowed-tools:\n  - Read\n---\n\n# XTbl\n";
        var html = MarkdownRendering.ToAnnotatableHtml(skill);

        Assert.Contains("<pre class=\"front-matter\" data-src-start=\"0\"", html);
        Assert.Contains("name: xtbl\ndescription: Query with &lt;T&gt; &amp; friends.\nallowed-tools:\n  - Read\n</code></pre>", html);
        Assert.DoesNotContain("<hr", html);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(html, "<h[1-6]"));
    }

    [Fact]
    public void A_quote_inside_front_matter_maps_to_its_line()
    {
        const string skill = "---\nname: xtbl\ndescription: Query with XLib.\n---\n\n# XTbl\n";
        var location = new SourceMap(skill).Locate(new TextQuote("Query with XLib", "", "", 0, skill.IndexOf("\n---\n", StringComparison.Ordinal) + 4));

        Assert.True(location.Exact);
        Assert.Equal("3", location.Lines);
    }

    [Fact]
    public void An_explicit_id_is_namespaced_too_and_other_links_stay()
    {
        var html = MarkdownRendering.ToAnnotatableHtml("## Heading {#popover}\n\n[out](https://example.com/page#top)\n");

        Assert.Contains("id=\"md-popover\"", html);
        Assert.Contains("href=\"https://example.com/page#top\"", html);
    }
}
