using System.Security.Cryptography;
using System.Text;

namespace LalamoMado.Server;

/// <summary>
/// The version of each document the reviewer last saw, kept next to the preferences, so the diff survives a new session or a reinstall.
/// One file per document; parallel sessions' servers share the folder, and the last write wins.
/// </summary>
public sealed class LastSeenVersions(string directory)
{
    static readonly TimeSpan KeepFor = TimeSpan.FromDays(30);

    public static string NextTo(string preferencesPath) =>
        Path.Combine(Path.GetDirectoryName(Path.GetFullPath(preferencesPath))!, "last-seen");

    public string? Read(string documentPath)
    {
        try
        {
            var file = FileOf(documentPath);
            return File.Exists(file) ? File.ReadAllText(file) : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>A failed write only costs the next round its change marks, so it never fails the page load.</summary>
    public void Write(string documentPath, string source)
    {
        try
        {
            Directory.CreateDirectory(directory);
            var file = FileOf(documentPath);
            var temporary = $"{file}.{Guid.NewGuid():N}.tmp";
            File.WriteAllText(temporary, source);
            File.Move(temporary, file, overwrite: true);
            ForgetStale();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
    }

    void ForgetStale()
    {
        var cutoff = DateTime.UtcNow - KeepFor;
        foreach (var file in new DirectoryInfo(directory).EnumerateFiles("*.txt").Where(f => f.LastWriteTimeUtc < cutoff))
            file.Delete();
    }

    string FileOf(string documentPath) =>
        Path.Combine(directory, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(DocumentKey.Of(documentPath))))[..16] + ".txt");
}
