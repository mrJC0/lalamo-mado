using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class SkillCatalogTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-skills-").FullName;

    string Home => Path.Combine(folder, "home");
    string Repo => Path.Combine(folder, "repo");
    string Plan => Path.Combine(Repo, "docs", "deep", "plan.md");

    public SkillCatalogTests()
    {
        Directory.CreateDirectory(Path.Combine(Repo, ".git"));
        Directory.CreateDirectory(Path.GetDirectoryName(Plan)!);
    }

    public void Dispose() => Directory.Delete(folder, recursive: true);

    static void Write(string path, string content)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    static string Skill(string? name, string description, string more = "") =>
        $"---\n{(name is null ? "" : $"name: {name}\n")}description: {description}\n{more}---\nBody.\n";

    SkillList List() => SkillCatalog.For(Plan, Path.Combine(folder, "session"), Home);

    [Fact]
    public void It_lists_the_users_and_the_repos_split_and_alphabetical()
    {
        Write(Path.Combine(Home, "skills", "show-md", "SKILL.md"), Skill("show-md-for-comment", "Open it for comment."));
        Write(Path.Combine(Home, "skills", "alpha", "SKILL.md"), Skill(null, "Named by its folder."));
        Write(Path.Combine(Repo, ".claude", "skills", "planup", "SKILL.md"), Skill("planup", "Plan it up."));

        var skills = List().Skills;

        Assert.Equal(["alpha", "planup", "show-md-for-comment"], skills.Select(skill => skill.Name));
        Assert.Equal([SkillSources.User, SkillSources.Repo, SkillSources.User], skills.Select(skill => skill.Source));
        Assert.Equal("Named by its folder.", skills[0].Description);
    }

    [Fact]
    public void Skills_load_from_the_git_root_down_to_the_documents_folder_only()
    {
        Write(Path.Combine(Repo, "docs", ".claude", "skills", "on-the-way", "SKILL.md"), Skill("on-the-way", "Between root and document."));
        Write(Path.Combine(Repo, "docs", "deep", ".claude", "skills", "beside", "SKILL.md"), Skill("beside", "Beside the document."));
        Write(Path.Combine(Repo, "elsewhere", ".claude", "skills", "not-this", "SKILL.md"), Skill("not-this", "In a sibling folder."));
        Write(Path.Combine(folder, ".claude", "skills", "above-the-root", "SKILL.md"), Skill("above-the-root", "Outside the repo."));

        Assert.Equal(["beside", "on-the-way"], List().Skills.Select(skill => skill.Name));
    }

    [Fact]
    public void A_document_outside_any_git_root_lists_the_sessions_repo()
    {
        var session = Path.Combine(folder, "session");
        Directory.CreateDirectory(Path.Combine(session, ".git"));
        Write(Path.Combine(session, ".claude", "skills", "of-the-session", "SKILL.md"), Skill("of-the-session", "The session's."));

        var skills = SkillCatalog.For(Path.Combine(folder, "scratch", "questions.md"), session, Home).Skills;

        Assert.Equal("of-the-session", Assert.Single(skills).Name);
    }

    [Fact]
    public void A_repo_skill_named_like_a_users_is_shadowed()
    {
        Write(Path.Combine(Home, "skills", "same", "SKILL.md"), Skill("same", "Mine."));
        Write(Path.Combine(Repo, ".claude", "skills", "same", "SKILL.md"), Skill("same", "The repo's."));

        var skills = List().Skills;

        Assert.Null(skills.Single(skill => skill.Source == SkillSources.User).Shadowed);
        Assert.True(skills.Single(skill => skill.Source == SkillSources.Repo).Shadowed);
    }

    [Fact]
    public void Commands_are_named_by_the_file_with_a_subfolder_as_a_segment_and_a_skill_wins()
    {
        Write(Path.Combine(Repo, ".claude", "commands", "frontend", "component.md"), Skill(null, "A component."));
        Write(Path.Combine(Repo, ".claude", "commands", "both.md"), Skill(null, "The command."));
        Write(Path.Combine(Repo, ".claude", "skills", "both", "SKILL.md"), Skill("both", "The skill."));

        var skills = List().Skills;

        Assert.Equal(["both", "frontend:component"], skills.Select(skill => skill.Name));
        Assert.Equal("The skill.", skills[0].Description);
    }

    [Fact]
    public void A_user_only_skill_lists_like_any_other_and_says_so()
    {
        Write(Path.Combine(Home, "skills", "manual", "SKILL.md"), Skill("manual", "By hand.", "disable-model-invocation: true\n"));

        Assert.True(Assert.Single(List().Skills).UserOnly);
    }

    [Fact]
    public void Only_a_user_only_skill_the_session_reports_counts_as_run()
    {
        Write(Path.Combine(Home, "skills", "manual", "SKILL.md"), Skill("manual", "By hand.", "disable-model-invocation: true\n"));
        Write(Path.Combine(Home, "skills", "other-manual", "SKILL.md"), Skill("other-manual", "By hand too.", "disable-model-invocation: true\n"));
        Write(Path.Combine(Home, "skills", "auto", "SKILL.md"), Skill("auto", "Any time."));
        var run = new SkillsRun();

        Assert.Equal(["auto", "MANUAL"], run.Add(["/MANUAL", "auto", " "]));

        var ran = run.Marked(List()).Skills.ToDictionary(skill => skill.Name, skill => skill.Ran);
        Assert.Equal(new Dictionary<string, bool?> { ["auto"] = null, ["manual"] = true, ["other-manual"] = null }, ran);
    }

    [Fact]
    public void A_skill_without_frontmatter_still_lists()
    {
        Write(Path.Combine(Home, "skills", "bare", "SKILL.md"), "Just a body.\n");

        var skill = Assert.Single(List().Skills);

        Assert.Equal(("bare", null), (skill.Name, skill.Description));
    }

    [Fact]
    public void Frontmatter_reads_quoted_and_folded_values()
    {
        var fields = Frontmatter.Of("---\nname: \"quoted\"\ndescription: >\n  folded over\n  two lines\nargument-hint: \"[path]\"\n---\nname: not this\n");

        Assert.Equal("quoted", fields["name"]);
        Assert.Equal("folded over two lines", fields["description"]);
        Assert.False(fields.ContainsKey("Body"));
    }
}
