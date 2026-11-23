using System.Text.Json;
using System.Text.Json.Nodes;

namespace LalamoMado.Server;

/// <summary>
/// Dictation should never ask for the microphone: Chrome reads a grant written into the profile's Preferences before launch
/// (checked headless and headed, 2026-11-02). Only the review page's origin, only the dedicated profile.
/// A browser already running on the profile keeps its own copy; with a stable port per session it got the grant at its own launch.
/// </summary>
public static class MicrophoneGrant
{
    const int Allow = 1;

    public static void AllowIn(string profileDirectory, string url)
    {
        try
        {
            var file = Path.Combine(profileDirectory, "Default", "Preferences");
            var preferences = File.Exists(file) && JsonNode.Parse(File.ReadAllText(file)) is JsonObject existing ? existing : [];
            var grants = Preferences.GetOrAddChild(Preferences.GetOrAddChild(Preferences.GetOrAddChild(Preferences.GetOrAddChild(
                preferences, "profile"), "content_settings"), "exceptions"), "media_stream_mic");
            var pattern = $"{new Uri(url).GetLeftPart(UriPartial.Authority)},*";
            if (grants[pattern]?["setting"] is JsonValue setting && setting.TryGetValue<int>(out var current) && current == Allow)
                return;
            grants[pattern] = new JsonObject { ["last_modified"] = ChromeTimestamp(DateTime.UtcNow), ["setting"] = Allow };
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            var temporary = $"{file}.edit-md.tmp";
            File.WriteAllText(temporary, preferences.ToJsonString());
            File.Move(temporary, file, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or UriFormatException)
        {
        }
    }

    /// <summary>Microseconds since 1601-01-01, as a string — Chrome's own format.</summary>
    static string ChromeTimestamp(DateTime utc) => ((utc.Ticks - new DateTime(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc).Ticks) / 10).ToString();
}
