using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using LalamoMado.Markdown;

namespace LalamoMado.Server;

public static class Wire
{
    /// <summary>Relaxed escaping keeps non-ASCII readable in the agent's output; nothing here is ever inlined into HTML.</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
}

public static class EventKinds
{
    public const string Send = "send";
    public const string Submit = "submit";
    public const string Aborted = "aborted";
    public const string Resumed = "resumed";
    public const string Fix = "fix";
}

/// <summary>The reviewer's terminal choice on Submit, and what it asks of the agent.</summary>
public static class Decisions
{
    public const string Approve = "approve";
    public const string ApplyReview = "apply-review";
    public const string ApplySilent = "apply-silent";

    public static readonly IReadOnlyDictionary<string, string> FollowUp = new Dictionary<string, string>
    {
        [Approve] = "change nothing; review over",
        [ApplyReview] = "apply, then `open \"{path}\"` for the next round and `wait {docId}`",
        [ApplySilent] = "apply, report in chat; review over",
    };
}

public static class AnnotationScopes
{
    public const string Block = "block";
}

public static class InboxKinds
{
    public const string Reply = "reply";
    public const string Reload = "reload";
    public const string Delivered = "delivered";
    public const string Labels = "labels";
    public const string Marks = "marks";
    public const string Unmark = "unmark";
    public const string Fix = "fix";
    public const string Run = "run";
    public const string Buttons = "buttons";
    public const string Setting = "setting";
}

public sealed record ClientAnchor(string Quote, string Prefix, string Suffix, int StartHint, int? SrcStart, int? SrcEnd);

/// <param name="Labels">Every label the reviewer picked; <paramref name="Label"/> is the first.</param>
/// <param name="MarkId">The agent mark the annotation answers: drafted with Resolve, or made on a marked span.</param>
/// <param name="ReplyTo">A follow-up in a thread: the thread's first annotation. It carries no label and no anchor.</param>
/// <param name="SpokenRanges">Where in the text the dictation wrote, as [start, end) pairs; the rest was typed.</param>
/// <param name="Alternatives">The recognizer's other guesses at each phrase it settled on.</param>
/// <param name="Skills">The known skills its text names as <c>/name</c>, so the agent sees them without parsing.</param>
/// <param name="LocalTranscript">On a fix with ⚙ "Fix with Local's transcript too": what Whisper heard of the same speech, beside the text Chrome wrote.</param>
public sealed record ClientAnnotation(string Id, string? Label, string? Text, string Scope, ClientAnchor? Anchor, string[]? Labels = null,
    string? MarkId = null, string? MarkSet = null, string? ReplyTo = null, int[][]? SpokenRanges = null, PhraseGuesses[]? Alternatives = null, string[]? Skills = null,
    string? LocalTranscript = null);

public sealed record PhraseGuesses(string Phrase, string[]? Others);

/// <param name="Button">A send button's id; its settings then decide who answers and how.</param>
/// <param name="Effort">One of <see cref="RunPlan.Efforts"/>; anything else, or none, leaves the model's own default.</param>
public sealed record AgentTicks(bool Repo = false, bool Brief = false, string? Model = null, bool Edit = false, string? Button = null, string? Effort = null);

/// <param name="FixId">For a <c>fix</c>: the open comment the agent's corrected text goes back to.</param>
/// <param name="Agent">Set when New agent is ticked or a send button was clicked.</param>
public sealed record BrowserEvent(string Kind, string? Mode, string? Decision, ClientAnnotation[]? Annotations, string? FixId = null, AgentTicks? Agent = null);

public sealed record AgentAnnotation(
    string Id,
    string? Label,
    string? Text,
    string Scope,
    string? Quote,
    string? Lines,
    int? SourceStart,
    int? SourceEnd,
    bool? Exact,
    int? QuoteLength = null,
    string[]? Labels = null,
    string? MarkId = null,
    string? MarkSet = null,
    bool? Dictated = null,
    string[]? Spoken = null,
    Dictionary<string, string[]>? Maybe = null,
    string? ReplyTo = null,
    string[]? Skills = null,
    string? LocalTranscript = null);

/// <param name="Round">Increments with each `open` after a submit; events of an older round are never delivered.</param>
/// <param name="Glossary">On a <c>fix</c>, and on an event with a dictated annotation: the reviewer's terms and known mishearings, when there are any.</param>
public sealed record AgentEvent(
    long Seq,
    string Kind,
    string DocId,
    int Round,
    string Path,
    DateTimeOffset At,
    string? Mode = null,
    string? Decision = null,
    bool? FileChanged = null,
    AgentAnnotation[]? Annotations = null,
    string? Reason = null,
    string? Hint = null,
    string? FixId = null,
    AgentTicks? Agent = null,
    SendButton? Button = null,
    EffectiveGlossary? Glossary = null);

/// <param name="FixId">Answers a <c>fix</c>: the text goes back to that open comment as a suggestion, as typed, not rendered.</param>
public sealed record PushRequest(string? Text, string? AnnotationId, string? Quote, string? FixId = null);

/// <param name="Value">null removes the key.</param>
public sealed record PreferenceRequest(string Scope, string Key, System.Text.Json.Nodes.JsonNode? Value, string? DocId = null);

/// <summary>Sent by `wait` after it has printed the event: only then is the event delivered.</summary>
public sealed record AckRequest(long Seq);

/// <param name="Set">For <c>marks</c> the set it replaces or adds; for <c>unmark</c> the set dropped, null for all.</param>
/// <param name="RunState">For a <c>run</c>: waiting, answering, done, failed or cancelled.</param>
/// <param name="By">Who answered, when it was not the session.</param>
/// <param name="Suggestion">A proposed rewrite of the quote, offered as Use / Dismiss.</param>
/// <param name="Changed">The files a run says it changed.</param>
/// <param name="DocumentChanged">The reviewed document differs from what the page shows: the card offers to re-read it.</param>
/// <param name="CostUsd">Claude Code's estimate; kept, not shown on the card.</param>
/// <param name="Setting">A setting the agent changed: the page re-reads its preferences and shows it.</param>
public sealed record InboxMessage(long Seq, string Kind, DateTimeOffset At, string? Html = null, string? AnnotationId = null, string? Quote = null, string[]? AnnotationIds = null,
    string? Set = null, PlacedMark[]? Marks = null, string? Text = null, string? FixId = null,
    string? RunState = null, string? By = null, string? Error = null, bool? MayEdit = null,
    string? Suggestion = null, string[]? Changed = null, bool? DocumentChanged = null, string? Note = null, decimal? CostUsd = null,
    SettingChange? Setting = null);

/// <param name="Quote">The exact rendered text, as <c>push --quote</c> takes it.</param>
/// <param name="Lines">Picks the occurrence when the quote appears more than once.</param>
/// <param name="Focus">The mark to start focused, while the reviewer has not picked one.</param>
/// <param name="Before">Text just before the quote, telling repeats within those lines apart.</param>
public sealed record MarkEntry(string Label, string Quote, string? Note = null, string? Lines = null, bool? Focus = null, string? Before = null);

/// <param name="Prefix">The rendered text just before the quote, so the page highlights this occurrence and not the first.</param>
public sealed record PlacedMark(string Id, string Label, string Quote, string? Note, string Lines, int SourceStart, int SourceEnd, bool? Focus = null, string? Prefix = null);

public sealed record MarkRequest(string Set, MarkEntry[] Marks);

/// <param name="Set">null drops every set.</param>
public sealed record UnmarkRequest(string? Set);

/// <param name="NotFound">Quotes that are not in the document as rendered: fix the quote and mark the set again.</param>
public sealed record MarksPlaced(string Set, int Placed, string[]? NotFound, PlacedMark[] Marks);

public sealed record OpenRequest(string Path, bool LaunchBrowser = false);

/// <param name="Browser">set when this open launched one: chrome / chromium / edge / custom / default.</param>
/// <param name="NewWindow">true for the session's first tab — no tab of this server was connected.</param>
/// <param name="Changes">how many changes the page marks since the reviewer last saw the doc; the diff itself never goes to the agent.</param>
/// <param name="Labels"><c>custom</c> when the reviewer's labels differ from the shipped ones: the agent reads them once with <c>edit-md labels</c>.</param>
public sealed record OpenResult(string DocId, string Url, string Path, bool Reopened, bool BrowserConnected, string? Browser = null, bool? NewWindow = null, int Changes = 0, string Labels = "default");

/// <param name="Changes">What changed since the page last loaded this doc; empty on a first open.</param>
/// <param name="Channel"><c>release</c> or <c>dev</c>: the page marks a dev build so it is never taken for the released one.</param>
public sealed record DocumentView(string DocId, string Path, string FileName, string Html, string Hash, string Instance, bool Submitted, BlockChange[] Changes, DateTimeOffset SavedAt, string Channel, string? Commit);

public sealed record DocumentStatus(string DocId, int Round, string Path, string Url, bool BrowserConnected, bool Submitted, int PendingEvents);

public sealed record ServerStatus(string Url, int Pid, string Instance, DateTimeOffset StartedAt, DocumentStatus[] Docs, string Channel, string? Commit);

public sealed record LocatedAnnotation(string Id, string? Lines);

/// <param name="By"><c>reviewer</c> or <c>agent</c>.</param>
public sealed record ThreadTurn(string By, string Text, DateTimeOffset At);

public sealed record ThreadView(string Id, string? Quote, string? Lines, ThreadTurn[] Turns);

/// <param name="AgentListening">false when no `wait` is armed: the agent is busy and picks the event up later.</param>
/// <param name="Delegated">A separate run answers: no event for the agent, and no <c>wait</c> needed.</param>
public sealed record EventAccepted(long Seq, LocatedAnnotation[] Located, bool AgentListening, bool? Delegated = null);

public sealed record BriefRequest(string AnnotationId, string Brief);

public sealed record SkillsRanRequest(string[] Names);
