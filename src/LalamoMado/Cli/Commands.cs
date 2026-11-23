using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LalamoMado.Server;

namespace LalamoMado.Cli;

public static class Commands
{
    const string Usage = """
        edit-md — review a Markdown file in the browser and get the annotations back.

          edit-md serve [--port N] [--client DIR]       resident server; launch with run_in_background
          edit-md open <path> [--no-browser]            register + show a file → {docId, url}
          edit-md wait [docId] [--timeout SEC]          block until the next browser event; launch with run_in_background
          edit-md push <docId> [--to annotationId] [--quote TEXT] [--text MD] [--fix fixId]
                                                        reply into the page; markdown from --text or stdin;
                                                        --fix answers a fix request with the corrected text
          edit-md thread <docId> <id>                   a whole thread in order: quote, lines, every turn
          edit-md labels <docId> [--set | --clear]      the doc's effective label list; --set takes a session list on stdin
          edit-md buttons <docId> [--set | --clear]     the doc's send buttons; --set takes a session list on stdin
          edit-md glossary <docId>                      the reviewer's terms and known mishearings, and Whisper's prompt made of them
          edit-md models [--set]                        the models the page offers; --set takes [{id, name}] on stdin
          edit-md settings [docId] [--set KEY=VALUE | --unset KEY] [--scope pc|repo|session|document]
                                                        every setting with its description, value and where it comes from;
                                                        --set changes one and every open page shows it; kept for this PC by default
          edit-md delegate <docId> --to <id>            hand a request to a separate run; the brief on stdin
          edit-md skills <docId>                        the user's and the repo's skills the page lists
          edit-md skills --ran <name>...                user-only skills this session has run; the picker drops their ❗
          edit-md mark <docId> --set NAME               highlight spans in the page; JSON on stdin: [{label, quote, note, lines?, focus?}]
                                                        a new NAME adds a set, a NAME in use replaces that set
          edit-md unmark <docId> (NAME | --all)         drop a set of marks, or all of them
          edit-md status                                server + open docs
          edit-md events [docId]                        every event so far, delivered or not
          edit-md stop                                  shut the server down

        Server state: $EDIT_MD_HOME, else <temp>/edit-md/<CLAUDE_CODE_SESSION_ID>/server.json
        """;

    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Length == 0 || args[0] is "help" or "--help" or "-h")
        {
            Console.WriteLine(Usage);
            return args.Length == 0 ? 2 : 0;
        }
        try
        {
            var rest = args.Skip(1);
            return args[0] switch
            {
                "serve" => await Serve(Arguments.Parse(rest)),
                "open" => await Open(Arguments.Parse(rest, "no-browser")),
                "wait" => await Wait(Arguments.Parse(rest)),
                "push" => await Push(Arguments.Parse(rest)),
                "thread" => await Thread(Arguments.Parse(rest)),
                "labels" => await Labels(Arguments.Parse(rest, "set", "clear")),
                "buttons" => await Buttons(Arguments.Parse(rest, "set", "clear")),
                "glossary" => await GlossaryOf(Arguments.Parse(rest)),
                "models" => await Models(Arguments.Parse(rest, "set")),
                "settings" => await SettingsOf(Arguments.Parse(rest)),
                "delegate" => await Delegate(Arguments.Parse(rest)),
                "skills" => await Skills(Arguments.Parse(rest, "ran")),
                "mark" => await Mark(Arguments.Parse(rest)),
                "unmark" => await Unmark(Arguments.Parse(rest, "all")),
                "status" => await Relay(client => client.GetAsync("/api/status")),
                "events" => await Events(Arguments.Parse(rest)),
                "stop" => await Stop(),
                _ => throw new UsageException($"Unknown command '{args[0]}'. Run `edit-md help`."),
            };
        }
        catch (UsageException e)
        {
            return Fail(e.Message);
        }
    }

    static async Task<int> Serve(Arguments args)
    {
        if (ServerStateFile.Read() is { } running && await ServerClient.IsAliveAsync(running))
        {
            Print(new { status = "already-running", running.Url, running.Pid, running.Instance });
            return 0;
        }
        var clientDirectory = args.Value("client") ?? Environment.GetEnvironmentVariable("EDIT_MD_CLIENT_DIR") ?? Path.Combine(AppContext.BaseDirectory, "client");
        clientDirectory = Path.GetFullPath(clientDirectory);
        if (!File.Exists(Path.Combine(clientDirectory, "index.html")))
            return Fail($"No client at {clientDirectory} (index.html missing).");
        return await ReviewServer.RunAsync(args.Int("port") ?? StablePort.ForSession(Environment.GetEnvironmentVariable("CLAUDE_CODE_SESSION_ID")), clientDirectory);
    }

    static async Task<int> Open(Arguments args)
    {
        var path = args.Positional.FirstOrDefault() ?? throw new UsageException("Usage: edit-md open <path> [--no-browser]");
        path = Path.GetFullPath(path);
        if (!File.Exists(path))
            return Fail($"No such file: {path}");

        using var client = await Connect(TimeSpan.FromSeconds(15));
        if (client is null)
            return NotRunning();
        using var response = await client.PostAsync("/api/open", new OpenRequest(path, LaunchBrowser: !args.Has("no-browser")));
        if (!response.IsSuccessStatusCode)
            return await FailFrom(response);
        var opened = (await response.Content.ReadFromJsonAsync<OpenResult>(Wire.Json))!;
        Print(new
        {
            opened.DocId,
            opened.Url,
            opened.Path,
            opened.Reopened,
            opened.Browser,
            opened.NewWindow,
            opened.Changes,
            opened.Labels,
            hint = opened.Browser == BrowserLauncher.DefaultBrowser ? "No Chrome, Chromium or Edge found: opened in the default browser, without the dedicated review window." : null,
            next = $"Arm the wake-up: `edit-md wait {opened.DocId}` with run_in_background; re-arm after each event.",
        });
        return 0;
    }

    static async Task<int> Wait(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault();
        var overall = args.Int("timeout") is { } seconds ? TimeSpan.FromSeconds(seconds) : Timeout.InfiniteTimeSpan;
        var deadline = overall == Timeout.InfiniteTimeSpan ? DateTimeOffset.MaxValue : DateTimeOffset.UtcNow + overall;

        using var client = await Connect(TimeSpan.FromSeconds(5));
        if (client is null)
            return NotRunning();
        while (DateTimeOffset.UtcNow < deadline)
        {
            var slice = (int)Math.Clamp((deadline - DateTimeOffset.UtcNow).TotalSeconds, 1, 50);
            var query = $"/api/next?timeout={slice}" + (docId is null ? "" : $"&docId={Uri.EscapeDataString(docId)}");
            HttpResponseMessage response;
            try
            {
                response = await client.GetAsync(query);
            }
            catch (HttpRequestException)
            {
                Print(new { kind = "server-stopped", hint = "The edit-md server is gone. Start it again with `edit-md serve` (run_in_background)." });
                return 1;
            }
            using (response)
            {
                if (response.StatusCode == HttpStatusCode.OK)
                {
                    var printed = await response.Content.ReadAsStringAsync();
                    Console.WriteLine(printed);
                    await Acknowledge(client, JsonSerializer.Deserialize<AgentEvent>(printed, Wire.Json)!.Seq);
                    return 0;
                }
                if (response.StatusCode == HttpStatusCode.ServiceUnavailable)
                {
                    Print(new { kind = "server-stopped", hint = "The edit-md server is shutting down." });
                    return 1;
                }
                if (response.StatusCode != HttpStatusCode.NoContent)
                    return await FailFrom(response);
            }
        }
        Print(new { kind = "timeout", docId, hint = "No browser event within --timeout." });
        return 0;
    }

    static async Task<int> Push(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault() ?? throw new UsageException("Usage: edit-md push <docId> [--to annotationId] [--quote TEXT] [--text MD | stdin]");
        var text = args.Value("text");
        if (text is null && Console.IsInputRedirected)
            text = await Console.In.ReadToEndAsync();
        if (string.IsNullOrWhiteSpace(text))
            throw new UsageException("Nothing to push: pass --text or pipe markdown on stdin.");
        return await Relay(client => client.PostAsync($"/api/docs/{Uri.EscapeDataString(docId)}/push", new PushRequest(text.Trim(), args.Value("to"), args.Value("quote"), args.Value("fix"))));
    }

    static Task<int> Thread(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault();
        var id = args.Positional.Skip(1).FirstOrDefault();
        if (docId is null || id is null)
            throw new UsageException("Usage: edit-md thread <docId> <id>");
        return Relay(client => client.GetAsync($"/api/docs/{Uri.EscapeDataString(docId)}/threads/{Uri.EscapeDataString(id)}"));
    }

    static async Task<int> Labels(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault() ?? throw new UsageException("Usage: edit-md labels <docId> [--set (JSON on stdin) | --clear]");
        var route = $"/api/docs/{Uri.EscapeDataString(docId)}/labels";
        if (args.Has("clear"))
            return await Relay(client => client.PostAsync(route, new LabelList([])));
        if (!args.Has("set"))
            return await Relay(client => client.GetAsync(route));
        var json = Console.IsInputRedirected ? await Console.In.ReadToEndAsync() : "";
        LabelList? list;
        try
        {
            list = JsonSerializer.Deserialize<LabelList>(json, Wire.Json);
        }
        catch (JsonException e)
        {
            throw new UsageException($"--set expects {{\"labels\": [...]}} on stdin: {e.Message}");
        }
        return await Relay(client => client.PostAsync(route, list!));
    }

    static async Task<int> Buttons(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault() ?? throw new UsageException("Usage: edit-md buttons <docId> [--set (JSON on stdin) | --clear]");
        var route = $"/api/docs/{Uri.EscapeDataString(docId)}/buttons";
        if (args.Has("clear"))
            return await Relay(client => client.PostAsync(route, new ButtonList([])));
        if (!args.Has("set"))
            return await Relay(client => client.GetAsync(route));
        var json = Console.IsInputRedirected ? await Console.In.ReadToEndAsync() : "";
        ButtonList? list;
        try
        {
            list = JsonSerializer.Deserialize<ButtonList>(json, Wire.Json);
            if (SendButtons.UnknownFields(json).ToArray() is { Length: > 0 } unknown)
                return Fail(string.Join(" ", unknown));
        }
        catch (JsonException e)
        {
            throw new UsageException($"--set expects {{\"buttons\": [...]}} on stdin: {e.Message}");
        }
        return await Relay(client => client.PostAsync(route, list!));
    }

    static Task<int> GlossaryOf(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault() ?? throw new UsageException("Usage: edit-md glossary <docId>");
        return Relay(client => client.GetAsync($"/api/docs/{Uri.EscapeDataString(docId)}/glossary"));
    }

    static async Task<int> Models(Arguments args)
    {
        if (!args.Has("set"))
            return await Relay(client => client.GetAsync("/api/models"));
        var json = Console.IsInputRedirected ? await Console.In.ReadToEndAsync() : "";
        System.Text.Json.Nodes.JsonArray? models;
        try
        {
            models = System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonArray;
        }
        catch (JsonException e)
        {
            throw new UsageException($"--set expects [{{\"id\": ..., \"name\": ...}}] on stdin: {e.Message}");
        }
        if (models is null)
            throw new UsageException("--set expects [{\"id\": ..., \"name\": ...}] on stdin.");
        return await Relay(client => client.PostAsync("/api/models", models));
    }

    /// <summary>Without a document, the repo level is the one of the folder the agent runs in.</summary>
    static async Task<int> SettingsOf(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault();
        var where = Environment.CurrentDirectory;
        if (args.Value("set") is { } assignment)
        {
            var split = assignment.IndexOf('=');
            if (split <= 0)
                throw new UsageException("Usage: edit-md settings [docId] --set KEY=VALUE [--scope pc|repo|session|document]");
            return await Relay(client => client.PostAsync("/api/settings", new SettingRequest(assignment[..split].Trim(), assignment[(split + 1)..], args.Value("scope"), docId, where)));
        }
        if (args.Value("unset") is { } key)
            return await Relay(client => client.PostAsync("/api/settings", new SettingRequest(key.Trim(), null, args.Value("scope"), docId, where)));
        var query = $"/api/settings?where={Uri.EscapeDataString(where)}" + (docId is null ? "" : $"&docId={Uri.EscapeDataString(docId)}");
        return await Relay(client => client.GetAsync(query));
    }

    static async Task<int> Delegate(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault();
        var id = args.Value("to");
        if (docId is null || id is null)
            throw new UsageException("Usage: edit-md delegate <docId> --to <id>, with the brief on stdin");
        var brief = Console.IsInputRedirected ? await Console.In.ReadToEndAsync() : "";
        if (string.IsNullOrWhiteSpace(brief))
            throw new UsageException("Nothing to delegate with: pipe the brief on stdin.");
        return await Relay(client => client.PostAsync($"/api/docs/{Uri.EscapeDataString(docId)}/delegate", new BriefRequest(id, brief.Trim())));
    }

    static Task<int> Skills(Arguments args)
    {
        const string usage = "Usage: edit-md skills <docId>, or edit-md skills --ran <name>...";
        if (args.Has("ran"))
            return args.Positional.Count == 0
                ? throw new UsageException(usage)
                : Relay(client => client.PostAsync("/api/skills/ran", new SkillsRanRequest([.. args.Positional])));
        var docId = args.Positional.FirstOrDefault() ?? throw new UsageException(usage);
        return Relay(client => client.GetAsync($"/api/docs/{Uri.EscapeDataString(docId)}/skills"));
    }

    static async Task<int> Mark(Arguments args)
    {
        const string usage = "Usage: edit-md mark <docId> --set NAME, with [{\"label\": ..., \"quote\": ..., \"note\": ...}] on stdin";
        var docId = args.Positional.FirstOrDefault() ?? throw new UsageException(usage);
        var set = args.Value("set") ?? throw new UsageException(usage);
        MarkEntry[]? marks;
        try
        {
            marks = JsonSerializer.Deserialize<MarkEntry[]>(Console.IsInputRedirected ? await Console.In.ReadToEndAsync() : "", Wire.Json);
        }
        catch (JsonException e)
        {
            throw new UsageException($"{usage}: {e.Message}");
        }
        return await Relay(client => client.PostAsync($"/api/docs/{Uri.EscapeDataString(docId)}/marks", new MarkRequest(set, marks ?? [])));
    }

    static Task<int> Unmark(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault();
        var set = args.Positional.Skip(1).FirstOrDefault();
        if (docId is null || (set is null) == !args.Has("all"))
            throw new UsageException("Usage: edit-md unmark <docId> (NAME | --all)");
        return Relay(client => client.PostAsync($"/api/docs/{Uri.EscapeDataString(docId)}/unmark", new UnmarkRequest(set)));
    }

    static Task<int> Events(Arguments args)
    {
        var docId = args.Positional.FirstOrDefault();
        return Relay(client => client.GetAsync("/api/events" + (docId is null ? "" : $"?docId={Uri.EscapeDataString(docId)}")));
    }

    static async Task<int> Stop()
    {
        using var client = await Connect(TimeSpan.Zero);
        if (client is null)
        {
            Print(new { status = "not-running" });
            return 0;
        }
        using var response = await client.PostAsync("/api/shutdown", new { });
        Print(new { status = "stopped", client.State.Url });
        return 0;
    }

    static async Task<int> Relay(Func<ServerClient, Task<HttpResponseMessage>> call)
    {
        using var client = await Connect(TimeSpan.FromSeconds(5));
        if (client is null)
            return NotRunning();
        using var response = await call(client);
        if (!response.IsSuccessStatusCode)
            return await FailFrom(response);
        Console.WriteLine(await response.Content.ReadAsStringAsync());
        return 0;
    }

    static async Task Acknowledge(ServerClient client, long seq)
    {
        try
        {
            using var _ = await client.PostAsync("/api/ack", new AckRequest(seq));
        }
        catch (HttpRequestException)
        {
        }
    }

    static Task<ServerClient?> Connect(TimeSpan waitForStart) => ServerClient.ConnectAsync(waitForStart);

    static int NotRunning() =>
        Fail("The edit-md server is not running. Start it with `edit-md serve` via run_in_background, then retry.");

    static async Task<int> FailFrom(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        return Fail($"{(int)response.StatusCode} {response.ReasonPhrase}{(body.Length > 0 ? ": " + body : "")}");
    }

    static int Fail(string message)
    {
        Print(new { error = message });
        return 1;
    }

    static void Print(object value) => Console.WriteLine(JsonSerializer.Serialize(value, Wire.Json));
}
