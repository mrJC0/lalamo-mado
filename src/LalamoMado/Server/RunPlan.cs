using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LalamoMado.Server;

/// <summary>Everything that decides how one headless run starts; the same setup again for a follow-up, with <paramref name="Resume"/>.</summary>
/// <param name="Folder">Where the run starts: the skills there and up to the git root load at once.</param>
/// <param name="AddDir">The rest of what it may read and, with <paramref name="Edit"/>, write.</param>
/// <param name="HooksOff">Outside the session's repo: <c>-p</c> skips the trust dialog, so that repo's hooks would run unasked.</param>
public sealed record RunSetup(
    string Folder,
    string? AddDir,
    string SessionId,
    bool Resume = false,
    bool Repo = false,
    bool Edit = false,
    string? Model = null,
    string? Effort = null,
    string[]? Allow = null,
    string? System = null,
    int? MaxTurns = null,
    decimal? MaxBudgetUsd = null,
    bool HooksOff = false);

public static class RunPlan
{
    /// <summary>The levels <c>claude --effort</c> takes; a model without one falls back to the highest it has below it.</summary>
    public static readonly string[] Efforts = ["low", "medium", "high", "xhigh", "max"];

    static readonly string[] ReadOnlyGit = ["Bash(git log *)", "Bash(git show *)", "Bash(git diff *)", "Bash(git blame *)"];
    // These three take --output, git takes it abbreviated, and the rules above would let it write a file.
    static readonly string[] GitOutput = ["Bash(git diff *--ou*)", "Bash(git log *--ou*)", "Bash(git show *--ou*)"];
    const string ReadingTools = "Read,Grep,Glob,WebSearch,WebFetch,Bash";
    const string EditingLine = "The reviewer allowed you to edit files for this request, whatever the label says about editing: when the comment asks for a change, make it. Files under .claude/ are protected and your tools cannot write them: return those changes in `edits`, each `old` exact and unique in its file, an empty `old` creating the file, and `file` relative to the git root. List every file you changed in `changed`.";
    const string IdentityLine = "You are a separate run edit-md started to answer one annotation in the reviewer's page. You are not their session agent and do not know its conversation; a document's \"I\" or \"the agent\" means that agent.";
    const string AnsweringLine = "Put your answer in `answer`, as markdown. To propose a rewrite of the quoted text without changing anything, put the new text in `edit`.";

    public static List<string> Arguments(RunSetup setup)
    {
        var arguments = new List<string> { "-p", "--output-format", "json", "--json-schema", Schema(setup.Edit) };
        arguments.AddRange(setup.Resume ? ["--resume", setup.SessionId] : ["--session-id", setup.SessionId]);
        if (setup.AddDir is { } addDir)
            arguments.AddRange(["--add-dir", addDir]);
        arguments.AddRange(["--tools", setup.Edit ? $"{ReadingTools},Edit,Write" : ReadingTools]);
        arguments.Add("--allowedTools");
        arguments.AddRange(["WebSearch", "WebFetch", .. ReadOnlyGit]);
        if (setup.Edit)
            arguments.AddRange(["Edit", "Write", .. setup.Allow ?? []]);
        arguments.AddRange(["--disallowedTools", "mcp__*", .. GitOutput]);
        arguments.AddRange(["--permission-mode", "dontAsk"]);
        arguments.AddRange(["--append-system-prompt", SystemPrompt(setup)]);
        if (setup.Model is { Length: > 0 } model)
            arguments.AddRange(["--model", model]);
        if (setup.Effort is { Length: > 0 } effort)
            arguments.AddRange(["--effort", effort]);
        if (setup.MaxTurns is { } turns)
            arguments.AddRange(["--max-turns", turns.ToString()]);
        if (setup.MaxBudgetUsd is { } budget)
            arguments.AddRange(["--max-budget-usd", budget.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
        if (!setup.Repo)
            arguments.AddRange(["--safe-mode", "--strict-mcp-config"]);
        if (setup.HooksOff)
            arguments.AddRange(["--settings", """{"disableAllHooks":true}"""]);
        return arguments;
    }

    static string SystemPrompt(RunSetup setup) =>
        string.Join("\n\n", new[] { IdentityLine, AnsweringLine, setup.Edit ? EditingLine : null, setup.System }.Where(line => !string.IsNullOrWhiteSpace(line)));

    public static string Schema(bool edit)
    {
        var properties = new JsonObject
        {
            ["answer"] = new JsonObject { ["type"] = "string" },
            ["edit"] = new JsonObject { ["type"] = "string" },
        };
        if (edit)
        {
            properties["changed"] = new JsonObject { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "string" } };
            properties["edits"] = new JsonObject
            {
                ["type"] = "array",
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["file"] = new JsonObject { ["type"] = "string" },
                        ["old"] = new JsonObject { ["type"] = "string" },
                        ["new"] = new JsonObject { ["type"] = "string" },
                    },
                    ["required"] = new JsonArray("file", "old", "new"),
                },
            };
        }
        return new JsonObject { ["type"] = "object", ["properties"] = properties, ["required"] = new JsonArray("answer") }.ToJsonString();
    }

    /// <summary>Who answered, as the reply card says it.</summary>
    public static string Who(string? model, bool repo, bool briefed, bool edit, string? skill = null, string? effort = null) =>
        string.Join(" · ", new[] { string.IsNullOrEmpty(model) ? "default model" : model, effort is null ? null : $"{effort} effort", repo ? "repo" : "blank", briefed ? "briefed" : null, edit ? "may edit" : null, skill }.Where(part => part is not null));

    /// <summary>The request: all a run gets, nothing of the session. A leading <c>/name</c> stays first, so the run expands it.</summary>
    public static string Prompt(string documentPath, AgentAnnotation annotation, string? labelDescription, string? buttonPrompt, string? brief)
    {
        var prompt = new StringBuilder();
        var comment = annotation.Text ?? "";
        if (LeadingSkill(comment) is { } skill)
        {
            prompt.AppendLine(skill);
            comment = comment[skill.Length..].TrimStart();
        }
        if (!string.IsNullOrWhiteSpace(buttonPrompt))
            prompt.AppendLine(buttonPrompt).AppendLine();
        prompt.AppendLine("A reviewer reading a document asks you something about it.");
        prompt.AppendLine($"Document: {documentPath}");
        if (annotation.Lines is { } lines)
            prompt.AppendLine($"Lines: {lines}");
        if (!string.IsNullOrEmpty(annotation.Quote))
            prompt.AppendLine($"Quoted text: {annotation.Quote}");
        if (annotation.Label is { } label)
            prompt.AppendLine($"Label: {label}{(labelDescription is null ? "" : $" — {labelDescription}")}");
        prompt.AppendLine($"Comment: {comment}");
        AppendSpoken(prompt, annotation);
        if (!string.IsNullOrWhiteSpace(brief))
            prompt.AppendLine().AppendLine("A brief from an agent that knows the conversation:").AppendLine(brief);
        return prompt.ToString();
    }

    public static string FollowUpPrompt(AgentAnnotation followUp)
    {
        var prompt = new StringBuilder(followUp.Text ?? "").AppendLine();
        AppendSpoken(prompt, followUp);
        return prompt.ToString();
    }

    static void AppendSpoken(StringBuilder prompt, AgentAnnotation annotation)
    {
        if (annotation.Dictated != true)
            return;
        prompt.AppendLine(annotation.Spoken is { } parts
            ? $"These parts of it were spoken and may be misheard; read them against the document. The rest was typed, so take it literally: {string.Join(" | ", parts)}"
            : "It was spoken and may be misheard; read it against the document.");
        if (annotation.Maybe is { } maybe)
            prompt.AppendLine($"The recognizer also heard: {string.Join("; ", maybe.Select(entry => $"{entry.Key} → {string.Join(", ", entry.Value)}"))}");
    }

    /// <summary>As in the chat, only a <c>/name</c> that starts the text fires; anywhere else it stays text.</summary>
    public static string? LeadingSkill(string text)
    {
        if (!text.StartsWith('/'))
            return null;
        var end = text.IndexOfAny([' ', '\t', '\r', '\n']);
        var name = end < 0 ? text : text[..end];
        return name.Length > 1 && name[1..].All(c => char.IsLetterOrDigit(c) || c is '-' or '_' or ':') ? name : null;
    }
}

public sealed record FileEdit(string? File, string? Old, string? New);

/// <param name="Suggestion">A proposed rewrite of the quote, offered as Use / Dismiss.</param>
/// <param name="Edits">Changes for what the run's own tools cannot write, for the server to apply.</param>
/// <param name="Error">Set when the run failed; there is then no answer.</param>
public sealed record RunOutcome(string? Answer, string? Suggestion, FileEdit[] Edits, string[] Changed, string? SessionId, decimal? CostUsd, JsonNode? Usage, string? Error)
{
    /// <summary>A run that ends without valid structured output still answers, from <c>result</c>; error subtypes carry <c>errors[]</c> and no result.</summary>
    public static RunOutcome Parse(string stdout, string stderr)
    {
        JsonObject? json = null;
        try
        {
            json = JsonNode.Parse(stdout) as JsonObject;
        }
        catch (JsonException)
        {
        }
        if (json is null)
            return Failed(stderr.Trim() is { Length: > 0 } message ? message : "The run printed no result.");

        var structured = json["structured_output"] as JsonObject;
        var sessionId = json["session_id"]?.GetValue<string>();
        var cost = json["total_cost_usd"]?.GetValue<decimal>();
        var usage = json["usage"]?.DeepClone();
        var answer = structured?["answer"]?.GetValue<string>() ?? (json["result"] as JsonValue)?.GetValue<string>();
        var isError = json["is_error"]?.GetValue<bool>() == true;
        if (isError || string.IsNullOrWhiteSpace(answer))
        {
            var errors = (json["errors"] as JsonArray)?.Select(error => error?.ToString()).Where(error => !string.IsNullOrEmpty(error));
            var message = errors?.Any() == true ? string.Join("; ", errors) : answer is { Length: > 0 } ? answer : json["subtype"]?.ToString() ?? "The run gave no answer.";
            return new(null, null, [], [], sessionId, cost, usage, message);
        }
        return new(
            answer,
            structured?["edit"]?.GetValue<string>(),
            structured?["edits"]?.Deserialize<FileEdit[]>(Wire.Json) ?? [],
            structured?["changed"]?.Deserialize<string[]>(Wire.Json) ?? [],
            sessionId, cost, usage, null);
    }

    public static RunOutcome Failed(string message) => new(null, null, [], [], null, null, null, message);
}

public static class FileEdits
{
    /// <summary>All or none, inside the root only; each <c>old</c> exact and unique as Claude Code's Edit requires, an empty one creating the file.</summary>
    /// <returns>The files changed, or why nothing was.</returns>
    public static (string[] Changed, string? Refused) Apply(string root, FileEdit[] edits)
    {
        var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var contents = new Dictionary<string, string>();
        foreach (var edit in edits)
        {
            if (string.IsNullOrWhiteSpace(edit.File))
                return ([], "an edit names no file");
            var path = Path.GetFullPath(Path.Combine(root, edit.File));
            if (!path.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
                return ([], $"{edit.File} is outside the git root");
            if (!contents.TryGetValue(path, out var content))
                content = File.Exists(path) ? File.ReadAllText(path) : "";
            var old = edit.Old ?? "";
            if (old.Length == 0)
            {
                if (File.Exists(path) || contents.ContainsKey(path))
                    return ([], $"{edit.File} exists, and its edit has no old text");
                contents[path] = edit.New ?? "";
                continue;
            }
            var at = content.IndexOf(old, StringComparison.Ordinal);
            if (at < 0)
                return ([], $"the old text is not in {edit.File}");
            if (content.IndexOf(old, at + 1, StringComparison.Ordinal) >= 0)
                return ([], $"the old text is in {edit.File} more than once");
            contents[path] = string.Concat(content.AsSpan(0, at), edit.New ?? "", content.AsSpan(at + old.Length));
        }
        foreach (var (path, content) in contents)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
        }
        return ([.. contents.Keys.Select(path => Path.GetRelativePath(root, path))], null);
    }
}
