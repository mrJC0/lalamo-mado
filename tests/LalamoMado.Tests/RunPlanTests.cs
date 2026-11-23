using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class RunPlanTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-run-").FullName;

    public void Dispose() => Directory.Delete(folder, recursive: true);

    static RunSetup Setup(bool repo = false, bool edit = false, string[]? allow = null, bool resume = false, bool hooksOff = false, string? addDir = "/root") =>
        new("/root/docs", addDir, "the-session", resume, repo, edit, "claude-opus-5-5", "high", allow, "Be brief.", 20, 0.5m, hooksOff);

    static string After(List<string> arguments, string flag) => arguments[arguments.IndexOf(flag) + 1];

    [Fact]
    public void A_blank_run_loads_nothing_and_may_only_read()
    {
        var arguments = RunPlan.Arguments(Setup());

        Assert.Contains("--safe-mode", arguments);
        Assert.Contains("--strict-mcp-config", arguments);
        Assert.Equal("Read,Grep,Glob,WebSearch,WebFetch,Bash", After(arguments, "--tools"));
        Assert.DoesNotContain("Edit", arguments);
        Assert.Contains("Bash(git log *)", arguments);
        Assert.Contains("mcp__*", arguments);
        Assert.Contains("Bash(git diff *--ou*)", arguments);
        Assert.Contains("Bash(git log *--ou*)", arguments);
        Assert.Contains("Bash(git show *--ou*)", arguments);
        Assert.Equal("dontAsk", After(arguments, "--permission-mode"));
        Assert.Equal("the-session", After(arguments, "--session-id"));
        Assert.Equal("/root", After(arguments, "--add-dir"));
        Assert.Equal("claude-opus-5-5", After(arguments, "--model"));
        Assert.Equal("high", After(arguments, "--effort"));
        Assert.Equal("20", After(arguments, "--max-turns"));
        Assert.Equal("0.5", After(arguments, "--max-budget-usd"));
        Assert.Contains("Be brief.", After(arguments, "--append-system-prompt"));
    }

    [Fact]
    public void Every_run_is_told_it_is_not_the_session_agent()
    {
        foreach (var setup in new[] { Setup(), Setup(repo: true, edit: true), Setup(resume: true) })
            Assert.StartsWith("You are a separate run edit-md started", After(RunPlan.Arguments(setup), "--append-system-prompt"));
    }

    [Fact]
    public void A_repo_run_loads_the_repo_and_may_edit_only_when_ticked()
    {
        var reading = RunPlan.Arguments(Setup(repo: true));
        var editing = RunPlan.Arguments(Setup(repo: true, edit: true, allow: ["Bash(dotnet build *)"]));

        Assert.DoesNotContain("--safe-mode", reading);
        Assert.DoesNotContain("Bash(dotnet build *)", reading);
        Assert.EndsWith(",Edit,Write", After(editing, "--tools"));
        Assert.Contains("Edit", editing);
        Assert.Contains("Write", editing);
        Assert.Contains("Bash(dotnet build *)", editing);
        Assert.Contains(".claude/", After(editing, "--append-system-prompt"));
        Assert.DoesNotContain("Skill", After(editing, "--tools"));
    }

    [Fact]
    public void Commands_beyond_git_come_only_with_May_edit()
    {
        Assert.DoesNotContain("Bash(dotnet build *)", RunPlan.Arguments(Setup(allow: ["Bash(dotnet build *)"])));
    }

    [Fact]
    public void A_follow_up_resumes_and_a_foreign_repo_runs_without_hooks()
    {
        var arguments = RunPlan.Arguments(Setup(repo: true, resume: true, hooksOff: true));

        Assert.Equal("the-session", After(arguments, "--resume"));
        Assert.DoesNotContain("--session-id", arguments);
        Assert.Contains("disableAllHooks", After(arguments, "--settings"));
    }

    [Fact]
    public void The_prompt_leads_with_the_skill_then_the_buttons_prompt_then_the_request()
    {
        var annotation = new AgentAnnotation("a1", "reject", "/review-this and more", "block", "The export runs", "13", null, null, true, Dictated: true, Spoken: ["and more"]);

        var prompt = RunPlan.Prompt("/root/plan.md", annotation, "Rejected as it stands.", "Read it as an outsider.", "The reviewer dislikes nightly jobs.");

        var (skill, button, request) = (prompt.IndexOf("/review-this"), prompt.IndexOf("Read it as an outsider"), prompt.IndexOf("Document: /root/plan.md"));
        Assert.Equal(0, skill);
        Assert.True(skill < button && button < request);
        Assert.Contains("Label: reject — Rejected as it stands.", prompt);
        Assert.Contains("Comment: and more", prompt);
        Assert.Contains("Lines: 13", prompt);
        Assert.Contains("Quoted text: The export runs", prompt);
        Assert.Contains("and more", prompt[prompt.IndexOf("spoken")..]);
        Assert.Contains("The reviewer dislikes nightly jobs.", prompt);
    }

    [Theory]
    [InlineData("/show-md-for-comment on this", "/show-md-for-comment")]
    [InlineData("/frontend:component", "/frontend:component")]
    [InlineData("why did /x fail?", null)]
    [InlineData("/ not a skill", null)]
    [InlineData("/path/to/file is wrong", null)]
    public void Only_a_name_that_starts_the_comment_fires(string text, string? expected)
    {
        Assert.Equal(expected, RunPlan.LeadingSkill(text));
    }

    [Fact]
    public void A_good_result_gives_the_answer_the_suggestion_and_what_changed()
    {
        var outcome = RunOutcome.Parse("""
            {"type":"result","subtype":"success","is_error":false,"result":"{...}","session_id":"s1","total_cost_usd":0.012,"usage":{"input_tokens":3},
             "structured_output":{"answer":"Because.","edit":"New text.","changed":["src/a.cs"],"edits":[{"file":".claude/p.md","old":"x","new":"y"}]}}
            """, "");

        Assert.Equal(("Because.", "New text.", "s1", 0.012m), (outcome.Answer, outcome.Suggestion, outcome.SessionId, outcome.CostUsd));
        Assert.Equal(["src/a.cs"], outcome.Changed);
        Assert.Equal(".claude/p.md", Assert.Single(outcome.Edits).File);
        Assert.Null(outcome.Error);
    }

    [Fact]
    public void A_run_without_valid_structured_output_still_answers_from_result()
    {
        var outcome = RunOutcome.Parse("""{"subtype":"success","is_error":false,"result":"Plain answer.","session_id":"s2"}""", "");

        Assert.Equal("Plain answer.", outcome.Answer);
        Assert.Null(outcome.Error);
    }

    [Fact]
    public void An_error_result_has_no_answer_and_says_why()
    {
        var outcome = RunOutcome.Parse("""{"subtype":"error_max_turns","is_error":true,"errors":["Reached the turn limit."],"session_id":"s3"}""", "");

        Assert.Null(outcome.Answer);
        Assert.Equal("Reached the turn limit.", outcome.Error);
        Assert.Equal("s3", outcome.SessionId);
    }

    [Fact]
    public void Output_that_is_no_result_reports_what_stderr_said()
    {
        Assert.Equal("command not found", RunOutcome.Parse("", "command not found\n").Error);
        Assert.Equal("The run printed no result.", RunOutcome.Parse("not json", "").Error);
    }

    [Fact]
    public void Edits_apply_all_or_none()
    {
        File.WriteAllText(Path.Combine(folder, "a.md"), "alpha beta");
        File.WriteAllText(Path.Combine(folder, "b.md"), "gamma gamma");

        var (changed, refused) = FileEdits.Apply(folder, [new("a.md", "alpha", "ALPHA"), new("b.md", "gamma", "GAMMA")]);

        Assert.Empty(changed);
        Assert.Contains("more than once", refused);
        Assert.Equal("alpha beta", File.ReadAllText(Path.Combine(folder, "a.md")));
    }

    [Fact]
    public void Edits_change_files_and_an_empty_old_creates_one()
    {
        File.WriteAllText(Path.Combine(folder, "a.md"), "alpha beta");

        var (changed, refused) = FileEdits.Apply(folder, [new("a.md", "alpha", "ALPHA"), new("a.md", "beta", "BETA"), new("sub/new.md", "", "fresh")]);

        Assert.Null(refused);
        Assert.Equal("ALPHA BETA", File.ReadAllText(Path.Combine(folder, "a.md")));
        Assert.Equal("fresh", File.ReadAllText(Path.Combine(folder, "sub", "new.md")));
        Assert.Equal(2, changed.Length);
    }

    [Theory]
    [InlineData("../outside.md", "outside the git root")]
    [InlineData("missing.md", "not in missing.md")]
    public void Edits_outside_the_root_or_without_their_old_text_are_refused(string file, string reason)
    {
        var (_, refused) = FileEdits.Apply(folder, [new(file, "x", "y")]);

        Assert.Contains(reason, refused);
    }

    [Fact]
    public void A_run_starts_in_the_documents_folder_and_reaches_the_git_root()
    {
        var root = Path.Combine(folder, "repo");
        Directory.CreateDirectory(Path.Combine(root, ".git"));
        Directory.CreateDirectory(Path.Combine(root, "docs"));
        var document = Path.Combine(root, "docs", "plan.md");

        var (start, addDir) = DelegatedRuns.FoldersFor(document, Path.Combine(folder, "elsewhere"));

        Assert.Equal(Path.Combine(root, "docs"), start);
        Assert.Equal(root, addDir);
    }

    [Fact]
    public void A_document_outside_any_git_root_counts_as_in_the_sessions_repo()
    {
        var session = Path.Combine(folder, "session");
        var document = Path.Combine(folder, "scratch", "questions.md");

        var (start, addDir) = DelegatedRuns.FoldersFor(document, session);

        Assert.Equal(session, start);
        Assert.Equal(Path.Combine(folder, "scratch"), addDir);
        Assert.False(DelegatedRuns.OutsideTheSessionsRepo(document, session));
    }

    [Fact]
    public void Hooks_are_off_only_for_another_repos_document()
    {
        var session = Path.Combine(folder, "session");
        var other = Path.Combine(folder, "other");
        Directory.CreateDirectory(Path.Combine(session, ".git"));
        Directory.CreateDirectory(Path.Combine(other, ".git"));

        Assert.False(DelegatedRuns.OutsideTheSessionsRepo(Path.Combine(session, "plan.md"), session));
        Assert.True(DelegatedRuns.OutsideTheSessionsRepo(Path.Combine(other, "plan.md"), session));
    }
}

public sealed class SendButtonsTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-buttons-").FullName;

    string Shipped => Path.Combine(folder, "client", SendButtons.FileName);
    string User => Path.Combine(folder, "home", SendButtons.FileName);
    string Plan => Path.Combine(folder, "repo", "plan.md");

    public SendButtonsTests()
    {
        Directory.CreateDirectory(Path.Combine(folder, "repo", ".git"));
        Write(Shipped, """{"buttons": [{"id": "blank", "icon": "🧊", "by": "new"}, {"id": "repo", "icon": "📁", "by": "new", "repo": true}]}""");
    }

    public void Dispose() => Directory.Delete(folder, recursive: true);

    static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    EffectiveButtons For(ButtonList? session = null) => new SendButtons(Shipped, User).For(Plan, session);

    [Fact]
    public void Lists_layer_and_the_same_id_overrides()
    {
        Write(User, """{"buttons": [{"id": "blank", "icon": "❄️", "by": "new", "model": "haiku"}, {"id": "cold", "icon": "🧊", "by": "new"}]}""");

        var effective = For(new ButtonList([new SendButton("mine", "⭐", By: AnswererKinds.Session, Instructions: "Compare two runs.")]));

        Assert.Equal(["blank", "repo", "cold", "mine"], effective.Buttons.Select(button => button.Id));
        Assert.Equal(("haiku", LabelSources.User), (effective.Buttons[0].Model, effective.Buttons[0].Source));
        Assert.Equal(LabelSources.Session, effective.Buttons[3].Source);
    }

    [Fact]
    public void A_repo_list_that_replaces_drops_everything_below_it()
    {
        Write(Path.Combine(folder, "repo", ".claude", "edit-md", SendButtons.FileName), """{"replace": true, "buttons": [{"id": "only", "icon": "1️⃣"}]}""");

        Assert.Equal("only", Assert.Single(For().Buttons).Id);
    }

    [Fact]
    public void An_unknown_field_is_reported_not_ignored()
    {
        Write(User, """{"buttons": [{"id": "cold", "icon": "🧊", "temperature": 0.2}]}""");

        var effective = For();

        Assert.Contains("temperature", Assert.Single(effective.Problems!));
        Assert.Contains(effective.Buttons, button => button.Id == "cold");
    }

    [Fact]
    public void A_wrong_answerer_is_a_problem_and_the_file_is_skipped()
    {
        Write(User, """{"buttons": [{"id": "cold", "icon": "🧊", "by": "nobody"}]}""");

        var effective = For();

        Assert.Contains("session, new or brief", Assert.Single(effective.Problems!));
        Assert.DoesNotContain(effective.Buttons, button => button.Id == "cold");
    }

    [Fact]
    public void The_shipped_list_is_the_five_with_Do_it_red()
    {
        var shipped = new SendButtons(Path.Combine(AppContext.BaseDirectory, "client", SendButtons.FileName), User).For(Plan, null).Buttons;

        Assert.Equal(["session", "blank", "repo", "brief", "do-it"], shipped.Select(button => button.Id));
        Assert.True(shipped[4].Edit && shipped[4].Repo);
    }
}
