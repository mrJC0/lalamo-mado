using System.Text.Json.Nodes;
using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class MicrophoneGrantTests : IDisposable
{
    readonly string profile = Directory.CreateTempSubdirectory("edit-md-profile-").FullName;

    string PreferencesFile => Path.Combine(profile, "Default", "Preferences");

    public void Dispose() => Directory.Delete(profile, recursive: true);

    JsonNode? Grant(string origin) => JsonNode.Parse(File.ReadAllText(PreferencesFile))!["profile"]!["content_settings"]!["exceptions"]!["media_stream_mic"]![$"{origin},*"];

    [Fact]
    public void A_new_profile_gets_the_page_origin_allowed()
    {
        MicrophoneGrant.AllowIn(profile, "http://127.0.0.1:41255/d/d1/");

        Assert.Equal(1, Grant("http://127.0.0.1:41255")!["setting"]!.GetValue<int>());
    }

    [Fact]
    public void An_existing_profile_keeps_its_other_settings()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(PreferencesFile)!);
        File.WriteAllText(PreferencesFile, """{"browser": {"window_placement": {"left": 60}}, "profile": {"name": "Person 1"}}""");

        MicrophoneGrant.AllowIn(profile, "http://127.0.0.1:41255/d/d1/");

        var preferences = JsonNode.Parse(File.ReadAllText(PreferencesFile))!;
        Assert.Equal(60, preferences["browser"]!["window_placement"]!["left"]!.GetValue<int>());
        Assert.Equal("Person 1", preferences["profile"]!["name"]!.GetValue<string>());
        Assert.NotNull(Grant("http://127.0.0.1:41255"));
    }

    [Fact]
    public void A_granted_origin_is_left_untouched()
    {
        MicrophoneGrant.AllowIn(profile, "http://127.0.0.1:41255/d/d1/");
        var written = File.GetLastWriteTimeUtc(PreferencesFile);

        MicrophoneGrant.AllowIn(profile, "http://127.0.0.1:41255/d/d2/");

        Assert.Equal(written, File.GetLastWriteTimeUtc(PreferencesFile));
    }
}
