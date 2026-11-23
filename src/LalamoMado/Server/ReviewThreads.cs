namespace LalamoMado.Server;

/// <summary>
/// What was said per annotation, kept for an agent whose context was compacted: events carry only the newest follow-up.
/// A thread is named after its first annotation, or for a reply to no annotation after that reply (<c>r12</c>).
/// </summary>
public sealed class ReviewThreads
{
    public const string ByReviewer = "reviewer";
    public const string ByAgent = "agent";

    readonly Lock gate = new();
    readonly Dictionary<string, Conversation> conversations = [];
    readonly Dictionary<string, string> rootOfFollowUp = [];

    sealed class Conversation(string? quote, string? lines)
    {
        public string? Quote { get; } = quote;
        public string? Lines { get; } = lines;
        public List<ThreadTurn> Turns { get; } = [];
    }

    /// <summary>The thread an id belongs to: a follow-up's id leads to its thread, so a reply to one stays in the thread.</summary>
    public string RootOf(string id)
    {
        lock (gate)
            return rootOfFollowUp.GetValueOrDefault(id, id);
    }

    public void RecordSent(AgentAnnotation annotation, DateTimeOffset at)
    {
        lock (gate)
        {
            var root = annotation.ReplyTo ?? annotation.Id;
            if (annotation.ReplyTo is not null)
                rootOfFollowUp[annotation.Id] = root;
            GetOrAddConversation(root, annotation.Quote, annotation.Lines).Turns.Add(new(ByReviewer, annotation.Text ?? "", at));
        }
    }

    public void RecordReply(string root, string text, string? quote, DateTimeOffset at)
    {
        lock (gate)
            GetOrAddConversation(root, quote, null).Turns.Add(new(ByAgent, text, at));
    }

    public ThreadView? View(string id)
    {
        lock (gate)
        {
            var root = rootOfFollowUp.GetValueOrDefault(id, id);
            return conversations.TryGetValue(root, out var conversation)
                ? new ThreadView(root, conversation.Quote, conversation.Lines, [.. conversation.Turns])
                : null;
        }
    }

    Conversation GetOrAddConversation(string root, string? quote, string? lines)
    {
        if (!conversations.TryGetValue(root, out var conversation))
            conversations[root] = conversation = new(quote, lines);
        return conversation;
    }
}
