namespace LalamoMado.Server;

/// <summary>What identifies a document across sessions: its full path, case-folded where the file system is case-insensitive.</summary>
public static class DocumentKey
{
    public static string Of(string path) =>
        OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? Path.GetFullPath(path).ToLowerInvariant() : Path.GetFullPath(path);
}
