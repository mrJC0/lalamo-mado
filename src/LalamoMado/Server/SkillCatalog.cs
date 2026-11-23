using System.Text;

namespace LalamoMado.Server;

public static class SkillSources
{
    public const string Repo = "repo";
    public const string User = "user";
}

/// <param name="Shadowed">A repo skill named like a user one: the user's wins, as in Claude Code.</param>
/// <param name="UserOnly">Set with <c>disable-model-invocation: true</c>: the model cannot start it, only the reviewer.</param>
/// <param name="Ran">A user-only skill the session says it has run, so it can follow it from a comment.</param>
public sealed record SkillEntry(string Name, string? Description, string Source, bool? Shadowed = null, bool? UserOnly = null, bool? Ran = null);

public sealed record SkillList(SkillEntry[] Skills);

/// <summary>
/// The user-only skills the session reports as run, for as long as the server lives, which is the session.
/// Only the agent's word: after <c>/clear</c> or a compaction it may have lost a skill's text while this still lists it.
/// </summary>
public sealed class SkillsRun
{
    readonly HashSet<string> names = new(StringComparer.OrdinalIgnoreCase);
    readonly Lock gate = new();

    public string[] Add(IEnumerable<string> ran)
    {
        lock (gate)
        {
            names.UnionWith(ran.Select(name => name.Trim().TrimStart('/')).Where(name => name.Length > 0));
            return [.. names.Order(StringComparer.OrdinalIgnoreCase)];
        }
    }

    public SkillList Marked(SkillList list)
    {
        lock (gate)
            return new([.. list.Skills.Select(skill => skill.UserOnly == true && names.Contains(skill.Name) ? skill with { Ran = true } : skill)]);
    }
}

/// <summary>
/// The user's and the repo's own skills, read from the folders the harness's contract puts them in, so nothing passes through the agent's context.
/// Project skills load from the start folder and its parents up to the git root; a document's folder counts down to itself.
/// </summary>
public static class SkillCatalog
{
    public static SkillList For(string documentPath, string serveFolder, string claudeHome)
    {
        var user = Read(claudeHome).ToDictionary(entry => entry.Name, StringComparer.OrdinalIgnoreCase);
        var repo = new Dictionary<string, SkillEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var folder in RepoFoldersFor(documentPath, serveFolder))
            foreach (var entry in Read(Path.Combine(folder, ".claude")))
                repo.TryAdd(entry.Name, entry);

        var listed = user.Values.Select(entry => entry with { Source = SkillSources.User })
            .Concat(repo.Values.Select(entry => entry with { Source = SkillSources.Repo, Shadowed = user.ContainsKey(entry.Name) ? true : null }))
            .OrderBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase);
        return new([.. listed]);
    }

    /// <summary>From the git root down to the document's folder; a document outside any git root counts as in the session's repo.</summary>
    public static IEnumerable<string> RepoFoldersFor(string documentPath, string serveFolder)
    {
        var from = Path.GetDirectoryName(Path.GetFullPath(documentPath))!;
        var root = GitRoot.Of(documentPath);
        if (root is null)
        {
            from = Path.GetFullPath(serveFolder);
            root = GitRoot.Of(serveFolder) ?? from;
        }
        var folders = new Stack<string>();
        for (var folder = from; folder is not null; folder = Path.GetDirectoryName(folder))
        {
            folders.Push(folder);
            if (string.Equals(Path.GetFullPath(folder), Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase))
                break;
        }
        return folders;
    }

    static IEnumerable<SkillEntry> Read(string claudeFolder)
    {
        var found = new Dictionary<string, SkillEntry>(StringComparer.OrdinalIgnoreCase);
        var skills = Path.Combine(claudeFolder, "skills");
        if (Directory.Exists(skills))
            foreach (var folder in Directory.EnumerateDirectories(skills))
            {
                var file = Path.Combine(folder, "SKILL.md");
                if (!File.Exists(file))
                    continue;
                var front = Frontmatter.Of(ReadQuietly(file));
                var name = front.GetValueOrDefault("name") is { Length: > 0 } named ? named : Path.GetFileName(folder);
                found[name] = Entry(name, front);
            }
        // Commands are skills now, named by the file with a subfolder as a `:` segment; a skill wins over a same-named command.
        var commands = Path.Combine(claudeFolder, "commands");
        if (Directory.Exists(commands))
            foreach (var file in Directory.EnumerateFiles(commands, "*.md", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(commands, file);
                var name = Path.ChangeExtension(relative, null).Replace(Path.DirectorySeparatorChar, ':');
                found.TryAdd(name, Entry(name, Frontmatter.Of(ReadQuietly(file))));
            }
        return found.Values;
    }

    static SkillEntry Entry(string name, Dictionary<string, string> front) =>
        new(name, front.GetValueOrDefault("description"), SkillSources.User,
            UserOnly: string.Equals(front.GetValueOrDefault("disable-model-invocation"), "true", StringComparison.OrdinalIgnoreCase) ? true : null);

    static string ReadQuietly(string file)
    {
        try
        {
            return File.ReadAllText(file);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return "";
        }
    }
}

/// <summary>Only what the list needs from a skill's frontmatter: top-level scalars, quoted or folded over indented lines.</summary>
public static class Frontmatter
{
    public static Dictionary<string, string> Of(string text)
    {
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var lines = text.ReplaceLineEndings("\n").Split('\n');
        if (lines is not ["---", ..])
            return fields;
        string? key = null;
        var value = new StringBuilder();
        void Flush()
        {
            if (key is not null)
                fields[key] = Unquoted(value.ToString().Trim());
            value.Clear();
        }
        foreach (var line in lines.Skip(1))
        {
            if (line.TrimEnd() == "---")
                break;
            if (line.Length > 0 && char.IsWhiteSpace(line[0]))
            {
                value.Append(' ').Append(line.Trim());
                continue;
            }
            var colon = line.IndexOf(':');
            if (colon <= 0)
                continue;
            Flush();
            key = line[..colon].Trim();
            var rest = line[(colon + 1)..].Trim();
            value.Append(rest is ">" or "|" or ">-" or "|-" ? "" : rest);
        }
        Flush();
        return fields;
    }

    static string Unquoted(string text) =>
        text.Length >= 2 && ((text[0] == '"' && text[^1] == '"') || (text[0] == '\'' && text[^1] == '\'')) ? text[1..^1] : text;
}
