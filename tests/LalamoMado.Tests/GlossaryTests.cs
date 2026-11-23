using System.Text;
using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class GlossaryTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-glossary-").FullName;

    string UserFile => Path.Combine(folder, "home", Glossary.FileName);
    string Repo => Path.Combine(folder, "repo");
    string RepoFile => Path.Combine(Repo, ".claude", "edit-md", Glossary.FileName);
    string Plan => Path.Combine(Repo, "docs", "plan.md");

    public GlossaryTests()
    {
        Directory.CreateDirectory(Path.Combine(Repo, ".git"));
        Write(Plan, "# Plan\n");
    }

    public void Dispose() => Directory.Delete(folder, recursive: true);

    static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    EffectiveGlossary For() => new Glossary(UserFile).For(Plan);

    [Fact]
    public void Without_files_it_is_empty_and_events_carry_nothing()
    {
        var glossary = For();

        Assert.Empty(glossary.Terms);
        Assert.Empty(glossary.Mishearings);
        Assert.Null(glossary.Prompt);
        Assert.Null(glossary.ForAgent());
    }

    [Fact]
    public void Terms_are_unioned_with_the_repo_first_and_mishearings_merge_by_key_with_the_repo_winning()
    {
        Write(UserFile, """{"terms": ["XTbl", "IRows", "seek"], "mishearings": {"Xtable": "XTbl", "secret results": "secret results"}}""");
        Write(RepoFile, """{"terms": ["edit-md", "Seek"], "mishearings": {"secret Results": "seek results", "EditMD": "edit-md"}}""");

        var glossary = For();

        Assert.Equal(["edit-md", "Seek", "XTbl", "IRows"], glossary.Terms);
        Assert.Equal(3, glossary.Mishearings.Count);
        Assert.Equal("seek results", glossary.Mishearings["secret results"]);
        Assert.Equal("XTbl", glossary.Mishearings["xtable"]);
        Assert.Equal("Glossary: edit-md, Seek, XTbl, IRows.", glossary.Prompt);
    }

    [Fact]
    public void A_repo_file_that_replaces_drops_the_users()
    {
        Write(UserFile, """{"terms": ["XTbl"], "mishearings": {"Xtable": "XTbl"}}""");
        Write(RepoFile, """{"replace": true, "terms": ["edit-md"]}""");

        var glossary = For();

        Assert.Equal(["edit-md"], glossary.Terms);
        Assert.Empty(glossary.Mishearings);
    }

    [Fact]
    public void An_event_gets_the_lists_without_the_prompt()
    {
        Write(UserFile, """{"mishearings": {"ex table": "XTbl"}}""");

        var forAgent = For().ForAgent()!;

        Assert.Equal("XTbl", forAgent.Mishearings["ex table"]);
        Assert.Null(forAgent.Prompt);
    }

    [Fact]
    public void The_prompt_stops_before_the_first_term_that_would_not_fit_in_whispers_window()
    {
        var terms = Enumerable.Range(1, 60).Select(n => $"Term{n:00}").ToArray();

        var prompt = Glossary.PromptFor(terms)!;

        Assert.True(Encoding.UTF8.GetByteCount(prompt) < 224);
        Assert.StartsWith("Glossary: Term01, Term02,", prompt);
        Assert.EndsWith(".", prompt);
        var kept = prompt["Glossary: ".Length..^1].Split(", ");
        Assert.Equal(terms[..kept.Length], kept);
        Assert.True(Encoding.UTF8.GetByteCount($"Glossary: {string.Join(", ", terms[..(kept.Length + 1)])}.") >= 224);
    }

    [Fact]
    public void A_broken_file_is_reported_and_skipped()
    {
        Write(UserFile, """{"terms": ["XTbl"]}""");
        Write(RepoFile, """{"terms": ["edit-md", " "]}""");

        var glossary = For();

        Assert.Equal(["XTbl"], glossary.Terms);
        Assert.Contains("A term is empty", Assert.Single(glossary.Problems!));
    }

    [Fact]
    public void A_file_that_is_not_json_is_reported()
    {
        Write(RepoFile, "terms: XTbl");

        Assert.Contains(RepoFile, Assert.Single(For().Problems!));
    }

    [Fact]
    public void A_remembered_correction_creates_the_users_file_and_its_term_joins_the_terms()
    {
        var glossary = new Glossary(UserFile).Remember(Plan, new("ex table", "XTbl", Glossary.UserLayer));

        Assert.Equal("XTbl", glossary.Mishearings["ex table"]);
        Assert.Equal(["XTbl"], glossary.Terms);
        Assert.Equal("""
            {
              "terms": [
                "XTbl"
              ],
              "mishearings": {
                "ex table": "XTbl"
              }
            }

            """, File.ReadAllText(UserFile));
    }

    [Fact]
    public void Only_the_words_the_recognizer_did_not_hear_join_the_terms_and_none_a_layer_already_has()
    {
        Write(UserFile, """{"terms": ["XTbl"]}""");

        new Glossary(UserFile).Remember(Plan, new("secret results", "seek results", Glossary.RepoLayer));
        var glossary = new Glossary(UserFile).Remember(Plan, new("Xtable", "XTbl", Glossary.RepoLayer));

        Assert.Equal(["seek", "XTbl"], glossary.Terms);
        Assert.Equal("seek results", glossary.Mishearings["secret results"]);
        Assert.True(File.Exists(RepoFile));
    }

    [Fact]
    public void Remembering_a_known_key_again_replaces_its_term_in_place_and_keeps_the_rest_of_the_file()
    {
        Write(RepoFile, """{"replace": true, "terms": ["edit-md"], "mishearings": {"EditMD": "edit-md", "Secret Results": "secret results", "Louklo": "Local"}}""");

        new Glossary(UserFile).Remember(Plan, new("secret results", "seek results", Glossary.RepoLayer));

        var written = File.ReadAllText(RepoFile);
        Assert.Contains("\"replace\": true", written);
        Assert.True(written.IndexOf("EditMD") < written.IndexOf("Secret Results") && written.IndexOf("Secret Results") < written.IndexOf("Louklo"));
        Assert.Equal("seek results", For().Mishearings["secret results"]);
    }

    [Fact]
    public void A_document_outside_a_repository_remembers_only_for_the_user()
    {
        var loose = Path.Combine(folder, "loose", "note.md");
        Write(loose, "# Note\n");
        var glossary = new Glossary(UserFile);

        Assert.Null(glossary.For(loose).RepoFile);
        Assert.Equal(RepoFile, glossary.For(Plan).RepoFile);
        Assert.Throws<GlossaryRefusal>(() => glossary.Remember(loose, new("ex table", "XTbl", Glossary.RepoLayer)));
    }

    [Fact]
    public void A_file_that_does_not_read_is_never_overwritten()
    {
        Write(RepoFile, "terms: XTbl");

        Assert.Throws<GlossaryRefusal>(() => new Glossary(UserFile).Remember(Plan, new("ex table", "XTbl", Glossary.RepoLayer)));
        Assert.Equal("terms: XTbl", File.ReadAllText(RepoFile));
    }

    [Theory]
    [InlineData("", "XTbl", "user")]
    [InlineData("ex table", " ", "user")]
    [InlineData("ex table", "XTbl", "session")]
    public void An_incomplete_correction_is_refused(string heard, string meant, string layer)
    {
        Assert.Throws<GlossaryRefusal>(() => new Glossary(UserFile).Remember(Plan, new(heard, meant, layer)));
        Assert.False(File.Exists(UserFile));
    }

    [Fact]
    public void An_event_never_carries_where_the_files_live()
    {
        Write(UserFile, """{"terms": ["XTbl"]}""");

        Assert.Null(For().ForAgent()!.RepoFile);
    }
}
