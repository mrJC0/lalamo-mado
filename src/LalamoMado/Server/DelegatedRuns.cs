using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using LalamoMado.Markdown;

namespace LalamoMado.Server;

public static class RunStates
{
    public const string Waiting = "waiting";
    public const string Answering = "answering";
    public const string Done = "done";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
}

/// <summary>A document's runs: which threads belong to a separate agent, and what is still running. Runs end with the round.</summary>
public sealed class DocumentRuns
{
    readonly Lock gate = new();
    readonly Dictionary<string, ThreadRun> threads = [];
    readonly Dictionary<string, (AgentAnnotation Annotation, RunChoice Choice)> awaitingBrief = [];

    public sealed class ThreadRun(RunChoice choice, RunSetup setup)
    {
        public RunChoice Choice { get; } = choice;
        public RunSetup Setup { get; set; } = setup;
        public SemaphoreSlim OneAtATime { get; } = new(1, 1);
        public Process? Process { get; set; }
        public bool Cancelled { get; set; }
        public bool Running { get; set; }
    }

    public ThreadRun? Thread(string id)
    {
        lock (gate)
            return threads.GetValueOrDefault(id);
    }

    public void Add(string id, ThreadRun run)
    {
        lock (gate)
            threads[id] = run;
    }

    public void AwaitBrief(string id, AgentAnnotation annotation, RunChoice choice)
    {
        lock (gate)
            awaitingBrief[id] = (annotation, choice);
    }

    public (AgentAnnotation Annotation, RunChoice Choice)? TakeAwaitingBrief(string id)
    {
        lock (gate)
            return awaitingBrief.Remove(id, out var waiting) ? waiting : null;
    }

    public void Cancel(string id)
    {
        lock (gate)
            if (threads.TryGetValue(id, out var run))
                Stop(run);
    }

    public void CancelAll()
    {
        lock (gate)
            foreach (var run in threads.Values)
                Stop(run);
    }

    static void Stop(ThreadRun run)
    {
        if (!run.Running)
            return;
        run.Cancelled = true;
        try
        {
            run.Process?.Kill(entireProcessTree: true);
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
        }
    }
}

/// <summary>What the reviewer chose for one send: the ticks, or a send button with its own settings.</summary>
public sealed record RunChoice(string By, bool Repo, bool Edit, string? Model, SendButton? Button, string? Effort = null);

/// <summary>Starts a headless Claude Code run per request, captures its result and pushes it as the reply, so the run needs no edit-md, no session and no server.</summary>
public sealed class DelegatedRuns(CommentLabels labels, DocumentRegistry registry, string serveFolder)
{
    static readonly string[] SessionMarkers = ["CLAUDE_CODE_SESSION_ID", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];
    const string MessagingMarkerPrefix = "CLAUDE_CODE_MESSAGING_";

    readonly ConcurrentDictionary<string, SemaphoreSlim> editGatesByRoot = new(StringComparer.OrdinalIgnoreCase);

    public RunSetup SetupFor(string documentPath, RunChoice choice)
    {
        var (folder, addDir) = FoldersFor(documentPath, serveFolder);
        var button = choice.Button;
        return new RunSetup(folder, addDir, Guid.NewGuid().ToString(),
            Repo: choice.Repo,
            Edit: choice.Edit,
            Model: choice.Model,
            Effort: choice.Effort,
            Allow: button?.Allow,
            System: button?.System,
            MaxTurns: button?.MaxTurns,
            MaxBudgetUsd: button?.MaxBudgetUsd,
            HooksOff: choice.Repo && OutsideTheSessionsRepo(documentPath, serveFolder));
    }

    /// <summary>A run starts in the document's folder; a document outside any git root counts as in the session's repo.</summary>
    public static (string Folder, string? AddDir) FoldersFor(string documentPath, string serveFolder)
    {
        var documentFolder = LongPath.Of(Path.GetDirectoryName(Path.GetFullPath(documentPath))!);
        if (GitRoot.Of(documentPath) is { } root)
        {
            var longRoot = LongPath.Of(root);
            return (documentFolder, SameFolder(longRoot, documentFolder) ? null : longRoot);
        }
        return (LongPath.Of(serveFolder), documentFolder);
    }

    public static bool OutsideTheSessionsRepo(string documentPath, string serveFolder) =>
        GitRoot.Of(documentPath) is { } root && !(GitRoot.Of(serveFolder) is { } sessionRoot && SameFolder(root, sessionRoot));

    static bool SameFolder(string a, string b) =>
        string.Equals(Path.GetFullPath(a).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(b).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);

    public void Start(ReviewDocument document, AgentAnnotation annotation, RunChoice choice, string? brief)
    {
        var description = annotation.Label is { } label
            ? labels.For(document.Path, document.SessionLabels).Labels.FirstOrDefault(known => known.Id == label)?.Description
            : null;
        var prompt = RunPlan.Prompt(LongPath.Of(document.Path), annotation, description, choice.Button?.Prompt, brief);
        var run = new DocumentRuns.ThreadRun(choice, SetupFor(document.Path, choice));
        document.Runs.Add(annotation.Id, run);
        var who = RunPlan.Who(choice.Model, choice.Repo, brief is not null, choice.Edit, choice.Repo ? RunPlan.LeadingSkill(annotation.Text ?? "") : null, choice.Effort);
        _ = Task.Run(() => RunAsync(document, annotation.Id, run, prompt, who));
    }

    /// <summary>A follow-up goes back to the same run, so the thread keeps its agent, its context and its ticks.</summary>
    public void FollowUp(ReviewDocument document, string thread, AgentAnnotation followUp)
    {
        var run = document.Runs.Thread(thread)!;
        run.Setup = run.Setup with { Resume = true };
        var who = RunPlan.Who(run.Choice.Model, run.Choice.Repo, false, run.Choice.Edit, effort: run.Choice.Effort);
        _ = Task.Run(() => RunAsync(document, thread, run, RunPlan.FollowUpPrompt(followUp), who));
    }

    async Task RunAsync(ReviewDocument document, string thread, DocumentRuns.ThreadRun run, string prompt, string who)
    {
        void Announce(string state, string? error = null) =>
            document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Run, DateTimeOffset.Now, AnnotationId: thread, RunState: state, By: who, Error: error, MayEdit: run.Choice.Edit ? true : null));

        var root = GitRoot.Of(document.Path) ?? GitRoot.Of(serveFolder) ?? serveFolder;
        var editGate = run.Choice.Edit ? editGatesByRoot.GetOrAdd(root, _ => new SemaphoreSlim(1, 1)) : null;
        Announce(RunStates.Waiting);
        await run.OneAtATime.WaitAsync();
        run.Cancelled = false;
        run.Running = true;
        try
        {
            if (editGate is not null)
                await editGate.WaitAsync();
            try
            {
                if (run.Cancelled)
                {
                    Announce(RunStates.Cancelled);
                    return;
                }
                Announce(RunStates.Answering);
                var outcome = await ExecuteAsync(run, prompt);
                if (run.Cancelled)
                {
                    Announce(RunStates.Cancelled);
                    return;
                }
                if (outcome.SessionId is { } sessionId)
                    run.Setup = run.Setup with { SessionId = sessionId };
                if (outcome.Error is { } error)
                {
                    Announce(RunStates.Failed, error);
                    return;
                }
                Deliver(document, thread, run, outcome, root, who);
                Announce(RunStates.Done);
            }
            finally
            {
                editGate?.Release();
            }
        }
        catch (Exception e) when (e is IOException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Announce(RunStates.Failed, $"Could not run claude: {e.Message}");
        }
        finally
        {
            run.Running = false;
            run.Process = null;
            run.OneAtATime.Release();
        }
    }

    void Deliver(ReviewDocument document, string thread, DocumentRuns.ThreadRun run, RunOutcome outcome, string root, string who)
    {
        string? note = null;
        var changed = outcome.Changed;
        if (run.Choice.Edit && outcome.Edits.Length > 0)
        {
            var (applied, refused) = FileEdits.Apply(root, outcome.Edits);
            changed = [.. changed.Concat(applied).Distinct()];
            if (refused is not null)
                note = $"Its edits under .claude/ were refused, none applied: {refused}.";
        }
        var answer = outcome.Answer!;
        var message = document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Reply, DateTimeOffset.Now,
            MarkdownRendering.ToHtml(answer), thread, By: who, Suggestion: outcome.Suggestion, Changed: changed.Length > 0 ? changed : null,
            DocumentChanged: document.FileChangedOnDisk() ? true : null, Note: note, CostUsd: outcome.CostUsd));
        document.Threads.RecordReply(thread, answer, null, message.At);
        if (run.Choice.Button is { TellSession: true })
            registry.Raise(document, EventKinds.Send, e => e with
            {
                Mode = "silent",
                Annotations = [new($"{thread}-told", null, $"A separate run answered {thread}: {answer}", "general", null, null, null, null, null)],
                Hint = $"note it, no reply; then `wait {document.DocId}`",
            });
    }

    async Task<RunOutcome> ExecuteAsync(DocumentRuns.ThreadRun run, string prompt)
    {
        var claude = FindClaude() ?? throw new IOException("claude is not on PATH.");
        var startInfo = new ProcessStartInfo
        {
            WorkingDirectory = run.Setup.Folder,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        // An npm install is a .cmd shim, which only cmd.exe can start, and cmd.exe ends a command at a line break.
        var viaShim = claude.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase);
        if (viaShim)
        {
            startInfo.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
            startInfo.ArgumentList.Add("/c");
            startInfo.ArgumentList.Add(claude);
        }
        else
            startInfo.FileName = claude;
        foreach (var argument in RunPlan.Arguments(run.Setup))
            startInfo.ArgumentList.Add(viaShim ? argument.ReplaceLineEndings(" ") : argument);
        foreach (var marker in SessionMarkers)
            startInfo.Environment.Remove(marker);
        // It outranks --effort, so a level set for the whole machine would override the one picked for this run.
        if (run.Setup.Effort is not null)
            startInfo.Environment.Remove("CLAUDE_CODE_EFFORT_LEVEL");
        foreach (var name in startInfo.Environment.Keys.Where(name => name.StartsWith(MessagingMarkerPrefix, StringComparison.Ordinal)).ToArray())
            startInfo.Environment.Remove(name);
        if (!run.Setup.Repo)
            startInfo.Environment["CLAUDE_CODE_DISABLE_BUNDLED_SKILLS"] = "1";

        using var process = Process.Start(startInfo) ?? throw new IOException("claude did not start.");
        run.Process = process;
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        await process.StandardInput.WriteAsync(prompt);
        process.StandardInput.Close();

        using var timeout = new CancellationTokenSource();
        if (run.Choice.Button?.TimeoutSeconds is { } seconds)
            timeout.CancelAfter(TimeSpan.FromSeconds(seconds));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            return RunOutcome.Failed($"Timed out after {run.Choice.Button!.TimeoutSeconds} s.");
        }
        return RunOutcome.Parse(await output, await errors);
    }

    static string? FindClaude()
    {
        if (Environment.GetEnvironmentVariable("EDIT_MD_CLAUDE") is { Length: > 0 } configured)
            return configured;
        var names = OperatingSystem.IsWindows() ? new[] { "claude.exe", "claude.cmd" } : ["claude"];
        foreach (var folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            foreach (var name in names)
                if (File.Exists(Path.Combine(folder, name)))
                    return Path.Combine(folder, name);
        return Environment.GetEnvironmentVariable("CLAUDE_CODE_EXECPATH") is { Length: > 0 } extension && File.Exists(extension) ? extension : null;
    }
}
