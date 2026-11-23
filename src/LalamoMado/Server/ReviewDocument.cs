using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using LalamoMado.Markdown;

namespace LalamoMado.Server;

public sealed partial class ReviewDocument(string docId, string path, LastSeenVersions lastSeen)
{
    const int MaxQuote = 160;

    public string DocId { get; } = docId;
    public string Path { get; } = path;
    public int Round { get; private set; } = 1;
    public string Html { get; private set; } = "";
    public string Hash { get; private set; } = "";
    /// <summary>When the file shown was last written, so a tab left open can tell an older version from the latest.</summary>
    public DateTimeOffset SavedAt { get; private set; }
    public SourceMap SourceMap { get; private set; } = new("");
    public BlockChange[] Changes { get; private set; } = [];
    public bool Submitted { get; set; }
    public bool AbortRaised { get; set; }
    public LabelList? SessionLabels { get; set; }
    public ReplayFeed<InboxMessage> Inbox { get; private set; } = new();
    public TabPresence Presence { get; private set; } = new();
    public ReviewThreads Threads { get; private set; } = new();
    public DocumentRuns Runs { get; private set; } = new();
    public ButtonList? SessionButtons { get; set; }

    public bool BrowserConnected => Presence.Connected;

    /// <summary>After a submit the next open is a fresh review: a new page must not replay the previous round's replies.</summary>
    public void StartNewRound()
    {
        Round++;
        Inbox = new();
        Presence = new();
        Threads = new();
        Runs = new();
        Submitted = false;
        AbortRaised = false;
        lock (marksGate)
            foreach (var marks in markSets)
                Announce(marks);
    }

    string source = "";
    string? lastSeenSource;

    public void Load()
    {
        source = File.ReadAllText(Path);
        SavedAt = File.GetLastWriteTimeUtc(Path);
        SourceMap = new SourceMap(source);
        Html = MarkdownRendering.ToAnnotatableHtml(source);
        Hash = HashOf(source);
        lastSeenSource ??= lastSeen.Read(Path);
        Changes = lastSeenSource is null ? [] : BlockDiff.Between(lastSeenSource, source);
        lock (marksGate)
            foreach (var marks in markSets)
            {
                Place(marks);
                Announce(marks);
            }
    }

    // The agent's marks outlive a round: only the agent drops them, never the page guessing a decision is settled.
    readonly Lock marksGate = new();
    readonly List<MarkSet> markSets = [];
    int lastMarkId;

    sealed class MarkSet(string name, (string Id, MarkEntry Entry)[] entries)
    {
        public string Name { get; } = name;
        public (string Id, MarkEntry Entry)[] Entries { get; } = entries;
        public PlacedMark[] Placed { get; set; } = [];
    }

    /// <summary>A new set name adds a set; a name in use replaces just that set.</summary>
    public MarksPlaced Mark(string set, MarkEntry[] entries)
    {
        lock (marksGate)
        {
            var marks = new MarkSet(set, [.. entries.Select(entry => ($"m{++lastMarkId}", entry))]);
            var notFound = Place(marks);
            var replaced = markSets.FindIndex(existing => existing.Name == set);
            if (replaced >= 0)
                markSets[replaced] = marks;
            else
                markSets.Add(marks);
            Announce(marks);
            return new(set, marks.Placed.Length, notFound.Length > 0 ? notFound : null, marks.Placed);
        }
    }

    /// <param name="set">null drops every set.</param>
    public bool Unmark(string? set)
    {
        lock (marksGate)
        {
            if (markSets.RemoveAll(marks => set is null || marks.Name == set) == 0)
                return false;
            Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Unmark, DateTimeOffset.Now, Set: set));
            return true;
        }
    }

    string[] Place(MarkSet marks)
    {
        var placed = new List<PlacedMark>();
        var notFound = new List<string>();
        foreach (var (id, entry) in marks.Entries)
        {
            var (start, end) = entry.Lines is { } lines ? SourceMap.SpanOfLines(lines) : (0, source.Length);
            var location = string.IsNullOrWhiteSpace(entry.Quote) ? null : SourceMap.Locate(new TextQuote(entry.Quote, entry.Before ?? "", "", start, end));
            if (location is { Exact: true })
                placed.Add(new(id, entry.Label, entry.Quote, entry.Note, location.Lines, location.SourceStart, location.SourceEnd, entry.Focus,
                    SourceMap.PlainBefore(location.SourceStart)));
            else
                notFound.Add(entry.Quote);
        }
        marks.Placed = [.. placed];
        return [.. notFound];
    }

    void Announce(MarkSet marks) =>
        Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Marks, DateTimeOffset.Now, Set: marks.Name, Marks: marks.Placed));

    /// <summary>The page loads the current version, so that is what the next <see cref="Load"/> diffs against — in any round, and in a later session.</summary>
    public DocumentView ServeView(string instance)
    {
        if (lastSeenSource != source)
        {
            lastSeenSource = source;
            lastSeen.Write(Path, source);
        }
        return new DocumentView(DocId, Path, System.IO.Path.GetFileName(Path), Html, Hash, instance, Submitted, Changes, SavedAt, BuildChannel.Current.Name, BuildChannel.Commit);
    }

    public bool FileChangedOnDisk()
    {
        try
        {
            return HashOf(File.ReadAllText(Path)) != Hash;
        }
        catch (IOException)
        {
            return true;
        }
    }

    /// <summary>
    /// Long quotes travel as head … tail: <c>lines</c> already says where the span is.
    /// A selection across table cells or blocks renders with runs of blank lines; each such run reaches the agent as one line break.
    /// </summary>
    public AgentAnnotation Locate(ClientAnnotation annotation)
    {
        var spoken = SpokenWords.Read(annotation.Text, annotation.SpokenRanges, annotation.Alternatives);
        if (annotation.ReplyTo is { } replyTo)
            return new(annotation.Id, null, annotation.Text, annotation.Scope, null, null, null, null, null,
                Dictated: spoken.Dictated, Spoken: spoken.Parts, Maybe: spoken.Maybe, ReplyTo: Threads.RootOf(replyTo), Skills: annotation.Skills);

        var anchor = annotation.Anchor;
        var label = annotation.Labels?.FirstOrDefault() ?? annotation.Label;
        var several = annotation.Labels is { Length: > 1 } labels ? labels : null;
        var (quote, fullLength) = Abbreviated(anchor?.Quote is { } selected ? LineBreakRuns().Replace(selected, "\n") : null);
        if (anchor is not { SrcStart: int blockStart, SrcEnd: int blockEnd })
            return new(annotation.Id, label, annotation.Text, annotation.Scope, quote, null, null, null, null, fullLength, several, annotation.MarkId, annotation.MarkSet, spoken.Dictated, spoken.Parts, spoken.Maybe, Skills: annotation.Skills, LocalTranscript: annotation.LocalTranscript);

        var location = annotation.Scope == AnnotationScopes.Block
            ? SourceMap.LocateBlock(blockStart, blockEnd)
            : SourceMap.Locate(new TextQuote(anchor.Quote, anchor.Prefix, anchor.Suffix, blockStart, blockEnd));
        return new(annotation.Id, label, annotation.Text, annotation.Scope, quote,
            location.Lines, location.SourceStart, location.SourceEnd, location.Exact, fullLength, several, annotation.MarkId, annotation.MarkSet, spoken.Dictated, spoken.Parts, spoken.Maybe, Skills: annotation.Skills, LocalTranscript: annotation.LocalTranscript);
    }

    static (string? Quote, int? FullLength) Abbreviated(string? quote) =>
        quote is { Length: > MaxQuote } ? ($"{quote[..90].TrimEnd()} … {quote[^50..].TrimStart()}", quote.Length) : (quote, null);

    static string HashOf(string source) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(source)))[..16];

    [GeneratedRegex(@"\s*\n\s*")]
    private static partial Regex LineBreakRuns();
}
