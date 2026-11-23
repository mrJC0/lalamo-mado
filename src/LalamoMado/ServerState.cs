using System.Text.Json;
using LalamoMado.Server;

namespace LalamoMado;

public sealed record ServerState(string Url, int Pid, string Instance, DateTimeOffset StartedAt);

/// <summary>One resident server per Claude Code session: the state dir is keyed by CLAUDE_CODE_SESSION_ID, so parallel sessions never share a server.</summary>
public static class ServerStateFile
{
    public static string Directory
    {
        get
        {
            var home = Environment.GetEnvironmentVariable("EDIT_MD_HOME");
            if (!string.IsNullOrWhiteSpace(home))
                return home;
            var session = Environment.GetEnvironmentVariable("CLAUDE_CODE_SESSION_ID");
            return Path.Combine(Path.GetTempPath(), "edit-md", string.IsNullOrWhiteSpace(session) ? "default" : session);
        }
    }

    public static string FilePath => Path.Combine(Directory, "server.json");

    public static ServerState? Read()
    {
        try
        {
            return JsonSerializer.Deserialize<ServerState>(File.ReadAllText(FilePath), Wire.Json);
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static void Write(ServerState state)
    {
        System.IO.Directory.CreateDirectory(Directory);
        var temporary = FilePath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state, Wire.Json));
        File.Move(temporary, FilePath, overwrite: true);
    }

    public static void DeleteIfOwnedBy(string instance)
    {
        if (Read()?.Instance == instance)
            File.Delete(FilePath);
    }
}
