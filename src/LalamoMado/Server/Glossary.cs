using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LalamoMado.Server;

/// <param name="Mishearings">What a recognizer wrote → the term meant. A key may be several words, which keeps an everyday word safe.</param>
/// <param name="Replace">true drops the list below this one instead of extending it.</param>
public sealed record GlossaryList(
    string[]? Terms = null,
    Dictionary<string, string>? Mishearings = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool Replace = false);

/// <param name="Prompt">Whisper's prompt, made of the terms that fit, the repo's first.</param>
/// <param name="RepoFile">Where the repo's list lives, present when the document is in a git repository: a correction can then be remembered for the repo.</param>
public sealed record EffectiveGlossary(string[] Terms, Dictionary<string, string> Mishearings, string? Prompt = null, string[]? Problems = null, string? RepoFile = null)
{
    /// <summary>What an event carries for the agent: the lists alone, and nothing when there are none.</summary>
    public EffectiveGlossary? ForAgent() => Terms.Length == 0 && Mishearings.Count == 0 ? null : this with { Prompt = null, Problems = null, RepoFile = null };
}

/// <param name="Layer"><c>repo</c> or <c>user</c>: which file remembers it.</param>
public sealed record RememberedMishearing(string Heard, string Meant, string Layer);

public sealed class GlossaryRefusal(string message) : Exception(message);

/// <summary>
/// The reviewer's terms and known mishearings (plan 09), for both dictation engines and the agent's fixes. Two files, layered like the comment labels — user, then repo —
/// terms unioned with the repo's first, mishearings merged by key with the repo winning. Nothing is shipped. Files are re-read on every request.
/// </summary>
public sealed class Glossary(string userPath)
{
    public const string FileName = "glossary.json";

    // Whisper keeps only the last 224 tokens of its prompt, and a token is at least one byte: a prompt under 224 bytes always fits whole.
    const int MaxPromptBytes = 223;

    public const string RepoLayer = "repo";
    public const string UserLayer = "user";

    static readonly JsonSerializerOptions FileJson = new(Wire.Json) { WriteIndented = true, NewLine = "\n" };

    public static string DefaultUserPath => Path.Combine(BuildChannel.Current.UserFilesDirectory, FileName);

    static string? RepoFileOf(string documentPath) => GitRoot.Of(documentPath) is { } root ? Path.Combine(root, ".claude", "edit-md", FileName) : null;

    public EffectiveGlossary For(string documentPath)
    {
        var problems = new List<string>();
        var kept = new List<GlossaryList>();
        foreach (var list in Layers(documentPath, problems))
        {
            if (list is null)
                continue;
            if (list.Replace)
                kept.Clear();
            kept.Add(list);
        }
        var terms = Enumerable.Reverse(kept).SelectMany(list => list.Terms ?? []).Select(term => term.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var mishearings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var list in kept)
            foreach (var (heard, meant) in list.Mishearings ?? [])
                mishearings[heard.Trim()] = meant.Trim();
        return new(terms, mishearings, PromptFor(terms), problems.Count > 0 ? [.. problems] : null, RepoFileOf(documentPath));
    }

    /// <summary>
    /// A correction the reviewer chose to keep (plan 09 step 4), written into the repo's file or their own. The words of the term that the
    /// recognizer did not hear join the terms, unless a layer has them, so Whisper's prompt learns their spelling too.
    /// The file is re-serialized: order is kept, hand formatting is not. A file that does not read is never overwritten.
    /// </summary>
    public EffectiveGlossary Remember(string documentPath, RememberedMishearing correction)
    {
        var heard = correction.Heard?.Trim() ?? "";
        var meant = correction.Meant?.Trim() ?? "";
        if (heard.Length == 0 || meant.Length == 0)
            throw new GlossaryRefusal("A mishearing needs both what was heard and the term meant.");
        var path = correction.Layer switch
        {
            UserLayer => userPath,
            RepoLayer => RepoFileOf(documentPath) ?? throw new GlossaryRefusal("This document is not in a git repository; remember it for yourself instead."),
            _ => throw new GlossaryRefusal($"Remember it for \"{RepoLayer}\" or \"{UserLayer}\", not \"{correction.Layer}\"."),
        };
        var problems = new List<string>();
        var list = Read(path, problems) ?? new GlossaryList();
        if (problems.Count > 0)
            throw new GlossaryRefusal($"{problems[0]} Fix the file first; it is left as it is.");

        var mishearings = new Dictionary<string, string>(list.Mishearings ?? []);
        var existingKey = mishearings.Keys.FirstOrDefault(key => string.Equals(key.Trim(), heard, StringComparison.OrdinalIgnoreCase));
        mishearings[existingKey ?? heard] = meant;
        var known = For(documentPath).Terms.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var heardWords = heard.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var newTerms = meant.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(word => !heardWords.Contains(word) && !known.Contains(word)).Distinct(StringComparer.OrdinalIgnoreCase);
        var terms = (list.Terms ?? []).Concat(newTerms).ToArray();

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(list with { Terms = terms.Length > 0 ? terms : null, Mishearings = mishearings }, FileJson) + "\n");
        return For(documentPath);
    }

    /// <summary>One short sentence, cut before the first term that would not fit.</summary>
    public static string? PromptFor(IEnumerable<string> terms)
    {
        var fitting = new List<string>();
        foreach (var term in terms)
        {
            if (Encoding.UTF8.GetByteCount(Sentence([.. fitting, term])) > MaxPromptBytes)
                break;
            fitting.Add(term);
        }
        return fitting.Count == 0 ? null : Sentence(fitting);

        static string Sentence(IEnumerable<string> words) => $"Glossary: {string.Join(", ", words)}.";
    }

    public static string? Problem(GlossaryList? list) =>
        list is null || (list.Terms is null && list.Mishearings is null) ? "Expected {\"terms\": [...], \"mishearings\": {\"heard\": \"meant\"}}, optionally with \"replace\": true."
        : list.Terms?.Any(string.IsNullOrWhiteSpace) == true ? "A term is empty."
        : list.Mishearings?.Any(entry => string.IsNullOrWhiteSpace(entry.Key) || string.IsNullOrWhiteSpace(entry.Value)) == true ? "A mishearing needs both what was heard and the term meant."
        : null;

    IEnumerable<GlossaryList?> Layers(string documentPath, List<string> problems)
    {
        yield return Read(userPath, problems);
        if (RepoFileOf(documentPath) is { } repoFile)
            yield return Read(repoFile, problems);
    }

    static GlossaryList? Read(string path, List<string> problems)
    {
        if (!File.Exists(path))
            return null;
        try
        {
            var list = JsonSerializer.Deserialize<GlossaryList>(File.ReadAllText(path), Wire.Json);
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
