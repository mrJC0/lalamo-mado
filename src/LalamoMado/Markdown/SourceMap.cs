using Markdig.Syntax;

namespace LalamoMado.Markdown;

public sealed record TextQuote(string Quote, string Prefix, string Suffix, int BlockStart, int BlockEnd);

/// <param name="Exact">false when the quote could not be found in the source and the location falls back to the enclosing block(s).</param>
public sealed record SourceLocation(int StartLine, int EndLine, int SourceStart, int SourceEnd, bool Exact)
{
    public string Lines => StartLine == EndLine ? $"{StartLine}" : $"{StartLine}-{EndLine}";
}

public sealed class SourceMap
{
    const int PointContext = 24;

    readonly string source;
    readonly int[] lineStarts;
    readonly HashSet<int> listMarkers;

    public SourceMap(string source)
    {
        this.source = source;
        listMarkers = [.. MarkdownRendering.Parse(source).Descendants<ListItemBlock>().Select(item => item.Span.Start)];
        var starts = new List<int> { 0 };
        for (var i = 0; i < source.Length; i++)
            if (source[i] == '\n')
                starts.Add(i + 1);
        lineStarts = [.. starts];
    }

    /// <param name="lines">"13" or "13-15", 1-based; out of range clamps to the document.</param>
    public (int Start, int End) SpanOfLines(string lines)
    {
        var parts = lines.Split('-', 2);
        if (!int.TryParse(parts[0], out var first))
            return (0, source.Length);
        var last = parts.Length > 1 && int.TryParse(parts[1], out var end) ? end : first;
        var start = lineStarts[Math.Clamp(first, 1, lineStarts.Length) - 1];
        return (start, last < lineStarts.Length ? lineStarts[Math.Max(last, 1)] : source.Length);
    }

    /// <summary>The text before <paramref name="offset"/> as it renders, from up to two lines back — enough to tell repeats apart.</summary>
    public string PlainBefore(int offset, int length = 40)
    {
        var from = lineStarts[Math.Max(LineOf(offset) - 3, 0)];
        var plain = PlainProjection.Of(source, from, offset, listMarkers).Text;
        return plain[Math.Max(0, plain.Length - length)..];
    }

    public int LineOf(int offset)
    {
        var index = Array.BinarySearch(lineStarts, Math.Clamp(offset, 0, source.Length));
        return (index >= 0 ? index : ~index - 1) + 1;
    }

    public SourceLocation Locate(TextQuote anchor)
    {
        var blockStart = Math.Clamp(anchor.BlockStart, 0, source.Length);
        var blockEnd = Math.Clamp(anchor.BlockEnd, blockStart, source.Length);

        var match = anchor.Quote.Length == 0
            ? FindPoint(blockStart, blockEnd, anchor.Prefix)
            : FindQuote(blockStart, blockEnd, anchor.Quote, anchor.Prefix);

        return match is (int start, int end) ? At(start, end, exact: true) : At(blockStart, blockEnd, exact: false);
    }

    /// <summary>A whole block picked by itself: its own range is the location, with no quote to find.</summary>
    public SourceLocation LocateBlock(int start, int end)
    {
        var blockStart = Math.Clamp(start, 0, source.Length);
        return At(blockStart, Math.Clamp(end, blockStart, source.Length), exact: true);
    }

    SourceLocation At(int start, int end, bool exact)
    {
        var lastCharOfSpan = end > start ? end - 1 : start;
        while (lastCharOfSpan > start && source[lastCharOfSpan] is '\n' or '\r')
            lastCharOfSpan--;
        return new(LineOf(start), LineOf(lastCharOfSpan), start, end, exact);
    }

    (int Start, int End)? FindQuote(int blockStart, int blockEnd, string quote, string prefix)
    {
        var region = source[blockStart..blockEnd];
        var verbatim = AllIndexesOf(region, quote).ToList();
        if (verbatim.Count > 0)
        {
            var at = verbatim.MaxBy(i => CommonSuffixLength(region[..i], prefix));
            return (blockStart + at, blockStart + at + quote.Length);
        }

        var plain = PlainProjection.Of(source, blockStart, blockEnd, listMarkers);
        var needle = PlainProjection.Normalize(quote);
        var plainPrefix = PlainProjection.Normalize(prefix);
        var candidates = AllIndexesOf(plain.Text, needle).ToList();
        if (needle.Length == 0 || candidates.Count == 0)
            return null;
        var best = candidates.MaxBy(i => CommonSuffixLength(plain.Text[..i], plainPrefix));
        return plain.ToSource(best, best + needle.Length);
    }

    (int Start, int End)? FindPoint(int blockStart, int blockEnd, string prefix)
    {
        var plain = PlainProjection.Of(source, blockStart, blockEnd, listMarkers);
        var plainPrefix = PlainProjection.Normalize(prefix);
        if (plainPrefix.Length == 0)
            return (blockStart, blockStart);
        var tail = plainPrefix[^Math.Min(plainPrefix.Length, PointContext)..];
        var candidates = AllIndexesOf(plain.Text, tail).ToList();
        if (candidates.Count == 0)
            return null;
        var best = candidates.MaxBy(i => CommonSuffixLength(plain.Text[..(i + tail.Length)], plainPrefix));
        var point = PastClosingMarkup(plain.ToSource(best, best + tail.Length).End, blockEnd);
        return (point, point);
    }

    /// <summary>A caret at the end of `code`, **bold** or [link](url) belongs after the closing syntax, not inside the span.</summary>
    int PastClosingMarkup(int point, int end)
    {
        while (point < end && source[point] is '*' or '_' or '`' or '~')
            point++;
        if (point + 1 < end && source[point] == ']' && source[point + 1] == '(')
        {
            var close = source.IndexOf(')', point + 2);
            if (close >= 0 && close < end)
                point = close + 1;
        }
        return point;
    }

    static int CommonSuffixLength(string a, string b)
    {
        var n = 0;
        while (n < a.Length && n < b.Length && a[a.Length - 1 - n] == b[b.Length - 1 - n])
            n++;
        return n;
    }

    static IEnumerable<int> AllIndexesOf(string text, string value)
    {
        if (value.Length == 0)
            yield break;
        for (var i = text.IndexOf(value, StringComparison.Ordinal); i >= 0; i = text.IndexOf(value, i + 1, StringComparison.Ordinal))
            yield return i;
    }
}

/// <summary>
/// The markdown source with its syntax dropped and whitespace collapsed, so it reads like the rendered text;
/// every projected char remembers its source offset. The rendered quote is normalized the same way, then
/// matched by plain IndexOf — markup inside words, links, list/quote/heading markers and table pipes stop mattering.
/// </summary>
sealed class PlainProjection
{
    static readonly char[] InlineMarkup = ['*', '_', '`', '~', '\\', '[', ']'];

    readonly List<int> sourceIndex = [];
    readonly System.Text.StringBuilder text = new();

    public string Text { get; private set; } = "";

    /// <param name="listMarkers">Where real list items start: "6. " opening a line inside a paragraph is text, not a marker.</param>
    public static PlainProjection Of(string source, int start, int end, IReadOnlySet<int> listMarkers)
    {
        var projection = new PlainProjection();
        var i = start;
        var atLineStart = i == 0 || source[i - 1] == '\n';
        while (i < end)
        {
            if (atLineStart)
            {
                i = SkipLineMarkers(source, i, end, listMarkers, out var skipWholeLine);
                atLineStart = false;
                if (skipWholeLine)
                {
                    while (i < end && source[i] != '\n')
                        i++;
                    continue;
                }
                if (i >= end)
                    break;
            }

            var c = source[i];
            if (c == '\n')
                atLineStart = true;
            if (c == ']' && i + 1 < end && source[i + 1] == '(')
            {
                var close = source.IndexOf(')', i + 2);
                i = close < 0 || close >= end ? end : close + 1;
                continue;
            }
            if (c == '!' && i + 1 < end && source[i + 1] == '[')
            {
                i++;
                continue;
            }
            if (Array.IndexOf(InlineMarkup, c) >= 0)
            {
                i++;
                continue;
            }
            projection.Emit(char.IsWhiteSpace(c) || c == '|' ? ' ' : c, i);
            i++;
        }
        projection.Text = projection.text.ToString().TrimEnd();
        return projection;
    }

    public static string Normalize(string rendered)
    {
        var projection = new PlainProjection();
        for (var i = 0; i < rendered.Length; i++)
        {
            var c = rendered[i];
            if (Array.IndexOf(InlineMarkup, c) >= 0)
                continue;
            projection.Emit(char.IsWhiteSpace(c) || c == '|' ? ' ' : c, i);
        }
        return projection.text.ToString().Trim();
    }

    public (int Start, int End) ToSource(int plainStart, int plainEnd) =>
        (sourceIndex[plainStart], sourceIndex[plainEnd - 1] + 1);

    void Emit(char c, int at)
    {
        if (c == ' ' && (text.Length == 0 || text[^1] == ' '))
            return;
        text.Append(c);
        sourceIndex.Add(at);
    }

    /// <summary>Block syntax that never reaches the rendered text: indentation, quote / heading / list / task markers, fences, table rules.</summary>
    static int SkipLineMarkers(string source, int i, int end, IReadOnlySet<int> listMarkers, out bool skipWholeLine)
    {
        skipWholeLine = false;
        while (true)
        {
            while (i < end && source[i] is ' ' or '\t')
                i++;
            if (i >= end)
                return i;
            if (source[i] == '>')
            {
                i++;
                continue;
            }
            if (StartsWith(source, i, "```") || StartsWith(source, i, "~~~") || IsTableRule(source, i, end))
            {
                skipWholeLine = true;
                return i;
            }
            var heading = i;
            while (heading < end && source[heading] == '#')
                heading++;
            if (heading > i && heading < end && source[heading] == ' ')
                return heading + 1;
            if (!listMarkers.Contains(i))
                return i;
            if (source[i] is '-' or '*' or '+' && i + 1 < end && source[i + 1] == ' ')
            {
                i = SkipTaskBox(source, i + 2, end);
                continue;
            }
            var digits = i;
            while (digits < end && char.IsAsciiDigit(source[digits]))
                digits++;
            if (digits > i && digits + 1 < end && source[digits] is '.' or ')' && source[digits + 1] == ' ')
            {
                i = digits + 2;
                continue;
            }
            return i;
        }
    }

    static int SkipTaskBox(string source, int i, int end) =>
        i + 3 < end && source[i] == '[' && source[i + 1] is ' ' or 'x' or 'X' && source[i + 2] == ']' && source[i + 3] == ' ' ? i + 4 : i;

    static bool IsTableRule(string source, int i, int end)
    {
        var lineEnd = source.IndexOf('\n', i);
        var line = source.AsSpan(i, (lineEnd < 0 || lineEnd > end ? end : lineEnd) - i).TrimEnd();
        return line.Length > 2 && line.Contains('-') && line.IndexOfAnyExcept("|-: ") < 0;
    }

    static bool StartsWith(string source, int i, string value) =>
        string.CompareOrdinal(source, i, value, 0, value.Length) == 0;
}
