namespace LalamoMado.Cli;

public sealed class Arguments
{
    readonly Dictionary<string, string?> options = new(StringComparer.Ordinal);

    public List<string> Positional { get; } = [];

    public static Arguments Parse(IEnumerable<string> args, params string[] switches)
    {
        var parsed = new Arguments();
        using var cursor = args.GetEnumerator();
        while (cursor.MoveNext())
        {
            var token = cursor.Current;
            if (!token.StartsWith("--", StringComparison.Ordinal) || token == "--")
            {
                parsed.Positional.Add(token);
                continue;
            }
            var name = token[2..];
            if (switches.Contains(name))
                parsed.options[name] = null;
            else if (cursor.MoveNext())
                parsed.options[name] = cursor.Current;
            else
                throw new UsageException($"Option --{name} needs a value.");
        }
        return parsed;
    }

    public bool Has(string name) => options.ContainsKey(name);

    public string? Value(string name) => options.GetValueOrDefault(name);

    public int? Int(string name) =>
        Value(name) is { } raw ? int.TryParse(raw, out var value) ? value : throw new UsageException($"--{name} expects a number.") : null;
}

public sealed class UsageException(string message) : Exception(message);
