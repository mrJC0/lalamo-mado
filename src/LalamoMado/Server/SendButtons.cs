using System.Text.Json;
using System.Text.Json.Nodes;

namespace LalamoMado.Server;

public static class AnswererKinds
{
    public const string Session = "session";
    public const string New = "new";
    public const string Brief = "brief";
}

/// <summary>A whole setup for answering a send, saved under one click.</summary>
/// <param name="By"><c>session</c>, <c>new</c> or <c>brief</c>: who answers, as the checkboxes.</param>
/// <param name="Allow">With <paramref name="Edit"/>: commands beyond read-only git, as Bash rules.</param>
/// <param name="Prompt">Goes before the request.</param>
/// <param name="System">Appended to the run's system prompt.</param>
/// <param name="TellSession">The session also gets the conclusion, as a silent note.</param>
/// <param name="Instructions">With <c>by: "session"</c>: free-form, for the session agent, which runs whatever they say.</param>
public sealed record SendButton(
    string Id,
    string Icon,
    string? Name = null,
    string? Description = null,
    string By = AnswererKinds.New,
    bool Repo = false,
    string? Model = null,
    string? Effort = null,
    bool Edit = false,
    string[]? Allow = null,
    string? Prompt = null,
    string? System = null,
    bool TellSession = false,
    int? MaxTurns = null,
    decimal? MaxBudgetUsd = null,
    int? TimeoutSeconds = null,
    string? Instructions = null,
    string? Source = null);

/// <param name="Replace">true drops every list below this one instead of extending it.</param>
public sealed record ButtonList(SendButton[] Buttons, bool Replace = false);

public sealed record EffectiveButtons(SendButton[] Buttons, string[]? Problems = null);

/// <summary>Layered like the comment labels: shipped, user, repo, session, the same id overriding. Files are re-read on every request.</summary>
public sealed class SendButtons(string shippedPath, string userPath)
{
    public const string FileName = "send_buttons.json";

    static readonly HashSet<string> KnownFields = new(
        typeof(SendButton).GetProperties().Select(property => property.Name).Where(name => name != nameof(SendButton.Source)),
        StringComparer.OrdinalIgnoreCase);

    public static string DefaultUserPath =>
        Environment.GetEnvironmentVariable("EDIT_MD_USER_BUTTONS") is { Length: > 0 } custom ? custom : Path.Combine(BuildChannel.Current.UserFilesDirectory, FileName);

    public EffectiveButtons For(string documentPath, ButtonList? session)
    {
        var problems = new List<string>();
        var merged = new List<SendButton>();
        foreach (var (source, list) in Layers(documentPath, session, problems))
        {
            if (list is null)
                continue;
            if (list.Replace)
                merged.Clear();
            foreach (var button in list.Buttons)
            {
                var stamped = button with { Name = button.Name ?? button.Id, Source = source };
                var overridden = merged.FindIndex(existing => existing.Id == button.Id);
                if (overridden >= 0)
                    merged[overridden] = stamped;
                else
                    merged.Add(stamped);
            }
        }
        return new([.. merged], problems.Count > 0 ? [.. problems] : null);
    }

    public static string? Problem(ButtonList? list) =>
        list?.Buttons is null ? "Expected {\"buttons\": [...]}, optionally with \"replace\": true."
        : list.Buttons.Any(button => string.IsNullOrWhiteSpace(button.Id) || string.IsNullOrWhiteSpace(button.Icon)) ? "Every button needs an id and an icon."
        : list.Buttons.FirstOrDefault(button => button.By is not (AnswererKinds.Session or AnswererKinds.New or AnswererKinds.Brief)) is { } wrong ? $"Button {wrong.Id}: \"by\" is session, new or brief."
        : null;

    /// <summary>A field the runner does not know is reported, not ignored: it was written for a reason.</summary>
    public static IEnumerable<string> UnknownFields(string json)
    {
        if (JsonNode.Parse(json)?["buttons"] is not JsonArray buttons)
            yield break;
        foreach (var button in buttons.OfType<JsonObject>())
            foreach (var (field, _) in button)
                if (!KnownFields.Contains(field))
                    yield return $"Button {button["id"]}: unknown field \"{field}\".";
    }

    IEnumerable<(string Source, ButtonList? List)> Layers(string documentPath, ButtonList? session, List<string> problems)
    {
        yield return (LabelSources.Shipped, Read(shippedPath, problems));
        yield return (LabelSources.User, Read(userPath, problems));
        if (GitRoot.Of(documentPath) is { } root)
            yield return (LabelSources.Repo, Read(Path.Combine(root, ".claude", "edit-md", FileName), problems));
        yield return (LabelSources.Session, session);
    }

    static ButtonList? Read(string path, List<string> problems)
    {
        if (!File.Exists(path))
            return null;
        try
        {
            var json = File.ReadAllText(path);
            var list = JsonSerializer.Deserialize<ButtonList>(json, Wire.Json);
            if (Problem(list) is { } problem)
            {
                problems.Add($"{path}: {problem}");
                return null;
            }
            problems.AddRange(UnknownFields(json).Select(unknown => $"{path}: {unknown}"));
            return list;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            problems.Add($"{path}: {e.Message}");
            return null;
        }
    }
}
