using System.Reflection;
using LalamoMado.Server;

namespace LalamoMado;

/// <summary>
/// The released edit-md and the one being built run side by side, even in one Claude Code session (plan 19).
/// The build bakes in its channel (<c>-p:EditMdChannel=dev</c>), and every home and port that could meet the other build's derives from it.
/// </summary>
/// <param name="HomeName">The folder name of its server state under temp, its user files under the Claude home, and its default tool home under <c>bin/</c>.</param>
public sealed record BuildChannel(string Name, string HomeName, int FirstPort)
{
    public static readonly BuildChannel Release = new("release", "edit-md", 41000);
    public static readonly BuildChannel Dev = new("dev", "edit-md-dev", 42000);

    public static BuildChannel Current { get; } = Metadata("EditMdChannel") == Dev.Name ? Dev : Release;

    /// <summary>The commit it was built from, <c>-dirty</c> when the tree had changes; null for a build outside <c>scripts/publish.ps1</c>.</summary>
    public static string? Commit { get; } = Metadata("EditMdCommit") is { Length: > 0 } commit ? commit : null;

    public string StateRoot => Path.Combine(Path.GetTempPath(), HomeName);

    /// <summary>The reviewer's own labels, send buttons, glossary and page overlay.</summary>
    public string UserFilesDirectory => Path.Combine(CommentLabels.ClaudeHome, HomeName);

    public string DefaultToolHome => Path.Combine(CommentLabels.ClaudeHome, "bin", HomeName);

    static string? Metadata(string key) =>
        typeof(BuildChannel).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(attribute => attribute.Key == key)?.Value;
}
