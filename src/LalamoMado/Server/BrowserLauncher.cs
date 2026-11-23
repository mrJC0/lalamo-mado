using System.Diagnostics;

namespace LalamoMado.Server;

public sealed record BrowserLaunch(string Browser, bool NewWindow);

/// <summary>
/// Reviews open in a dedicated Chromium profile, never in the user's everyday browser window.
/// One profile per Claude Code session = one browser process per session, so its docs always land as tabs
/// in its own window, even with parallel sessions over other repos. Before every launch the microphone is pre-allowed for the review page.
/// Without Chrome, Chromium or Edge it falls back to the system default browser.
/// </summary>
public static class BrowserLauncher
{
    public const string DefaultBrowser = "default";
    static readonly TimeSpan StaleProfileAge = TimeSpan.FromDays(14);

    static string ProfilesRoot =>
        Environment.GetEnvironmentVariable("EDIT_MD_PROFILE_ROOT") is { Length: > 0 } root
            ? root
            : Path.Combine(AppContext.BaseDirectory, "profiles");

    public static string ProfileDirectory =>
        Environment.GetEnvironmentVariable("EDIT_MD_PROFILE_DIR") is { Length: > 0 } custom
            ? custom
            : Path.Combine(ProfilesRoot, Environment.GetEnvironmentVariable("CLAUDE_CODE_SESSION_ID") is { Length: > 0 } session ? session : "default");

    /// <summary>Best effort: profiles of sessions untouched for two weeks go; a profile still in use is locked and stays.</summary>
    public static void PruneStaleProfiles()
    {
        if (!Directory.Exists(ProfilesRoot))
            return;
        foreach (var profile in new DirectoryInfo(ProfilesRoot).EnumerateDirectories())
        {
            if (DateTime.UtcNow - profile.LastWriteTimeUtc < StaleProfileAge || profile.FullName == Path.GetFullPath(ProfileDirectory))
                continue;
            try
            {
                profile.Delete(recursive: true);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
            }
        }
    }

    static readonly TimeSpan WindowStartupGrace = TimeSpan.FromSeconds(15);
    static DateTimeOffset windowLaunchedAt = DateTimeOffset.MinValue;

    /// <param name="newWindow">no tab of this session is connected; a window launched moments ago whose tab has not connected yet still counts as the session's window, so two quick opens share it.</param>
    public static BrowserLaunch Open(string url, bool newWindow)
    {
        if (FindChromium() is not (string name, string executable))
        {
            OpenWithSystemDefault(url);
            return new(DefaultBrowser, false);
        }
        List<string> arguments = [$"--user-data-dir={ProfileDirectory}", "--no-first-run", "--no-default-browser-check", .. ExtraArguments()];
        newWindow &= DateTimeOffset.UtcNow - windowLaunchedAt > WindowStartupGrace;
        if (newWindow)
        {
            windowLaunchedAt = DateTimeOffset.UtcNow;
            arguments.Add("--new-window");
        }
        arguments.Add(url);
        MicrophoneGrant.AllowIn(ProfileDirectory, url);
        StartDetached(executable, arguments);
        return new(name, newWindow);
    }

    static (string Name, string Executable)? FindChromium()
    {
        var chosen = Environment.GetEnvironmentVariable("EDIT_MD_BROWSER");
        if (string.Equals(chosen, DefaultBrowser, StringComparison.OrdinalIgnoreCase))
            return null;
        if (!string.IsNullOrWhiteSpace(chosen))
            return File.Exists(chosen) ? ("custom", chosen) : null;

        foreach (var (name, candidate) in Candidates())
        {
            if (Path.IsPathRooted(candidate) ? File.Exists(candidate) : OnPath(candidate) is not null)
                return (name, Path.IsPathRooted(candidate) ? candidate : OnPath(candidate)!);
        }
        return null;
    }

    static IEnumerable<(string Name, string Candidate)> Candidates()
    {
        if (OperatingSystem.IsWindows())
        {
            string[] roots = [Env("ProgramFiles"), Env("ProgramFiles(x86)"), Env("LocalAppData")];
            foreach (var root in roots.Where(r => r.Length > 0))
                yield return ("chrome", Path.Combine(root, "Google", "Chrome", "Application", "chrome.exe"));
            yield return ("chromium", Path.Combine(Env("LocalAppData"), "Chromium", "Application", "chrome.exe"));
            foreach (var root in roots.Where(r => r.Length > 0))
                yield return ("edge", Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe"));
        }
        else if (OperatingSystem.IsMacOS())
        {
            foreach (var apps in new[] { "/Applications", Path.Combine(Env("HOME"), "Applications") })
            {
                yield return ("chrome", Path.Combine(apps, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"));
                yield return ("chromium", Path.Combine(apps, "Chromium.app", "Contents", "MacOS", "Chromium"));
                yield return ("edge", Path.Combine(apps, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"));
            }
        }
        else
        {
            yield return ("chrome", "google-chrome");
            yield return ("chrome", "google-chrome-stable");
            yield return ("chromium", "chromium");
            yield return ("chromium", "chromium-browser");
            yield return ("edge", "microsoft-edge");
        }
    }

    /// <summary>
    /// The browser must not inherit the server's stdout: that handle is the agent's background-task output,
    /// and an inherited copy would outlive the server. ShellExecute on Windows and redirected stdio elsewhere avoid it.
    /// </summary>
    static void StartDetached(string executable, List<string> arguments)
    {
        ProcessStartInfo start;
        if (OperatingSystem.IsWindows())
        {
            start = new ProcessStartInfo(executable, string.Join(' ', arguments.Select(QuoteForWindows))) { UseShellExecute = true };
        }
        else
        {
            start = new ProcessStartInfo(executable)
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            arguments.ForEach(start.ArgumentList.Add);
        }
        using var process = Process.Start(start);
        if (process is not null && !OperatingSystem.IsWindows())
        {
            process.StandardInput.Close();
            process.StandardOutput.Close();
            process.StandardError.Close();
        }
    }

    static void OpenWithSystemDefault(string url)
    {
        if (OperatingSystem.IsWindows())
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true })?.Dispose();
        else
            StartDetached(OperatingSystem.IsMacOS() ? "open" : "xdg-open", [url]);
    }

    static IEnumerable<string> ExtraArguments() =>
        (Environment.GetEnvironmentVariable("EDIT_MD_BROWSER_ARGS") ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);

    static string? OnPath(string command) =>
        (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
            .Select(directory => Path.Combine(directory, command))
            .FirstOrDefault(File.Exists);

    static string QuoteForWindows(string argument) =>
        argument.Any(char.IsWhiteSpace) ? $"\"{argument}\"" : argument;

    static string Env(string name) => Environment.GetEnvironmentVariable(name) ?? "";
}
