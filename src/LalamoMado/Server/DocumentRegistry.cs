using System.Collections.Concurrent;

namespace LalamoMado.Server;

public sealed class DocumentRegistry(LastSeenVersions lastSeen)
{
    readonly ConcurrentDictionary<string, ReviewDocument> byId = new();
    readonly Lock openGate = new();
    int nextId;

    public AgentEventQueue AgentEvents { get; } = new();

    public IEnumerable<ReviewDocument> All => byId.Values.OrderBy(d => d.DocId.Length).ThenBy(d => d.DocId);

    public ReviewDocument? Find(string docId) => byId.GetValueOrDefault(docId);

    public (ReviewDocument Document, bool Reopened) Open(string path)
    {
        var fullPath = System.IO.Path.GetFullPath(path);
        lock (openGate)
        {
            var existing = byId.Values.FirstOrDefault(d => string.Equals(d.Path, fullPath, PathComparison));
            if (existing is not null)
            {
                existing.Load();
                if (existing.Submitted)
                {
                    existing.StartNewRound();
                    AgentEvents.Supersede(e => e.DocId == existing.DocId && e.Round < existing.Round);
                }
                return (existing, true);
            }
            var document = new ReviewDocument($"d{++nextId}", fullPath, lastSeen);
            document.Load();
            byId[document.DocId] = document;
            return (document, false);
        }
    }

    public AgentEvent Raise(ReviewDocument document, string kind, Func<AgentEvent, AgentEvent>? details = null) =>
        AgentEvents.Enqueue(seq =>
        {
            var basic = new AgentEvent(seq, kind, document.DocId, document.Round, document.Path, DateTimeOffset.Now);
            return details is null ? basic : details(basic);
        });

    static StringComparison PathComparison =>
        OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
}
