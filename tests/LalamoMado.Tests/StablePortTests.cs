using System.Net;
using System.Net.Sockets;
using LalamoMado.Server;

namespace LalamoMado.Tests;

public class StablePortTests
{
    [Fact]
    public void A_session_always_prefers_the_same_port_in_the_range()
    {
        var first = StablePort.Candidates("session-a", BuildChannel.Release).ToArray();

        Assert.Equal(first, StablePort.Candidates("session-a", BuildChannel.Release));
        Assert.NotEqual(first[0], StablePort.Candidates("session-b", BuildChannel.Release).First());
        Assert.All(first, port => Assert.InRange(port, 41000, 41999));
    }

    [Fact]
    public void The_dev_build_of_a_session_keeps_to_a_range_of_its_own()
    {
        var release = StablePort.Candidates("session-a", BuildChannel.Release).ToArray();
        var dev = StablePort.Candidates("session-a", BuildChannel.Dev).ToArray();

        Assert.All(dev, port => Assert.InRange(port, 42000, 42999));
        Assert.Equal(release.Select(port => port + 1000), dev);
    }

    [Fact]
    public void A_taken_port_falls_through_to_the_next_candidate()
    {
        var own = StablePort.Candidates("session-taken", BuildChannel.Release).First();
        using var squatter = new TcpListener(IPAddress.Loopback, own);
        squatter.Start();

        var port = StablePort.ForSession("session-taken", BuildChannel.Release);

        Assert.NotEqual(own, port);
        Assert.Contains(port, StablePort.Candidates("session-taken", BuildChannel.Release));
    }
}
