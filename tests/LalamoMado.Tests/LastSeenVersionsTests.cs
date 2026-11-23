using LalamoMado.Markdown;
using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class LastSeenVersionsTests : IDisposable
{
    readonly string folder = Directory.CreateTempSubdirectory("edit-md-last-seen-").FullName;

    string StoreFolder => Path.Combine(folder, "last-seen");

    public void Dispose() => Directory.Delete(folder, recursive: true);

    [Fact]
    public void A_new_server_diffs_against_what_the_previous_one_served()
    {
        var plan = Path.Combine(folder, "plan.md");
        File.WriteAllText(plan, "# Plan\n\nThe export runs nightly.\n");
        var earlier = new ReviewDocument("d1", plan, new LastSeenVersions(StoreFolder));
        earlier.Load();
        earlier.ServeView("first");

        File.WriteAllText(plan, "# Plan\n\nThe export runs hourly.\n");
        var later = new ReviewDocument("d1", plan, new LastSeenVersions(StoreFolder));
        later.Load();

        Assert.Equal(ChangeKinds.Changed, Assert.Single(later.Changes).Kind);
    }

    [Fact]
    public void A_document_never_served_has_no_last_seen_version()
    {
        var plan = Path.Combine(folder, "plan.md");
        File.WriteAllText(plan, "# Plan\n");
        var document = new ReviewDocument("d1", plan, new LastSeenVersions(StoreFolder));
        document.Load();

        Assert.Empty(document.Changes);
    }

    [Fact]
    public void Each_document_keeps_its_own_version()
    {
        var store = new LastSeenVersions(StoreFolder);
        store.Write(Path.Combine(folder, "a.md"), "alpha");
        store.Write(Path.Combine(folder, "b.md"), "beta");

        Assert.Equal("alpha", store.Read(Path.Combine(folder, "a.md")));
        Assert.Equal("beta", store.Read(Path.Combine(folder, "b.md")));
    }
}
