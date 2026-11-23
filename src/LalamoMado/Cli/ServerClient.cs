using System.Net.Http.Json;
using LalamoMado.Server;

namespace LalamoMado.Cli;

public sealed class ServerClient(ServerState state) : IDisposable
{
    readonly HttpClient http = new() { BaseAddress = new Uri(state.Url), Timeout = Timeout.InfiniteTimeSpan };

    public ServerState State { get; } = state;

    public static async Task<ServerClient?> ConnectAsync(TimeSpan waitForStart)
    {
        var deadline = DateTimeOffset.UtcNow + waitForStart;
        while (true)
        {
            if (ServerStateFile.Read() is { } state && await IsAliveAsync(state))
                return new ServerClient(state);
            if (DateTimeOffset.UtcNow >= deadline)
                return null;
            await Task.Delay(250);
        }
    }

    public static async Task<bool> IsAliveAsync(ServerState state)
    {
        using var probe = new HttpClient { BaseAddress = new Uri(state.Url), Timeout = TimeSpan.FromSeconds(2) };
        try
        {
            using var response = await probe.GetAsync("/api/status");
            return response.IsSuccessStatusCode;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    public Task<HttpResponseMessage> GetAsync(string path, CancellationToken cancel = default) => http.GetAsync(path, cancel);

    public Task<HttpResponseMessage> PostAsync<T>(string path, T body) => http.PostAsJsonAsync(path, body, Wire.Json);

    public void Dispose() => http.Dispose();
}
