using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace LalamoMado.Server;

/// <summary>
/// Chrome keys the microphone grant, localStorage and an open tab to the page's origin, port included,
/// so a session keeps one port across server restarts: derived from its id, below Windows' dynamic port range.
/// </summary>
public static class StablePort
{
    const int RangeStart = 41000;
    const int RangeSize = 1000;
    const int Neighbours = 9;

    /// <returns>The first free candidate, or 0 — any free port — when all of them are taken.</returns>
    public static int ForSession(string? sessionId)
    {
        foreach (var port in Candidates(sessionId))
            if (IsFree(port))
                return port;
        return 0;
    }

    /// <summary>The session's own port first, then its neighbours in the range.</summary>
    public static IEnumerable<int> Candidates(string? sessionId)
    {
        var own = BitConverter.ToUInt32(SHA256.HashData(Encoding.UTF8.GetBytes(string.IsNullOrWhiteSpace(sessionId) ? "default" : sessionId))) % RangeSize;
        for (var step = 0; step <= Neighbours; step++)
            yield return RangeStart + (int)((own + step) % RangeSize);
    }

    static bool IsFree(int port)
    {
        try
        {
            using var probe = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
            probe.Start();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }
}
