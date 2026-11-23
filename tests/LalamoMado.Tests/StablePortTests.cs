using System.Net;
using System.Net.Sockets;
using LalamoMado.Server;

namespace LalamoMado.Tests;

public class StablePortTests
{
    [Fact]
    public void A_session_always_prefers_the_same_port_in_the_range()
    {
        var first = StablePort.Candidates("session-a").ToArray();

        Assert.Equal(first, StablePort.Candidates("session-a"));
        Assert.NotEqual(first[0], StablePort.Candidates("session-b").First());
        Assert.All(first, port => Assert.InRange(port, 41000, 41999));
    }

    [Fact]
    public void A_taken_port_falls_through_to_the_next_candidate()
    {
        var own = StablePort.Candidates("session-taken").First();
        using var squatter = new TcpListener(IPAddress.Loopback, own);
        squatter.Start();

        var port = StablePort.ForSession("session-taken");

        Assert.NotEqual(own, port);
        Assert.Contains(port, StablePort.Candidates("session-taken"));
    }
}
