namespace LalamoMado.Tests;

public class BuildChannelTests
{
    [Fact]
    public void A_build_without_a_channel_is_the_release()
    {
        Assert.Same(BuildChannel.Release, BuildChannel.Current);
    }

    [Fact]
    public void The_release_keeps_the_homes_it_always_had()
    {
        Assert.Equal(Path.Combine(Path.GetTempPath(), "edit-md"), BuildChannel.Release.StateRoot);
        Assert.Equal("edit-md", Path.GetFileName(BuildChannel.Release.UserFilesDirectory));
        Assert.EndsWith(Path.Combine("bin", "edit-md"), BuildChannel.Release.DefaultToolHome);
    }

    [Fact]
    public void The_dev_build_shares_no_home_with_the_release()
    {
        Assert.NotEqual(BuildChannel.Release.StateRoot, BuildChannel.Dev.StateRoot);
        Assert.NotEqual(BuildChannel.Release.UserFilesDirectory, BuildChannel.Dev.UserFilesDirectory);
        Assert.NotEqual(BuildChannel.Release.DefaultToolHome, BuildChannel.Dev.DefaultToolHome);
        Assert.Equal("edit-md-dev", Path.GetFileName(BuildChannel.Dev.UserFilesDirectory));
    }
}
