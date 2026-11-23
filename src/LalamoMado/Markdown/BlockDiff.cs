using System.Text.RegularExpressions;
using Markdig.Extensions.Tables;
using Markdig.Syntax;

namespace LalamoMado.Markdown;

public static class ChangeKinds
{
    public const string Added = "added";
    public const string Changed = "changed";
    public const string Removed = "removed";
}

/// <param name="SrcStart">Offset into the new source; a removal is a point (<c>SrcStart == SrcEnd</c>) before the block that now follows it.</param>
/// <param name="Before">The old markdown of a changed block, or of the removed blocks.</param>
public sealed record BlockChange(string Kind, int SrcStart, int SrcEnd, string? Before = null);

/// <summary>
/// Which blocks changed between two versions of a document: the page marks where, the left pane shows what each said before.
/// The unit is a leaf block — paragraph, heading, code block, thematic break — or a table row; lists and quotes are not units, their leaves are.
/// </summary>
public static partial class BlockDiff
{
    const double SameBlockSimilarity = 0.5;
    const double SameKindSimilarity = 0.25;
    const long MaxComparisons = 4_000_000;

    readonly record struct Unit(int Start, int End, string Text, string Key, string Kind);

    public static BlockChange[] Between(string before, string after)
    {
        var old = Units(before);
        var now = Units(after);
        var changes = new List<BlockChange>();
        var (oldAt, newAt) = (0, 0);
        foreach (var (oldSurvivor, newSurvivor) in Survivors(old, now).Append((old.Count, now.Count)))
        {
            AddHunkChanges(old[oldAt..oldSurvivor], now[newAt..newSurvivor], newSurvivor < now.Count ? now[newSurvivor].Start : after.Length, changes);
            (oldAt, newAt) = (oldSurvivor + 1, newSurvivor + 1);
        }
        return [.. changes];
    }

    // Inside a hunk the old and new blocks first pair up in order by shared words: a pair is one edited block.
    static void AddHunkChanges(List<Unit> old, List<Unit> now, int nextSurvivorStart, List<BlockChange> changes)
    {
        var (oldAt, newAt) = (0, 0);
        foreach (var (oldEdit, newEdit) in WordSimilarPairs(old, now).Append((old.Count, now.Count)))
        {
            var gapEnd = newEdit < now.Count ? now[newEdit].Start : nextSurvivorStart;
            AddGapChanges(old[oldAt..oldEdit], now[newAt..newEdit], gapEnd, changes);
            if (newEdit < now.Count)
                changes.Add(new(ChangeKinds.Changed, now[newEdit].Start, now[newEdit].End, old[oldEdit].Text));
            (oldAt, newAt) = (oldEdit + 1, newEdit + 1);
        }
    }

    static List<(int Old, int New)> WordSimilarPairs(List<Unit> old, List<Unit> now)
    {
        var pairs = new List<(int, int)>();
        var oldAt = 0;
        for (var newAt = 0; newAt < now.Count; newAt++)
        {
            var match = old.FindIndex(oldAt, candidate => IsEditOf(candidate, now[newAt]));
            if (match < 0)
                continue;
            pairs.Add((match, newAt));
            oldAt = match + 1;
        }
        return pairs;
    }

    // What the word pass left unpaired may still be a block rewritten in place — a translation shares no words.
    // Same-kind blocks are aligned in order to pair as many as possible, then to maximize total similarity; ties pair early.
    static void AddGapChanges(List<Unit> old, List<Unit> now, int gapEnd, List<BlockChange> changes)
    {
        var best = new (int Pairs, double Similarity)[old.Count + 1, now.Count + 1];
        for (var i = old.Count - 1; i >= 0; i--)
            for (var j = now.Count - 1; j >= 0; j--)
                best[i, j] = Max(ScoreIfPaired(old, now, i, j, best), Max(best[i + 1, j], best[i, j + 1]));

        var removed = new List<Unit>();
        var (oldAt, newAt) = (0, 0);
        while (newAt < now.Count)
        {
            if (oldAt < old.Count && best[oldAt, newAt] == ScoreIfPaired(old, now, oldAt, newAt, best))
            {
                FlushRemoved(removed, now[newAt].Start, changes);
                changes.Add(new(ChangeKinds.Changed, now[newAt].Start, now[newAt].End, old[oldAt].Text));
                (oldAt, newAt) = (oldAt + 1, newAt + 1);
            }
            else if (oldAt < old.Count && best[oldAt, newAt] == best[oldAt + 1, newAt])
                removed.Add(old[oldAt++]);
            else
            {
                FlushRemoved(removed, now[newAt].Start, changes);
                changes.Add(new(ChangeKinds.Added, now[newAt].Start, now[newAt].End));
                newAt++;
            }
        }
        removed.AddRange(old[oldAt..]);
        FlushRemoved(removed, gapEnd, changes);
    }

    static (int Pairs, double Similarity) ScoreIfPaired(List<Unit> old, List<Unit> now, int i, int j, (int Pairs, double Similarity)[,] best) =>
        old[i].Kind == now[j].Kind
            ? (best[i + 1, j + 1].Pairs + 1, best[i + 1, j + 1].Similarity + Similarity(old[i].Key, now[j].Key))
            : (-1, 0);

    static (int Pairs, double Similarity) Max((int Pairs, double Similarity) a, (int Pairs, double Similarity) b) =>
        a.Pairs != b.Pairs ? (a.Pairs > b.Pairs ? a : b) : (a.Similarity >= b.Similarity ? a : b);

    // Blocks of one kind (a heading of the same level, a table row) still pair when a short rewrite kept only a few words.
    static bool IsEditOf(Unit old, Unit now)
    {
        var similarity = Similarity(old.Key, now.Key);
        return similarity >= SameBlockSimilarity || old.Kind == now.Kind && similarity >= SameKindSimilarity;
    }

    static void FlushRemoved(List<Unit> removed, int at, List<BlockChange> changes)
    {
        if (removed.Count == 0)
            return;
        changes.Add(new(ChangeKinds.Removed, at, at, string.Join("\n\n", removed.Select(unit => unit.Text))));
        removed.Clear();
    }

    /// <returns>index pairs of the blocks that stayed the same, in order (a longest common subsequence).</returns>
    static List<(int Old, int New)> Survivors(List<Unit> old, List<Unit> now)
    {
        var prefix = 0;
        while (prefix < old.Count && prefix < now.Count && old[prefix].Key == now[prefix].Key)
            prefix++;
        var suffix = 0;
        while (suffix < old.Count - prefix && suffix < now.Count - prefix && old[^(suffix + 1)].Key == now[^(suffix + 1)].Key)
            suffix++;

        var matches = Enumerable.Range(0, prefix).Select(i => (i, i)).ToList();
        var (oldCount, newCount) = (old.Count - prefix - suffix, now.Count - prefix - suffix);
        if ((long)oldCount * newCount <= MaxComparisons)
            matches.AddRange(CommonSubsequence(old.GetRange(prefix, oldCount), now.GetRange(prefix, newCount)).Select(pair => (pair.Old + prefix, pair.New + prefix)));
        matches.AddRange(Enumerable.Range(0, suffix).Select(i => (old.Count - suffix + i, now.Count - suffix + i)));
        return matches;
    }

    static IEnumerable<(int Old, int New)> CommonSubsequence(List<Unit> old, List<Unit> now)
    {
        var longest = new int[old.Count + 1, now.Count + 1];
        for (var i = old.Count - 1; i >= 0; i--)
            for (var j = now.Count - 1; j >= 0; j--)
                longest[i, j] = old[i].Key == now[j].Key ? longest[i + 1, j + 1] + 1 : Math.Max(longest[i + 1, j], longest[i, j + 1]);

        var (oldAt, newAt) = (0, 0);
        while (oldAt < old.Count && newAt < now.Count)
        {
            if (old[oldAt].Key == now[newAt].Key)
                yield return (oldAt++, newAt++);
            else if (longest[oldAt + 1, newAt] >= longest[oldAt, newAt + 1])
                oldAt++;
            else
                newAt++;
        }
    }

    static List<Unit> Units(string source)
    {
        var units = new List<Unit>();
        foreach (var block in MarkdownRendering.Parse(source).Descendants<Block>())
        {
            var isUnit = block is TableRow || block is LeafBlock and not LinkReferenceDefinition && !InTable(block);
            if (!isUnit || block.Span.IsEmpty)
                continue;
            var (start, end) = (block.Span.Start, block.Span.End + 1);
            var text = block is TableRow ? WholeLines(source, start, end) : source[start..end];
            units.Add(new(start, end, text.Trim(), KeyOf(block, text), KindOf(block)));
        }
        return units;
    }

    // A row's span leaves out its outer pipes, but the old text should read as the row did.
    static string WholeLines(string source, int start, int end)
    {
        var lineStart = source.LastIndexOf('\n', Math.Max(start - 1, 0)) + 1;
        var lineEnd = source.IndexOf('\n', end);
        return source[lineStart..(lineEnd < 0 ? source.Length : lineEnd)];
    }

    static bool InTable(Block block)
    {
        for (var parent = block.Parent; parent is not null; parent = parent.Parent)
            if (parent is Table)
                return true;
        return false;
    }

    // A list item's paragraph is not the same kind as a top-level one, so positional pairing never swaps them.
    static string KindOf(Block block) =>
        block is HeadingBlock heading ? $"h{heading.Level}" : $"{block.GetType().Name} in {block.Parent?.GetType().Name}";

    // Code keeps its whitespace; prose compares as words, so a reflow is not a change.
    static string KeyOf(Block block, string text) =>
        block is CodeBlock
            ? TrailingSpaces().Replace(text.Replace("\r\n", "\n"), "")
            : Whitespace().Replace(QuoteMarkers().Replace(text, ""), " ").Trim();

    static double Similarity(string a, string b)
    {
        var (wordsA, wordsB) = (Words(a), Words(b));
        if (wordsA.Count == 0 || wordsB.Count == 0)
            return 0;
        return (double)wordsA.Intersect(wordsB).Count() / wordsA.Union(wordsB).Count();
    }

    static HashSet<string> Words(string text) =>
        Word().Matches(text).Select(match => match.Value.ToLowerInvariant()).ToHashSet();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"(?m)^[ \t]*(?:>[ \t]?)+")]
    private static partial Regex QuoteMarkers();

    [GeneratedRegex(@"(?m)[ \t]+$")]
    private static partial Regex TrailingSpaces();

    [GeneratedRegex(@"\w+")]
    private static partial Regex Word();
}
