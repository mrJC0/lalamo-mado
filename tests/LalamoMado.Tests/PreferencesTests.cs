using System.Text.Json.Nodes;
using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class PreferencesTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-prefs-").FullName;

    string FilePath => Path.Combine(folder, "prefs.json");

    public void Dispose() => Directory.Delete(folder, recursive: true);

    [Fact]
    public void A_pc_preference_survives_a_new_server()
    {
        new Preferences(FilePath).Set(PreferenceScopes.Pc, null, "order", JsonValue.Create("created"));

        Assert.Equal("created", new Preferences(FilePath).View(null).Pc["order"]?.GetValue<string>());
    }

    [Fact]
    public void A_session_preference_lives_only_as_long_as_its_server()
    {
        var running = new Preferences(FilePath);
        running.Set(PreferenceScopes.Session, null, "popup", JsonValue.Create(1));

        Assert.True(running.View(null).Session.ContainsKey("popup"));
        Assert.False(new Preferences(FilePath).View(null).Session.ContainsKey("popup"));
    }

    [Fact]
    public void A_document_preference_belongs_to_that_document_only()
    {
        var preferences = new Preferences(FilePath);
        var plan = Path.Combine(folder, "plan.md");
        preferences.Set(PreferenceScopes.Document, plan, "popup", JsonValue.Create(7));

        Assert.Equal(7, preferences.View(plan).Document["popup"]?.GetValue<int>());
        Assert.False(preferences.View(Path.Combine(folder, "other.md")).Document.ContainsKey("popup"));
    }

    [Fact]
    public void Two_servers_writing_the_same_file_keep_each_others_preferences()
    {
        var first = new Preferences(FilePath);
        var second = new Preferences(FilePath);
        first.Set(PreferenceScopes.Pc, null, "a", JsonValue.Create(1));
        second.Set(PreferenceScopes.Pc, null, "b", JsonValue.Create(2));

        var pc = new Preferences(FilePath).View(null).Pc;
        Assert.Equal([1, 2], [pc["a"]!.GetValue<int>(), pc["b"]!.GetValue<int>()]);
    }

    [Fact]
    public void A_null_value_removes_the_preference()
    {
        var preferences = new Preferences(FilePath);
        preferences.Set(PreferenceScopes.Pc, null, "order", JsonValue.Create("created"));
        preferences.Set(PreferenceScopes.Pc, null, "order", null);

        Assert.False(preferences.View(null).Pc.ContainsKey("order"));
    }

    [Fact]
    public void A_repo_value_lives_in_the_repository_and_wins_over_the_pc_but_not_over_the_session()
    {
        var repo = Directory.CreateDirectory(Path.Combine(folder, "repo")).FullName;
        Directory.CreateDirectory(Path.Combine(repo, ".git"));
        var plan = Path.Combine(repo, "docs", "plan.md");
        var preferences = new Preferences(FilePath);
        preferences.Set(PreferenceScopes.Pc, null, "annotations.compact", JsonValue.Create(false));
        preferences.Set(PreferenceScopes.Repo, plan, "annotations.compact", JsonValue.Create(true));

        Assert.True(File.Exists(Path.Combine(repo, ".claude", "edit-md", "prefs.json")));
        Assert.Equal((true, PreferenceScopes.Repo), Effective(preferences.View(plan)));
        Assert.Equal((false, PreferenceScopes.Pc), Effective(preferences.View(Path.Combine(folder, "elsewhere.md"))));
        preferences.Set(PreferenceScopes.Session, null, "annotations.compact", JsonValue.Create(false));
        Assert.Equal((false, PreferenceScopes.Session), Effective(preferences.View(null, repo)));

        static (bool, string?) Effective(PreferenceView view) => view.Effective("annotations.compact") is var (value, scope) ? (value!.GetValue<bool>(), scope) : default;
    }

    [Fact]
    public void A_repo_file_that_does_not_read_is_never_overwritten()
    {
        var repo = Directory.CreateDirectory(Path.Combine(folder, "repo")).FullName;
        Directory.CreateDirectory(Path.Combine(repo, ".git"));
        var file = Path.Combine(Directory.CreateDirectory(Path.Combine(repo, ".claude", "edit-md")).FullName, "prefs.json");
        File.WriteAllText(file, "{ half written");

        Assert.Throws<PreferenceRefusal>(() => new Preferences(FilePath).Set(PreferenceScopes.Repo, null, "a", JsonValue.Create(1), repo));
        Assert.Equal("{ half written", File.ReadAllText(file));
        Assert.Throws<PreferenceRefusal>(() => new Preferences(FilePath).Set(PreferenceScopes.Repo, null, "a", JsonValue.Create(1), folder));
    }
}
