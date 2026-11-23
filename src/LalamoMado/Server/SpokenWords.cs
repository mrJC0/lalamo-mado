using System.Text.RegularExpressions;

namespace LalamoMado.Server;

/// <param name="Dictated">Part of the text was spoken: all of it, or only <paramref name="Parts"/>.</param>
/// <param name="Parts">The spoken parts in order, when only some of the text was spoken.</param>
/// <param name="Maybe">Spoken words and what the recognizer also heard for them.</param>
public sealed record SpokenReading(bool? Dictated = null, string[]? Parts = null, Dictionary<string, string[]>? Maybe = null);

/// <summary>Turns the character ranges the page tracked into what the agent should read with care. Everything else was typed or corrected by hand.</summary>
public static partial class SpokenWords
{
    public static SpokenReading Read(string? text, int[][]? spokenRanges, PhraseGuesses[]? alternatives)
    {
        if (string.IsNullOrWhiteSpace(text) || spokenRanges is not { Length: > 0 })
            return new();

        var spoken = new bool[text.Length];
        foreach (var range in spokenRanges)
            if (range is [var from, var to])
                for (var at = Math.Max(from, 0); at < Math.Min(to, text.Length); at++)
                    spoken[at] = true;

        var parts = new List<string>();
        var partsAsWords = new List<List<string>>();
        var current = new List<Match>();
        var typedWordSeen = false;

        void EndPart()
        {
            if (current.Count == 0)
                return;
            var (first, last) = (current[0], current[^1]);
            parts.Add(text[first.Index..(last.Index + last.Length)]);
            partsAsWords.Add([.. current.Select(word => Comparable(word.Value))]);
            current.Clear();
        }

        foreach (Match word in Words().Matches(text))
        {
            var lettersAndDigits = Enumerable.Range(word.Index, word.Length).Where(at => char.IsLetterOrDigit(text[at])).ToArray();
            if (lettersAndDigits.Length == 0)
                continue;
            // One typed character makes the word typed: a word you touched is a word you looked at.
            if (lettersAndDigits.All(at => spoken[at]))
                current.Add(word);
            else
            {
                typedWordSeen = true;
                EndPart();
            }
        }
        EndPart();

        return parts.Count == 0
            ? new()
            : new(true, typedWordSeen ? [.. parts] : null, GuessesFor(partsAsWords, alternatives));
    }

    static Dictionary<string, string[]>? GuessesFor(List<List<string>> partsAsWords, PhraseGuesses[]? alternatives)
    {
        var maybe = new Dictionary<string, List<string>>();
        foreach (var phrase in alternatives ?? [])
        {
            var said = WordsOf(phrase.Phrase);
            foreach (var other in phrase.Others ?? [])
                foreach (var (run, guess) in ChangedRuns(said, WordsOf(other)))
                {
                    if (run.Length == 0 || guess.Length == 0 || !StillSpoken(partsAsWords, run))
                        continue;
                    var key = string.Join(' ', run);
                    var heard = string.Join(' ', guess);
                    if (!maybe.TryGetValue(key, out var guesses))
                        maybe[key] = guesses = [];
                    if (!guesses.Contains(heard, StringComparer.OrdinalIgnoreCase))
                        guesses.Add(heard);
                }
        }
        return maybe.Count == 0 ? null : maybe.ToDictionary(entry => entry.Key, entry => entry.Value.ToArray());
    }

    static bool StillSpoken(List<List<string>> partsAsWords, string[] run)
    {
        var wanted = run.Select(Comparable).ToArray();
        return partsAsWords.Any(part =>
            Enumerable.Range(0, Math.Max(0, part.Count - wanted.Length + 1)).Any(at => part.Skip(at).Take(wanted.Length).SequenceEqual(wanted)));
    }

    /// <summary>Where two guesses at a phrase differ, by words, ignoring case and punctuation: a longest common subsequence, and what lies between its words.</summary>
    static List<(string[] Run, string[] Guess)> ChangedRuns(string[] said, string[] other)
    {
        var (a, b) = (said.Select(Comparable).ToArray(), other.Select(Comparable).ToArray());
        var common = new int[a.Length + 1, b.Length + 1];
        for (var i = a.Length - 1; i >= 0; i--)
            for (var j = b.Length - 1; j >= 0; j--)
                common[i, j] = a[i] == b[j] ? common[i + 1, j + 1] + 1 : Math.Max(common[i + 1, j], common[i, j + 1]);

        var runs = new List<(string[], string[])>();
        var (x, y, runStartX, runStartY) = (0, 0, 0, 0);
        void EndRun()
        {
            if (x > runStartX || y > runStartY)
                runs.Add((said[runStartX..x], other[runStartY..y]));
        }
        while (x < a.Length || y < b.Length)
        {
            if (x < a.Length && y < b.Length && a[x] == b[y])
            {
                EndRun();
                x++;
                y++;
                (runStartX, runStartY) = (x, y);
            }
            else if (y >= b.Length || (x < a.Length && common[x + 1, y] >= common[x, y + 1]))
                x++;
            else
                y++;
        }
        EndRun();
        return runs;
    }

    static string[] WordsOf(string phrase) => [.. Words().Matches(phrase).Select(word => word.Value)];

    static string Comparable(string word) => new([.. word.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant)]);

    [GeneratedRegex(@"\S+")]
    private static partial Regex Words();
}
