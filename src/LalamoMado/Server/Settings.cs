using System.Globalization;
using System.Text.Json.Nodes;

namespace LalamoMado.Server;

public static class SettingTypes
{
    public const string Toggle = "toggle";
    public const string Choice = "choice";
    public const string Number = "number";
    public const string Hotkey = "hotkey";
}

/// <summary>What a hotkey may be bound to.</summary>
public static class KeyForms
{
    /// <summary>A key with Ctrl or Alt: <c>Ctrl+Shift+Enter</c>, <c>Alt+F2</c>.</summary>
    public const string Combo = "combo";
    /// <summary>A combo, or modifiers pressed and released alone: <c>Ctrl+Shift tapped</c>.</summary>
    public const string ComboOrTap = "combo-or-tap";
    /// <summary>A label's: Alt and a digit from 1 to 9, which while stamping the digit alone also picks.</summary>
    public const string AltDigit = "alt-digit";
}

public sealed record SettingChoice(string Value, string Name);

/// <param name="Name">The line in ⚙.</param>
/// <param name="Description">For the reviewer, on hover, and for the agent, which reads it to find the setting asked for.</param>
/// <param name="Scopes">Where a value may be kept; the first is where ⚙ and <c>--set</c> without <c>--scope</c> keep it.</param>
/// <param name="Requires"><c>dictation</c>: the browser can dictate; <c>local</c>: Whisper is installed. The page shows the setting only then.</param>
/// <param name="KeyForm">For a hotkey, one of <see cref="KeyForms"/>; an empty value leaves the action without a key.</param>
/// <param name="Value">In a listing: the value in effect.</param>
/// <param name="From">In a listing: the scope the value comes from, or <c>default</c>.</param>
public sealed record Setting(string Key, string Section, string Name, string Description, string Type, JsonNode Default, string[] Scopes,
    SettingChoice[]? Choices = null, double? Min = null, double? Max = null, double? Step = null, string? Requires = null, string? KeyForm = null,
    JsonNode? Value = null, string? From = null);

/// <param name="Value">The value as typed after <c>=</c>; null removes it from the scope.</param>
/// <param name="Where">A folder in the repository whose level applies when no document is named: where the agent runs.</param>
public sealed record SettingRequest(string Key, string? Value, string? Scope = null, string? DocId = null, string? Where = null);

/// <summary>What changed, for every open page: it re-reads its preferences and shows the change.</summary>
public sealed record SettingChange(string Key, string Scope, JsonNode? Value);

public sealed class SettingRefusal(string message) : Exception(message);

/// <summary>
/// Every setting the reviewer or the agent may change (plan 17): ⚙ is built from this list, and <c>edit-md settings</c> lists and changes it.
/// Values live in <see cref="Preferences"/>; a key here is a key there.
/// </summary>
public static class SettingsRegistry
{
    static readonly string[] AnyScope = [PreferenceScopes.Pc, PreferenceScopes.Repo, PreferenceScopes.Session, PreferenceScopes.Document];
    // Local dictation depends on this PC's GPU and models, so a repo or a document cannot ask for it.
    static readonly string[] ThisMachine = [PreferenceScopes.Pc, PreferenceScopes.Session];

    public static Setting[] For(DictationStatus local, CommentLabel[] labels) =>
    [
        new("scroll.adaptive", "Comments", "Scroll a selection above the comment popup",
            "When the comment popup would cover the text you selected, the page scrolls the text above it.",
            SettingTypes.Toggle, true, AnyScope),
        new("labels.descriptionDelaySeconds", "Comments", "Seconds until a label's hover adds its description",
            "Hovering a label chip names it at once; its description and keys follow after this many seconds. 0 shows them at once.",
            SettingTypes.Number, 1, AnyScope, Min: 0, Max: 10, Step: 0.5),
        new("threads.highlightOpensCard", "Threads", "Clicking a chat's highlight opens the small card, not the large panel",
            "Off: a chat's highlight in the document opens the large thread panel, as the right pane does. On: it opens the small card at the click.",
            SettingTypes.Toggle, false, AnyScope),
        new("annotations.order", "Panes", "Order of the cards in the right pane",
            "The right pane lists your annotations in document order, newest first, or last edited first; its own picker changes it too.",
            SettingTypes.Choice, "document", AnyScope,
            [new("document", "Document order"), new("created", "Newest first"), new("edited", "Last edited")]),
        new("annotations.compact", "Panes", "Compact cards, one line each",
            "One line per card in the right pane: its label, id, state and the start of your comment; replies and buttons hide. Its Compact tick changes it too.",
            SettingTypes.Toggle, false, AnyScope),
        new("annotations.repliesOnly", "Panes", "Only the cards the agent answered",
            "The right pane lists only the annotations the agent replied to. Its Replies tick changes it too.",
            SettingTypes.Toggle, false, AnyScope),
        new("outline.shown", "Panes", "Show the outline",
            "The left pane with the headings, the marks and the seeks; ☰ in the bar shows or hides it too. A narrow window starts with it hidden.",
            SettingTypes.Toggle, true, AnyScope),
        new("dictation.always", "Dictation", "Dictate as soon as a comment opens",
            "The microphone listens whenever a comment or a reply box opens; 🎤 and Ctrl+D still stop it.",
            SettingTypes.Toggle, false, AnyScope, Requires: "dictation"),
        new("dictation.offerCorrections", "Dictation", "Offer to remember dictated words you correct",
            "When you type over dictated words, or accept a ✨ Fix, a row under the box offers to keep the pair in the glossary, for this repo or for you.",
            SettingTypes.Toggle, true, AnyScope, Requires: "dictation"),
        new("dictation.language", "Dictation", "Dictation language",
            "The language dictation listens for; CZ/EN beside 🎤 switches it too.",
            SettingTypes.Choice, "cs-CZ", AnyScope, [new("cs-CZ", "Czech"), new("en-US", "English")], Requires: "dictation"),
        new("dictation.engine", "Dictation", "Engine",
            "Chrome: its speech service, over the internet. Local: Whisper on this PC. The Chrome / Local badge beside CZ/EN switches it too.",
            SettingTypes.Choice, "chrome", ThisMachine, [new("chrome", "Chrome — its speech service"), new("local", "Local — Whisper on this PC")], Requires: "local"),
        new("dictation.model", "Dictation", "Local's model",
            "The Whisper model Local transcribes with; Turbo is faster, Large v3 slower and no more accurate in real use.",
            SettingTypes.Choice, "turbo", ThisMachine, [.. local.Models.Where(model => model.Present).Select(model => new SettingChoice(model.Id, model.Name))], Requires: "local"),
        new("dictation.fixWithLocal", "Dictation", "Fix with Local's transcript too: while Chrome dictates, keep the sound for ✨",
            "✨ Fix, the agent's correction of misheard words, then also reads Local's transcript of the same speech beside Chrome's. Nothing is transcribed until you press ✨.",
            SettingTypes.Toggle, false, ThisMachine, Requires: "local"),
        .. Hotkeys(labels),
    ];

    /// <summary>Every action with a key, by a stable id that survives a heavily tailored page; a label's default comes from its list's digit.</summary>
    static IEnumerable<Setting> Hotkeys(CommentLabel[] labels) =>
    [
        Hotkey("comment.add", "Add the comment; in the thread panel, send the follow-up", "Ctrl+Enter"),
        Hotkey("comment.sendNow", "Send the comment to the agent now", "Ctrl+Shift+Enter"),
        Hotkey("dictation.toggle", "Start or stop dictating", "Ctrl+D"),
        Hotkey("skills.open", "Open the skill picker in a comment", "Ctrl+Space"),
        Hotkey("stamp.palette", "Open the label palette; twice, stamp with the last label again", "Ctrl+Shift tapped", KeyForms.ComboOrTap),
        .. labels.Where(label => label.Hidden != true && label.Point != true).Select(label =>
            Hotkey($"label.{label.Id}", $"Label {label.Icon} {label.Name}: pick it in a comment, or stamp with it", label.Hotkey is { } digit ? $"Alt+{digit}" : "", KeyForms.AltDigit)),
    ];

    static Setting Hotkey(string action, string name, string defaultKey, string form = KeyForms.Combo) =>
        new($"hotkeys.{action}", "Hotkeys", name,
            $"{name}. When two actions want one key, the value kept for the more specific level wins and the other action loses the key.",
            SettingTypes.Hotkey, defaultKey, AnyScope, KeyForm: form);

    public static Setting[] Listed(Setting[] settings, PreferenceView values) =>
        [.. settings.Select(setting => values.Effective(setting.Key) is ({ } value, { } scope)
            ? setting with { Value = value, From = scope }
            : setting with { Value = setting.Default, From = "default" })];

    /// <summary>Reads a value as typed on the command line; anything the setting does not allow is refused with what it allows.</summary>
    public static JsonNode Parse(Setting setting, string typed)
    {
        var text = typed.Trim();
        switch (setting.Type)
        {
            case SettingTypes.Toggle:
                return text.ToLowerInvariant() switch
                {
                    "true" or "on" or "yes" => true,
                    "false" or "off" or "no" => false,
                    _ => throw new SettingRefusal($"{setting.Key} is on or off: true or false."),
                };
            case SettingTypes.Number:
                if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && number >= (setting.Min ?? double.MinValue) && number <= (setting.Max ?? double.MaxValue))
                    return number;
                throw new SettingRefusal($"{setting.Key} is a number from {setting.Min} to {setting.Max}.");
            case SettingTypes.Hotkey:
                return KeyNames.Normalized(text, setting.KeyForm ?? KeyForms.Combo)
                    ?? throw new SettingRefusal($"{setting.Key} takes {KeyNames.Allowed(setting.KeyForm ?? KeyForms.Combo)}, or none to leave it without a key.");
            default:
                return setting.Choices?.FirstOrDefault(choice => string.Equals(choice.Value, text, StringComparison.OrdinalIgnoreCase))?.Value
                    ?? throw new SettingRefusal($"{setting.Key} is one of: {string.Join(", ", setting.Choices?.Select(choice => choice.Value) ?? [])}.");
        }
    }

    public static Setting Find(Setting[] settings, string key) =>
        settings.FirstOrDefault(setting => setting.Key == key)
        ?? throw new SettingRefusal($"No setting {key}. Known: {string.Join(", ", settings.Select(setting => setting.Key))}.");

    public static string ScopeFor(Setting setting, string? asked)
    {
        var scope = asked ?? setting.Scopes[0];
        return setting.Scopes.Contains(scope) ? scope : throw new SettingRefusal($"{setting.Key} may be kept for: {string.Join(", ", setting.Scopes)}.");
    }
}

/// <summary>Keys as the page names them: modifiers in the order Ctrl, Alt, Shift, then the key — <c>Ctrl+Shift+Enter</c>, <c>Alt+5</c>, <c>Ctrl+Shift tapped</c>.</summary>
public static class KeyNames
{
    static readonly string[] ModifierOrder = ["Ctrl", "Alt", "Shift"];
    static readonly string[] NamedKeys = ["Enter", "Space", .. Enumerable.Range(1, 12).Select(number => $"F{number}")];
    const string Tapped = " tapped";

    /// <returns>The key in its one spelling, "" for none, or null when the form does not allow it.</returns>
    public static string? Normalized(string typed, string form)
    {
        var text = typed.Trim();
        if (text.Length == 0 || text.Equals("none", StringComparison.OrdinalIgnoreCase))
            return "";
        var tapped = text.EndsWith(Tapped, StringComparison.OrdinalIgnoreCase);
        var parts = (tapped ? text[..^Tapped.Length] : text).Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
            return null;
        var modifiers = new HashSet<string>();
        foreach (var part in tapped ? parts : parts[..^1])
            if (Modifier(part) is { } modifier)
                modifiers.Add(modifier);
            else
                return null;
        var ordered = string.Join("+", ModifierOrder.Where(modifiers.Contains));
        if (tapped)
            // One modifier tapped alone is taken: Alt ends the stamp, and Ctrl or Shift start every other shortcut.
            return form == KeyForms.ComboOrTap && modifiers.Count >= 2 && parts.Length == modifiers.Count ? $"{ordered}{Tapped}" : null;
        if (KeyOf(parts[^1]) is not { } key)
            return null;
        if (form == KeyForms.AltDigit)
            return ordered == "Alt" && key is [>= '1' and <= '9'] ? $"Alt+{key}" : null;
        return modifiers.Contains("Ctrl") || modifiers.Contains("Alt") ? $"{ordered}+{key}" : null;
    }

    public static string Allowed(string form) => form switch
    {
        KeyForms.AltDigit => "Alt with a digit from 1 to 9, as Alt+5",
        KeyForms.ComboOrTap => "a key with Ctrl or Alt, as Ctrl+K, or two modifiers tapped alone, as Ctrl+Shift tapped",
        _ => "a key with Ctrl or Alt, as Ctrl+M or Ctrl+Shift+Enter",
    };

    static string? Modifier(string part) => part.ToLowerInvariant() switch
    {
        "ctrl" or "control" or "cmd" or "meta" => "Ctrl",
        "alt" or "option" => "Alt",
        "shift" => "Shift",
        _ => null,
    };

    static string? KeyOf(string part) =>
        part.Length == 1 && char.IsAsciiLetterOrDigit(part[0]) ? part.ToUpperInvariant()
        : NamedKeys.FirstOrDefault(named => named.Equals(part, StringComparison.OrdinalIgnoreCase));
}
