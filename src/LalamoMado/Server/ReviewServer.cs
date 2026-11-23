using System.Net;
using System.Text;
using System.Text.Json;
using LalamoMado.Markdown;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

namespace LalamoMado.Server;

public static class ReviewServer
{
    static readonly TimeSpan MaxLongPoll = TimeSpan.FromSeconds(55);
    static readonly FileExtensionContentTypeProvider ContentTypes = new();

    public static string OverlayDirectory => Path.Combine(CommentLabels.ClaudeHome, "edit-md", "client");

    public static async Task<int> RunAsync(int port, string clientDirectory)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { ContentRootPath = AppContext.BaseDirectory });
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.Configuration["AllowedHosts"] = "127.0.0.1;localhost";
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        builder.Services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.DefaultIgnoreCondition = Wire.Json.DefaultIgnoreCondition;
            o.SerializerOptions.Encoder = Wire.Json.Encoder;
        });
        builder.Services.AddSingleton<DocumentRegistry>();
        builder.Services.AddSingleton(new Preferences(Preferences.DefaultPath));
        builder.Services.AddSingleton(new LastSeenVersions(LastSeenVersions.NextTo(Preferences.DefaultPath)));
        builder.Services.AddSingleton(new LocalDictation(LocalDictation.NextTo(Preferences.DefaultPath)));
        builder.Services.AddSingleton(new CommentLabels(Path.Combine(clientDirectory, CommentLabels.FileName), CommentLabels.DefaultUserPath));
        builder.Services.AddSingleton(new SendButtons(Path.Combine(clientDirectory, SendButtons.FileName), SendButtons.DefaultUserPath));
        builder.Services.AddSingleton(new Glossary(Glossary.DefaultUserPath));
        builder.Services.AddSingleton<SkillsRun>();
        var serveFolder = Environment.CurrentDirectory;
        builder.Services.AddSingleton(services => new DelegatedRuns(services.GetRequiredService<CommentLabels>(), services.GetRequiredService<DocumentRegistry>(), serveFolder));

        var app = builder.Build();
        var instance = Guid.NewGuid().ToString("N")[..8];
        var startedAt = DateTimeOffset.Now;
        var stopping = app.Lifetime.ApplicationStopping;
        stopping.Register(() =>
        {
            foreach (var document in app.Services.GetRequiredService<DocumentRegistry>().All)
                document.Runs.CancelAll();
        });
        // 🎨 Customize the page (plan 17): the reviewer's changed page files, served before the installed ones; a reinstall never touches the folder.
        var overlayDirectory = Directory.CreateDirectory(OverlayDirectory).FullName;
        var clientFiles = new CompositeFileProvider(new PhysicalFileProvider(overlayDirectory), new PhysicalFileProvider(clientDirectory));
        string baseUrl = "";

        // A reinstall or a tailored client swaps these files under a running browser: always revalidate, never serve a stale module.
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = clientFiles,
            OnPrepareResponse = context => context.Context.Response.Headers.CacheControl = "no-cache",
        });

        app.MapGet("/", (DocumentRegistry registry) => Results.Content(IndexPage(registry), "text/html; charset=utf-8"));
        // The shell lives at /d/{docId}/ so relative links and images in the markdown resolve beside the file.
        app.MapGet("/d/{docId}/{**relative}", (string docId, string? relative, DocumentRegistry registry, HttpContext http) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound();
            if (!string.IsNullOrEmpty(relative))
                return FileBesideDocument(document, relative);
            if (!http.Request.Path.Value!.EndsWith('/'))
                return Results.Redirect($"/d/{docId}/");
            http.Response.Headers.CacheControl = "no-cache";
            return Results.File(clientFiles.GetFileInfo("index.html").PhysicalPath!, "text/html; charset=utf-8");
        });

        var api = app.MapGroup("/api");
        LocalDictation.Map(api);

        api.MapGet("/status", (DocumentRegistry registry) =>
            new ServerStatus(baseUrl, Environment.ProcessId, instance, startedAt,
                registry.All.Select(d => new DocumentStatus(d.DocId, d.Round, d.Path, DocUrl(baseUrl, d), d.BrowserConnected, d.Submitted,
                    registry.AgentEvents.PendingFor(d.DocId))).ToArray()));

        api.MapPost("/open", (OpenRequest request, DocumentRegistry registry, CommentLabels labels) =>
        {
            if (!File.Exists(request.Path))
                return Results.NotFound(new { error = $"No such file: {request.Path}" });
            var (document, reopened) = registry.Open(request.Path);
            if (reopened && document.BrowserConnected)
                document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Reload, DateTimeOffset.Now));
            var launch = request.LaunchBrowser && !document.BrowserConnected
                ? BrowserLauncher.Open(DocUrl(baseUrl, document), newWindow: !registry.All.Any(d => d.BrowserConnected))
                : null;
            return Results.Ok(new OpenResult(document.DocId, DocUrl(baseUrl, document), document.Path, reopened, document.BrowserConnected,
                launch?.Browser, launch?.NewWindow, document.Changes.Length, labels.For(document.Path, document.SessionLabels).Custom ? "custom" : "default"));
        });

        api.MapGet("/docs/{docId}", (string docId, DocumentRegistry registry) =>
            registry.Find(docId) is { } d ? Results.Ok(d.ServeView(instance)) : Results.NotFound());

        api.MapGet("/docs/{docId}/labels", (string docId, DocumentRegistry registry, CommentLabels labels) =>
            registry.Find(docId) is { } d ? Results.Ok(labels.For(d.Path, d.SessionLabels)) : Results.NotFound());

        // The session list: set by the agent for this review only; an empty list that replaces nothing clears it.
        api.MapPost("/docs/{docId}/labels", (string docId, LabelList list, DocumentRegistry registry, CommentLabels labels) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound(new { error = $"Unknown doc {docId}" });
            if (CommentLabels.Problem(list) is { } problem)
                return Results.BadRequest(new { error = problem });
            document.SessionLabels = list is { Labels.Length: 0, Replace: false } ? null : list;
            document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Labels, DateTimeOffset.Now));
            return Results.Ok(labels.For(document.Path, document.SessionLabels));
        });

        api.MapGet("/docs/{docId}/buttons", (string docId, DocumentRegistry registry, SendButtons buttons) =>
            registry.Find(docId) is { } d ? Results.Ok(buttons.For(d.Path, d.SessionButtons)) : Results.NotFound());

        // The session list: set by the agent for this review only; an empty list that replaces nothing clears it.
        api.MapPost("/docs/{docId}/buttons", (string docId, ButtonList list, DocumentRegistry registry, SendButtons buttons) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound(new { error = $"Unknown doc {docId}" });
            if (SendButtons.Problem(list) is { } problem)
                return Results.BadRequest(new { error = problem });
            document.SessionButtons = list is { Buttons.Length: 0, Replace: false } ? null : list;
            document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Buttons, DateTimeOffset.Now));
            return Results.Ok(buttons.For(document.Path, document.SessionButtons));
        });

        api.MapGet("/docs/{docId}/glossary", (string docId, DocumentRegistry registry, Glossary glossary) =>
            registry.Find(docId) is { } d ? Results.Ok(glossary.For(d.Path)) : Results.NotFound());

        api.MapPost("/docs/{docId}/glossary", (string docId, RememberedMishearing correction, DocumentRegistry registry, Glossary glossary) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound(new { error = $"Unknown doc {docId}" });
            try
            {
                return Results.Ok(glossary.Remember(document.Path, correction));
            }
            catch (GlossaryRefusal refusal)
            {
                return Results.BadRequest(new { error = refusal.Message });
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return Results.Conflict(new { error = e.Message });
            }
        });

        api.MapGet("/docs/{docId}/skills", (string docId, DocumentRegistry registry, SkillsRun skillsRun) =>
            registry.Find(docId) is { } d ? Results.Ok(skillsRun.Marked(SkillCatalog.For(d.Path, serveFolder, CommentLabels.ClaudeHome))) : Results.NotFound());

        api.MapPost("/skills/ran", (SkillsRanRequest request, SkillsRun skillsRun) => Results.Ok(new { ran = skillsRun.Add(request.Names) }));

        api.MapGet("/models", (Preferences preferences) => Results.Ok(preferences.View(null).Pc[ModelsKey] ?? new System.Text.Json.Nodes.JsonArray()));

        api.MapPost("/models", (System.Text.Json.Nodes.JsonArray models, Preferences preferences) =>
        {
            preferences.Set(PreferenceScopes.Pc, null, ModelsKey, models);
            return Results.Ok(new { saved = models.Count });
        });

        api.MapPost("/docs/{docId}/delegate", (string docId, BriefRequest request, DocumentRegistry registry, DelegatedRuns runs) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound(new { error = $"Unknown doc {docId}" });
            if (document.Runs.TakeAwaitingBrief(request.AnnotationId) is not { } waiting)
                return Results.NotFound(new { error = $"{request.AnnotationId} is not waiting for a brief." });
            runs.Start(document, waiting.Annotation, waiting.Choice, request.Brief);
            return Results.Ok(new { started = request.AnnotationId });
        });

        api.MapPost("/docs/{docId}/runs/{id}/cancel", (string docId, string id, DocumentRegistry registry) =>
        {
            registry.Find(docId)?.Runs.Cancel(id);
            return Results.NoContent();
        });

        // The reviewer's own click: re-read the file and re-render in place; nothing reloads on its own.
        api.MapPost("/docs/{docId}/reload", (string docId, DocumentRegistry registry) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound(new { error = $"Unknown doc {docId}" });
            registry.Open(document.Path);
            document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Reload, DateTimeOffset.Now));
            return Results.NoContent();
        });

        api.MapGet("/docs/{docId}/threads/{id}", (string docId, string id, DocumentRegistry registry) =>
            registry.Find(docId)?.Threads.View(id) is { } thread ? Results.Ok(thread) : Results.NotFound(new { error = $"No thread {id} in {docId}." }));

        api.MapPost("/docs/{docId}/marks", (string docId, MarkRequest request, DocumentRegistry registry) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound(new { error = $"Unknown doc {docId}" });
            if (string.IsNullOrWhiteSpace(request.Set) || request.Marks is null || request.Marks.Any(mark => string.IsNullOrWhiteSpace(mark?.Label)))
                return Results.BadRequest(new { error = "Needs a set name and a list of marks, each with a label and a quote." });
            return Results.Ok(document.Mark(request.Set.Trim(), request.Marks));
        });

        api.MapPost("/docs/{docId}/unmark", (string docId, UnmarkRequest request, DocumentRegistry registry) =>
            registry.Find(docId) is { } document ? Results.Ok(new { dropped = document.Unmark(request.Set) }) : Results.NotFound(new { error = $"Unknown doc {docId}" }));

        api.MapPost("/docs/{docId}/events", (string docId, BrowserEvent browserEvent, DocumentRegistry registry, DelegatedRuns runs, SendButtons buttons, Glossary glossary) =>
            registry.Find(docId) is { } document ? AcceptBrowserEvent(registry, document, browserEvent, runs, buttons, glossary) : Results.NotFound());

        // Only the page's own polls carry a tab id; anything else may read the inbox but never counts as a tab.
        api.MapGet("/docs/{docId}/inbox", async (string docId, long? after, int? timeout, string? tab, DocumentRegistry registry, HttpContext http) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound();
            var isTab = !string.IsNullOrEmpty(tab);
            var (presence, round) = (document.Presence, document.Round);
            if (isTab && presence.PollStarted())
                TabCameBack(registry, document);
            try
            {
                using var cancel = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted, stopping);
                var messages = await document.Inbox.ReadAfterAsync(after ?? 0, PollTimeout(timeout, 25), cancel.Token);
                return messages.Count == 0 ? Results.NoContent() : Results.Ok(messages);
            }
            catch (OperationCanceledException)
            {
                return Results.NoContent();
            }
            finally
            {
                if (isTab)
                    presence.PollEnded(reason => TabGone(registry, document, round, reason));
            }
        });

        api.MapPost("/docs/{docId}/leaving", (string docId, DocumentRegistry registry) =>
        {
            if (registry.Find(docId) is { } document)
            {
                var round = document.Round;
                document.Presence.Leaving(reason => TabGone(registry, document, round, reason));
            }
            return Results.NoContent();
        });

        api.MapPost("/docs/{docId}/push", (string docId, PushRequest push, DocumentRegistry registry) =>
        {
            if (registry.Find(docId) is not { } document)
                return Results.NotFound(new { error = $"Unknown doc {docId}" });
            if (document.Submitted)
                return Results.Conflict(new { error = $"Review {docId} is submitted and its page closed; answer in chat, or `edit-md open` the path again for a new round." });
            if (string.IsNullOrWhiteSpace(push.Text))
                return Results.BadRequest(new { error = "Reply text is empty." });
            if (push.FixId is { } fixId)
            {
                var suggestion = document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Fix, DateTimeOffset.Now, Text: push.Text.Trim(), FixId: fixId));
                return Results.Ok(new { suggestion.Seq, document.BrowserConnected });
            }
            var threadId = push.AnnotationId is { } answered ? document.Threads.RootOf(answered) : null;
            var message = document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Reply, DateTimeOffset.Now,
                MarkdownRendering.ToHtml(push.Text), threadId, push.Quote));
            document.Threads.RecordReply(threadId ?? $"r{message.Seq}", push.Text.Trim(), push.Quote, message.At);
            return Results.Ok(new { message.Seq, document.BrowserConnected });
        });

        api.MapGet("/next", async (string? docId, int? timeout, DocumentRegistry registry, HttpContext http) =>
        {
            try
            {
                using var cancel = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted, stopping);
                var next = await registry.AgentEvents.TakeNextAsync(docId, PollTimeout(timeout, 50), cancel.Token);
                return next is null ? Results.NoContent() : Results.Ok(next);
            }
            catch (OperationCanceledException)
            {
                return Results.StatusCode((int)HttpStatusCode.ServiceUnavailable);
            }
        });

        api.MapGet("/prefs", (string? docId, DocumentRegistry registry, Preferences preferences) =>
            Results.Ok(preferences.View(docId is null ? null : registry.Find(docId)?.Path)));

        api.MapPost("/prefs", (PreferenceRequest request, DocumentRegistry registry, Preferences preferences) =>
        {
            if (!PreferenceScopes.IsKnown(request.Scope) || string.IsNullOrWhiteSpace(request.Key) || request.Key.Length > 100)
                return Results.BadRequest(new { error = "Needs a scope (pc, repo, session, document) and a key." });
            var documentPath = request.DocId is null ? null : registry.Find(request.DocId)?.Path;
            if (request.Scope == PreferenceScopes.Document && documentPath is null)
                return Results.NotFound(new { error = "A document preference needs an open document." });
            try
            {
                preferences.Set(request.Scope, documentPath, request.Key, request.Value);
            }
            catch (PreferenceRefusal refusal)
            {
                return Results.BadRequest(new { error = refusal.Message });
            }
            return Results.Ok(new { saved = true });
        });

        // Label hotkeys follow the labels in effect: the document's, else those of the folder the agent runs in.
        Setting[] SettingsFor(ReviewDocument? document, string? where, LocalDictation local, CommentLabels labels)
        {
            // Labels are looked up for a document; a file name in the folder stands in for one, as only its folder counts.
            var documentOrStandIn = document?.Path ?? Path.Combine(where ?? Environment.CurrentDirectory, "settings.md");
            return SettingsRegistry.For(local.Status(), labels.For(documentOrStandIn, document?.SessionLabels).Labels);
        }

        api.MapGet("/settings", (string? docId, string? where, DocumentRegistry registry, Preferences preferences, LocalDictation local, CommentLabels labels) =>
        {
            var document = docId is null ? null : registry.Find(docId);
            return Results.Ok(new { settings = SettingsRegistry.Listed(SettingsFor(document, where, local, labels), preferences.View(document?.Path, where)) });
        });

        // The agent's way in: checked against the registry, kept, and shown at once in every open page through its inbox.
        api.MapPost("/settings", (SettingRequest request, DocumentRegistry registry, Preferences preferences, LocalDictation local, CommentLabels labels) =>
        {
            try
            {
                var document = request.DocId is null ? null : registry.Find(request.DocId) ?? throw new SettingRefusal($"No open document {request.DocId}.");
                var setting = SettingsRegistry.Find(SettingsFor(document, request.Where, local, labels), request.Key);
                var scope = SettingsRegistry.ScopeFor(setting, request.Scope);
                if (scope == PreferenceScopes.Document && document is null)
                    throw new SettingRefusal("A document setting needs its document: `edit-md settings <docId> --set …`.");
                var value = request.Value is null ? null : SettingsRegistry.Parse(setting, request.Value);
                preferences.Set(scope, document?.Path, setting.Key, value, request.Where);
                var change = new SettingChange(setting.Key, scope, value);
                foreach (var open in document is not null && scope == PreferenceScopes.Document ? [document] : registry.All)
                    open.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Setting, DateTimeOffset.Now, Setting: change));
                return Results.Ok(new { setting = SettingsRegistry.Listed([setting], preferences.View(document?.Path, request.Where))[0], scope });
            }
            catch (Exception refusal) when (refusal is SettingRefusal or PreferenceRefusal)
            {
                return Results.BadRequest(new { error = refusal.Message });
            }
        });

        api.MapPost("/ack", (AckRequest ack, DocumentRegistry registry) =>
        {
            var delivered = registry.AgentEvents.Acknowledge(ack.Seq);
            if (delivered is { Kind: EventKinds.Send, Annotations: { } sent } && registry.Find(delivered.DocId) is { } document)
                document.Inbox.Append(seq => new InboxMessage(seq, InboxKinds.Delivered, DateTimeOffset.Now, AnnotationIds: sent.Select(a => a.Id).ToArray()));
            return Results.Ok(new { acknowledged = delivered is not null });
        });

        api.MapGet("/events", (string? docId, DocumentRegistry registry) =>
            registry.AgentEvents.History(docId).Select(entry => new { State = entry.State.ToString().ToLowerInvariant(), entry.Event }));

        api.MapPost("/shutdown", (IHostApplicationLifetime lifetime) =>
        {
            lifetime.StopApplication();
            return Results.Ok(new { stopping = true });
        });

        _ = Task.Run(BrowserLauncher.PruneStaleProfiles);
        await app.StartAsync();
        baseUrl = app.Services.GetRequiredService<IServer>().Features.GetRequiredFeature<IServerAddressesFeature>().Addresses.First();
        ServerStateFile.Write(new ServerState(baseUrl, Environment.ProcessId, instance, startedAt));
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            status = "listening",
            url = baseUrl,
            pid = Environment.ProcessId,
            instance,
            stateFile = ServerStateFile.FilePath,
            client = clientDirectory,
            overlay = overlayDirectory,
        }, Wire.Json));

        try
        {
            await app.WaitForShutdownAsync();
        }
        finally
        {
            ServerStateFile.DeleteIfOwnedBy(instance);
        }
        return 0;
    }

    const string ModelsKey = "delegated.models";

    static RunChoice ChoiceFrom(AgentTicks ticks, SendButton? button) =>
        button is not null
            ? new(button.By, button.Repo, button.Edit, button.Model ?? ticks.Model, button, KnownEffort(button.Effort ?? ticks.Effort))
            : new(ticks.Brief ? AnswererKinds.Brief : AnswererKinds.New, ticks.Repo, ticks.Edit, ticks.Model, null, KnownEffort(ticks.Effort));

    static string? KnownEffort(string? effort) => RunPlan.Efforts.Contains(effort) ? effort : null;

    static IResult AcceptBrowserEvent(DocumentRegistry registry, ReviewDocument document, BrowserEvent browserEvent, DelegatedRuns runs, SendButtons buttons, Glossary glossary)
    {
        if (document.Submitted)
            return Results.Conflict(new { error = "This review is already submitted." });
        var located = (browserEvent.Annotations ?? []).Select(document.Locate).ToArray();
        var docId = document.DocId;
        AgentEvent raised;
        switch (browserEvent.Kind)
        {
            case EventKinds.Send when located.Length > 0:
                // A reply answers exactly one query; a group is always silent.
                var mode = located.Length == 1 && browserEvent.Mode != "silent" ? "reply" : "silent";
                var button = browserEvent.Agent?.Button is { } buttonId ? buttons.For(document.Path, document.SessionButtons).Buttons.FirstOrDefault(known => known.Id == buttonId) : null;
                if (browserEvent.Agent?.Button is not null && button is null)
                    return Results.BadRequest(new { error = $"No send button {browserEvent.Agent.Button}." });
                foreach (var annotation in located)
                    document.Threads.RecordSent(annotation, DateTimeOffset.Now);
                var query = located[0];
                var locatedForPage = located.Select(a => new LocatedAnnotation(a.Id, a.Lines)).ToArray();
                if (mode == "reply" && query.ReplyTo is { } followedThread && document.Runs.Thread(followedThread) is not null)
                {
                    runs.FollowUp(document, followedThread, query);
                    return Results.Ok(new EventAccepted(0, locatedForPage, true, true));
                }
                var choice = mode == "reply" && browserEvent.Agent is { } ticks ? ChoiceFrom(ticks, button) : null;
                if (choice is { By: AnswererKinds.New })
                {
                    runs.Start(document, query, choice, null);
                    return Results.Ok(new EventAccepted(0, locatedForPage, true, true));
                }
                if (choice is { By: AnswererKinds.Brief })
                    document.Runs.AwaitBrief(query.Id, query, choice);
                raised = registry.Raise(document, EventKinds.Send, e => e with
                {
                    Mode = mode,
                    Annotations = located,
                    FileChanged = document.FileChangedOnDisk() ? true : null,
                    Agent = choice is { By: AnswererKinds.Brief } ? browserEvent.Agent : null,
                    Button = button,
                    Glossary = GlossaryFor(glossary, document, located),
                    Hint = choice is { By: AnswererKinds.Brief }
                        ? $"write a brief from what you know, not the answer: `delegate {docId} --to {query.Id}` (brief on stdin), then `wait {docId}`"
                    : mode != "reply"
                        ? $"work the group, no reply; then `wait {docId}`"
                        : located[0].ReplyTo is { } threadId
                            ? $"a follow-up: answer with `push {docId} --to {threadId}` (markdown on stdin), then `wait {docId}`; `thread {docId} {threadId}` prints the whole thread"
                            : $"answer: `push {docId} --to {located[0].Id}` (markdown on stdin), then `wait {docId}`",
                });
                break;
            case EventKinds.Fix when located.Length == 1 && !string.IsNullOrWhiteSpace(browserEvent.FixId):
                raised = registry.Raise(document, EventKinds.Fix, e => e with
                {
                    FixId = browserEvent.FixId,
                    Annotations = located,
                    Glossary = GlossaryFor(glossary, document, located, always: true),
                    Hint = $"correct misheard words against the document, then `push {docId} --fix {browserEvent.FixId}` (corrected text on stdin), then `wait {docId}`",
                });
                break;
            case EventKinds.Submit:
                var decision = browserEvent.Decision is { } chosen && Decisions.FollowUp.ContainsKey(chosen)
                    ? chosen
                    : located.Length == 0 ? Decisions.Approve : Decisions.ApplyReview;
                document.Submitted = true;
                document.Runs.CancelAll();
                raised = registry.Raise(document, EventKinds.Submit, e => e with
                {
                    Decision = decision,
                    Annotations = located,
                    FileChanged = document.FileChangedOnDisk(),
                    Glossary = GlossaryFor(glossary, document, located),
                    Hint = Decisions.FollowUp[decision].Replace("{path}", document.Path).Replace("{docId}", docId),
                });
                break;
            default:
                return Results.BadRequest(new { error = $"Unsupported event '{browserEvent.Kind}'." });
        }
        return Results.Ok(new EventAccepted(raised.Seq, located.Select(a => new LocatedAnnotation(a.Id, a.Lines)).ToArray(),
            registry.AgentEvents.AgentListening));
    }

    /// <summary>The agent reads dictated words against the reviewer's terms; a fix is about misheard words whatever the page marked.</summary>
    static EffectiveGlossary? GlossaryFor(Glossary glossary, ReviewDocument document, AgentAnnotation[] annotations, bool always = false) =>
        always || annotations.Any(annotation => annotation.Dictated == true) ? glossary.For(document.Path).ForAgent() : null;

    /// <summary>Submit is the deliberate end and closes the page itself; only a page lost before it is an abort — and only in its own round.</summary>
    static void TabGone(DocumentRegistry registry, ReviewDocument document, int round, string reason)
    {
        if (document.Submitted || document.Round != round)
            return;
        document.AbortRaised = true;
        if (reason == TabPresence.Closed)
            document.Runs.CancelAll();
        registry.Raise(document, EventKinds.Aborted, e => e with
        {
            Reason = reason,
            Hint = reason == TabPresence.Closed
                ? "tab closed unsubmitted: nothing approved; ask in chat"
                : $"tab lost (sleep/crash?): nothing approved; `resumed` follows if it returns — `wait {document.DocId}`",
        });
    }

    /// <summary>A page back before the agent saw its abort just withdraws the abort; one back after it is announced.</summary>
    static void TabCameBack(DocumentRegistry registry, ReviewDocument document)
    {
        if (!document.AbortRaised)
            return;
        document.AbortRaised = false;
        var withdrawn = registry.AgentEvents.Supersede(e => e.DocId == document.DocId && e.Kind == EventKinds.Aborted);
        if (withdrawn == 0)
            registry.Raise(document, EventKinds.Resumed, e => e with { Hint = $"the tab is back; review goes on — `wait {document.DocId}`" });
    }

    static IResult FileBesideDocument(ReviewDocument document, string relative)
    {
        var root = Path.GetDirectoryName(document.Path)!;
        var full = Path.GetFullPath(Path.Combine(root, relative));
        var inside = full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        if (!inside || !File.Exists(full))
            return Results.NotFound();
        return Results.File(full, ContentTypes.TryGetContentType(full, out var type) ? type : "application/octet-stream");
    }

    static TimeSpan PollTimeout(int? requestedSeconds, int defaultSeconds) =>
        TimeSpan.FromSeconds(Math.Clamp(requestedSeconds ?? defaultSeconds, 1, (int)MaxLongPoll.TotalSeconds));

    static string DocUrl(string baseUrl, ReviewDocument document) => $"{baseUrl}/d/{document.DocId}/";

    static string IndexPage(DocumentRegistry registry)
    {
        var html = new StringBuilder("<!doctype html><meta charset=utf-8><title>edit-md</title><link rel=stylesheet href=/app.css><body class=index><h1>edit-md</h1><ul>");
        foreach (var d in registry.All)
            html.Append($"<li><a href=\"/d/{d.DocId}/\">{WebUtility.HtmlEncode(Path.GetFileName(d.Path))}</a> <small>{WebUtility.HtmlEncode(d.Path)}</small></li>");
        return html.Append("</ul>").ToString();
    }
}
