using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class CommentLabelsTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-labels-").FullName;

    string Shipped => Path.Combine(folder, "client", CommentLabels.FileName);
    string User => Path.Combine(folder, "home", CommentLabels.FileName);
    string Repo => Path.Combine(folder, "repo");
    string Plan => Path.Combine(Repo, "docs", "plan.md");

    public CommentLabelsTests()
    {
        Directory.CreateDirectory(Path.Combine(Repo, ".git"));
        Write(Shipped, """{"labels": [{"id": "comment", "icon": "💬", "name": "Comment"}, {"id": "question", "icon": "❓"}]}""");
        Write(Plan, "# Plan\n");
    }

    public void Dispose() => Directory.Delete(folder, recursive: true);

    static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    EffectiveLabels For(LabelList? session = null) => new CommentLabels(Shipped, User).For(Plan, session);

    [Fact]
    public void The_shipped_list_alone_is_not_custom_and_names_default_to_the_id()
    {
        var effective = For();

        Assert.False(effective.Custom);
        Assert.Equal(["Comment", "question"], effective.Labels.Select(l => l.Name));
        Assert.All(effective.Labels, l => Assert.Equal(LabelSources.Shipped, l.Source));
    }

    [Fact]
    public void A_user_list_extends_the_shipped_one_and_overrides_by_id()
    {
        Write(User, """{"labels": [{"id": "question", "icon": "❔", "description": "Answer in the page."}, {"id": "risk", "icon": "⚠️"}]}""");

        var effective = For();

        Assert.True(effective.Custom);
        Assert.Equal(["comment", "question", "risk"], effective.Labels.Select(l => l.Id));
        Assert.Equal(("❔", LabelSources.User), (effective.Labels[1].Icon, effective.Labels[1].Source));
    }

    [Fact]
    public void A_repo_list_that_replaces_drops_everything_below_it()
    {
        Write(User, """{"labels": [{"id": "risk", "icon": "⚠️"}]}""");
        Write(Path.Combine(Repo, ".claude", "edit-md", CommentLabels.FileName), """{"replace": true, "labels": [{"id": "decision", "icon": "◆", "color": "#d97706"}]}""");

        var only = Assert.Single(For().Labels);

        Assert.Equal(("decision", "#d97706", LabelSources.Repo), (only.Id, only.Color, only.Source));
    }

    [Fact]
    public void The_session_list_is_the_most_specific()
    {
        var effective = For(new LabelList([new CommentLabel("comment", "🗨️")]));

        Assert.Equal(("🗨️", LabelSources.Session), (effective.Labels[0].Icon, effective.Labels[0].Source));
    }

    [Fact]
    public void Two_labels_on_one_digit_leave_it_to_the_more_specific_layer_and_list_a_problem()
    {
        Write(User, """{"labels": [{"id": "good", "icon": "👍", "hotkey": 5}]}""");
        Write(Path.Combine(Repo, ".claude", "edit-md", CommentLabels.FileName), """{"labels": [{"id": "risk", "icon": "⚠️", "hotkey": 5}]}""");

        var effective = For();

        Assert.Equal(5, effective.Labels.Single(l => l.Id == "risk").Hotkey);
        Assert.Null(effective.Labels.Single(l => l.Id == "good").Hotkey);
        Assert.Contains("risk and good both claim hotkey 5", Assert.Single(effective.Problems!));
    }

    [Fact]
    public void A_point_label_or_a_digit_out_of_range_takes_no_hotkey()
    {
        Write(User, """{"labels": [{"id": "insert", "icon": "➕", "point": true, "hotkey": 2}, {"id": "risk", "icon": "⚠️", "hotkey": 12}]}""");

        var effective = For();

        Assert.All(effective.Labels, l => Assert.Null(l.Hotkey));
        Assert.Equal(2, effective.Problems!.Length);
    }

    [Fact]
    public void A_hidden_gateway_keeps_its_flag_and_takes_no_hotkey()
    {
        Write(User, """{"labels": [{"id": "setting", "icon": "⚙️", "hidden": true, "hotkey": 7}]}""");

        var setting = For().Labels.Single(l => l.Id == "setting");

        Assert.True(setting.Hidden);
        Assert.Null(setting.Hotkey);
        Assert.Contains("a hidden label takes no hotkey", Assert.Single(For().Problems!));
    }

    [Fact]
    public void A_broken_user_file_is_reported_and_skipped()
    {
        Write(User, """{"labels": [{"id": "risk"}]}""");

        var effective = For();

        Assert.Equal(2, effective.Labels.Length);
        Assert.Contains("needs an id and an icon", Assert.Single(effective.Problems!));
    }
}
