using System.Text.Json;

namespace LalamoMado.Server;

/// <param name="Description">Written for the agent — how it treats the label; the page shows it on hover.</param>
/// <param name="Color">Optional and always explicit: a label without one keeps the plain annotation highlight.</param>
/// <param name="Highlight">A special highlight style: <c>remove</c> strikes the text through.</param>
/// <param name="Point">An insertion point instead of a span.</param>
/// <param name="Hotkey">The digit from 1 to 9 that stamps this label with Alt+digit.</param>
/// <param name="Hidden">A built-in gateway into edit-md's own configuration: left out of the chips, the palette and the hotkeys, reached from ⚙ or by asking.</param>
public sealed record CommentLabel(
    string Id,
    string Icon,
    string? Name = null,
    string? Description = null,
    string? Color = null,
    string? Highlight = null,
    bool? Point = null,
    string? Source = null,
    int? Hotkey = null,
    bool? Hidden = null);

/// <param name="Replace">true drops every list below this one instead of extending it.</param>
public sealed record LabelList(CommentLabel[] Labels, bool Replace = false);

/// <param name="Custom">false while only the shipped list applies, so the agent knows it can skip reading it.</param>
public sealed record EffectiveLabels(CommentLabel[] Labels, bool Custom, string[]? Problems = null);

public static class LabelSources
{
    public const string Shipped = "shipped";
    public const string User = "user";
    public const string Repo = "repo";
    public const string Session = "session";

    public static readonly string[] FromLeastSpecific = [Shipped, User, Repo, Session];
}

/// <summary>
/// Labels are a contract between the reviewer and the agent. Lists layer from the least to the most specific — shipped, user, repo, session —
/// each extending the ones below it, an entry with the same id overriding. Files are re-read on every request, so an edit shows on the next load.
/// </summary>
public sealed class CommentLabels(string shippedPath, string userPath)
{
    public const string FileName = "comment_labels.json";

    public static string DefaultUserPath =>
        Environment.GetEnvironmentVariable("EDIT_MD_USER_LABELS") is { Length: > 0 } custom ? custom : Path.Combine(BuildChannel.Current.UserFilesDirectory, FileName);

    internal static string ClaudeHome =>
        Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") is { Length: > 0 } configured
            ? configured
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude");

    public EffectiveLabels For(string documentPath, LabelList? session)
    {
        var problems = new List<string>();
        var merged = new List<CommentLabel>();
        var custom = false;
        foreach (var (source, list) in Layers(documentPath, session, problems))
        {
            if (list is null)
                continue;
            custom |= source != LabelSources.Shipped;
            if (list.Replace)
                merged.Clear();
            foreach (var label in list.Labels)
            {
                var stamped = label with { Name = label.Name ?? label.Id, Source = source };
                var overridden = merged.FindIndex(existing => existing.Id == label.Id);
                if (overridden >= 0)
                    merged[overridden] = stamped;
                else
                    merged.Add(stamped);
            }
        }
        var settled = SettleHotkeys(merged, problems);
        return new(settled, custom, problems.Count > 0 ? [.. problems] : null);
    }

    /// <summary>Two labels on one digit: the more specific layer keeps it. A point label takes none, as an insertion says nothing without text; nor does a hidden one, kept off the keys.</summary>
    static CommentLabel[] SettleHotkeys(List<CommentLabel> labels, List<string> problems)
    {
        var owners = new Dictionary<int, CommentLabel>();
        foreach (var label in labels.Where(label => label.Hotkey is not null).OrderByDescending(label => Array.IndexOf(LabelSources.FromLeastSpecific, label.Source)))
        {
            var digit = label.Hotkey!.Value;
            if (digit is < 1 or > 9)
                problems.Add($"Label {label.Id}: hotkey {digit} is not a digit from 1 to 9.");
            else if (label.Point == true)
                problems.Add($"Label {label.Id}: an insertion point takes no hotkey.");
            else if (label.Hidden == true)
                problems.Add($"Label {label.Id}: a hidden label takes no hotkey.");
            else if (owners.TryGetValue(digit, out var owner))
                problems.Add($"Labels {owner.Id} and {label.Id} both claim hotkey {digit}; {owner.Id} keeps it.");
            else
                owners[digit] = label;
        }
        return [.. labels.Select(label => label.Hotkey is { } digit && owners.GetValueOrDefault(digit) == label ? label : label with { Hotkey = null })];
    }

    public static string? Problem(LabelList? list) =>
        list?.Labels is null ? "Expected {\"labels\": [...]}, optionally with \"replace\": true."
        : list.Labels.Any(label => string.IsNullOrWhiteSpace(label.Id) || string.IsNullOrWhiteSpace(label.Icon)) ? "Every label needs an id and an icon."
        : null;

    IEnumerable<(string Source, LabelList? List)> Layers(string documentPath, LabelList? session, List<string> problems)
    {
        yield return (LabelSources.Shipped, Read(shippedPath, problems));
        yield return (LabelSources.User, Read(userPath, problems));
        if (GitRoot.Of(documentPath) is { } root)
            yield return (LabelSources.Repo, Read(Path.Combine(root, ".claude", "edit-md", FileName), problems));
        yield return (LabelSources.Session, session);
    }

    static LabelList? Read(string path, List<string> problems)
    {
        if (!File.Exists(path))
            return null;
        try
        {
            var list = JsonSerializer.Deserialize<LabelList>(File.ReadAllText(path), Wire.Json);
            if (Problem(list) is { } problem)
            {
                problems.Add($"{path}: {problem}");
                return null;
            }
            return list;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            problems.Add($"{path}: {e.Message}");
            return null;
        }
    }
}
