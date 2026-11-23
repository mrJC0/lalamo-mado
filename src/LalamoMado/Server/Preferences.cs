using System.Text.Json;
using System.Text.Json.Nodes;

namespace LalamoMado.Server;

public static class PreferenceScopes
{
    public const string Pc = "pc";
    public const string Repo = "repo";
    public const string Session = "session";
    public const string Document = "document";

    /// <summary>The most specific first: the value of the first scope that has one wins.</summary>
    public static readonly string[] Precedence = [Document, Session, Repo, Pc];

    public static bool IsKnown(string? scope) => scope is Pc or Repo or Session or Document;
}

public sealed record PreferenceView(JsonObject Pc, JsonObject Repo, JsonObject Session, JsonObject Document)
{
    /// <returns>The value and the scope it comes from, or nulls when no scope has one.</returns>
    public (JsonNode? Value, string? Scope) Effective(string key)
    {
        foreach (var scope in PreferenceScopes.Precedence)
            if (In(scope)[key] is { } value)
                return (value, scope);
        return (null, null);
    }

    JsonObject In(string scope) => scope switch
    {
        PreferenceScopes.Document => Document,
        PreferenceScopes.Session => Session,
        PreferenceScopes.Repo => Repo,
        _ => Pc,
    };
}

public sealed class PreferenceRefusal(string message) : Exception(message);

/// <summary>
/// The page's preferences must outlive its browser profile, which is per Claude session:
/// "this PC" and "this document" live in a file in the tool home, "this session" in the server's memory,
/// and "this repo" in <c>&lt;git root&gt;/.claude/edit-md/prefs.json</c>, for a team sharing a setting.
/// Parallel sessions run their own servers over the same files, so every write re-reads its file first.
/// </summary>
public sealed class Preferences(string filePath)
{
    public const string FileName = "prefs.json";

    static readonly JsonSerializerOptions FileJson = new() { WriteIndented = true, NewLine = "\n" };

    readonly Lock gate = new();
    readonly JsonObject session = [];

    public static string DefaultPath =>
        Environment.GetEnvironmentVariable("EDIT_MD_PREFS") is { Length: > 0 } custom ? custom : Path.Combine(AppContext.BaseDirectory, FileName);

    public static string? RepoFileOf(string? path) => path is not null && GitRoot.Of(path) is { } root ? Path.Combine(root, ".claude", "edit-md", FileName) : null;

    /// <param name="repoPath">A file or folder in the repository whose level applies: the document, else where the agent runs.</param>
    public PreferenceView View(string? documentPath, string? repoPath = null)
    {
        lock (gate)
        {
            var stored = Read();
            var document = documentPath is null ? null : stored["documents"]?[DocumentKey.Of(documentPath)];
            var repo = RepoFileOf(documentPath ?? repoPath) is { } repoFile ? ReadFile(repoFile) : null;
            return new(Copy(stored["pc"]), Copy(repo), Copy(session), Copy(document));
        }
    }

    /// <param name="value">null removes the key.</param>
    public void Set(string scope, string? documentPath, string key, JsonNode? value, string? repoPath = null)
    {
        lock (gate)
        {
            if (scope == PreferenceScopes.Session)
            {
                Assign(session, key, value);
                return;
            }
            if (scope == PreferenceScopes.Repo)
            {
                var repoFile = RepoFileOf(documentPath ?? repoPath) ?? throw new PreferenceRefusal("A repo setting needs a document or a folder inside a git repository.");
                // A tracked file that does not read is someone's work: refuse rather than overwrite it.
                var shared = File.Exists(repoFile) ? ReadFile(repoFile) ?? throw new PreferenceRefusal($"{repoFile} does not read as a JSON object; fix it first.") : [];
                Assign(shared, key, value);
                Write(shared, repoFile);
                return;
            }
            var stored = Read();
            var target = scope == PreferenceScopes.Pc
                ? GetOrAddChild(stored, "pc")
                : GetOrAddChild(GetOrAddChild(stored, "documents"), DocumentKey.Of(documentPath ?? throw new ArgumentException("A document preference needs its document.")));
            Assign(target, key, value);
            Write(stored, filePath);
        }
    }

    JsonObject Read() => ReadFile(filePath) ?? [];

    /// <returns>null when the file exists but does not read as a JSON object.</returns>
    static JsonObject? ReadFile(string path)
    {
        try
        {
            return !File.Exists(path) ? [] : JsonNode.Parse(File.ReadAllText(path)) as JsonObject;
        }
        catch (Exception e) when (e is IOException or JsonException)
        {
            return null;
        }
    }

    static void Write(JsonObject stored, string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, stored.ToJsonString(FileJson) + "\n");
        File.Move(temporary, path, overwrite: true);
    }

    static void Assign(JsonObject target, string key, JsonNode? value)
    {
        if (value is null)
            target.Remove(key);
        else
            target[key] = value.DeepClone();
    }

    internal static JsonObject GetOrAddChild(JsonObject parent, string name)
    {
        if (parent[name] is JsonObject existing)
            return existing;
        var created = new JsonObject();
        parent[name] = created;
        return created;
    }

    static JsonObject Copy(JsonNode? node) => node is JsonObject source ? (JsonObject)source.DeepClone() : [];
}
