using System.Runtime.InteropServices;

namespace LalamoMado.Server;

public static class GitRoot
{
    public static string? Of(string path)
    {
        var full = Path.GetFullPath(path);
        for (var folder = Directory.Exists(full) ? full : Path.GetDirectoryName(full); folder is not null; folder = Path.GetDirectoryName(folder))
        {
            var git = Path.Combine(folder, ".git");
            if (Directory.Exists(git) || File.Exists(git))
                return folder;
        }
        return null;
    }
}

public static class LongPath
{
    /// <summary>Temp paths can arrive in 8.3 form (<c>JCERNO~1</c>); Claude Code denies an <c>--add-dir</c> in that form.</summary>
    public static string Of(string path)
    {
        var full = Path.GetFullPath(path);
        if (!OperatingSystem.IsWindows() || !full.Contains('~'))
            return full;
        var buffer = new char[1024];
        var length = GetLongPathNameW(full, buffer, buffer.Length);
        return length > 0 && length < buffer.Length ? new string(buffer, 0, length) : full;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern int GetLongPathNameW(string shortPath, [Out] char[] longPath, int size);
}
