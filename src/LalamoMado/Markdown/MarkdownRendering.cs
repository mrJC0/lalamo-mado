using Markdig;
using Markdig.Extensions.Yaml;
using Markdig.Renderers;
using Markdig.Renderers.Html;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace LalamoMado.Markdown;

public static class MarkdownRendering
{
    static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder()
        .UseAdvancedExtensions()
        .UseYamlFrontMatter()
        .UsePreciseSourceLocation()
        .DisableHtml()
        .Build();

    static readonly string[] UnsafeSchemes = ["javascript:", "vbscript:", "data:", "file:"];
    const string IdPrefix = "md-";

    /// <summary>Every rendered block carries data-src-start / data-src-end (exclusive) char offsets into <paramref name="source"/>.</summary>
    public static string ToAnnotatableHtml(string source)
    {
        var document = Markdig.Markdown.Parse(source, Pipeline);
        foreach (var block in document.Descendants<Block>())
        {
            if (block.Span.IsEmpty)
                continue;
            var attributes = block.GetAttributes();
            attributes.AddProperty("data-src-start", block.Span.Start.ToString());
            attributes.AddProperty("data-src-end", (block.Span.End + 1).ToString());
        }
        ScrubUnsafeLinks(document);
        return Render(document);
    }

    internal static MarkdownDocument Parse(string source) => Markdig.Markdown.Parse(source, Pipeline);

    public static string ToHtml(string source)
    {
        var document = Markdig.Markdown.Parse(source, Pipeline);
        ScrubUnsafeLinks(document);
        return Render(document);
    }

    static void ScrubUnsafeLinks(MarkdownDocument document)
    {
        foreach (var link in document.Descendants<LinkInline>())
        {
            var url = link.Url?.Trim() ?? "";
            if (UnsafeSchemes.Any(scheme => url.StartsWith(scheme, StringComparison.OrdinalIgnoreCase)))
                link.Url = "#";
        }
    }

    /// <summary>The page's own elements have ids, and its stylesheet and script find them by id: a heading "Skill picker" must not become #skill-picker.</summary>
    static void NamespaceIds(MarkdownDocument document)
    {
        foreach (var node in document.Descendants())
            if (node.TryGetAttributes() is { Id: { Length: > 0 } id } attributes)
                attributes.Id = IdPrefix + id;
        foreach (var link in document.Descendants<LinkInline>())
            if (link.Url is { Length: > 1 } url && url[0] == '#')
                link.Url = $"#{IdPrefix}{url[1..]}";
    }

    static string Render(MarkdownDocument document)
    {
        NamespaceIds(document);
        using var writer = new StringWriter();
        var renderer = new HtmlRenderer(writer);
        Pipeline.Setup(renderer);
        renderer.ObjectRenderers.ReplaceOrAdd<YamlFrontMatterHtmlRenderer>(new FrontMatterRenderer());
        renderer.Render(document);
        writer.Flush();
        return writer.ToString();
    }

    /// <summary>Markdig drops front matter from the page; a skill's or plan's is worth reading and commenting on, so it shows verbatim.</summary>
    sealed class FrontMatterRenderer : HtmlObjectRenderer<YamlFrontMatterBlock>
    {
        protected override void Write(HtmlRenderer renderer, YamlFrontMatterBlock block)
        {
            renderer.EnsureLine();
            renderer.Write("<pre class=\"front-matter\"").WriteAttributes(block).Write("><code>");
            renderer.WriteLeafRawLines(block, writeEndOfLines: true, escape: true);
            renderer.WriteLine("</code></pre>");
        }
    }
}
