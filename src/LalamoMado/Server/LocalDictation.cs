using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Routing;
using Whisper.net;
using Whisper.net.LibraryLoader;

namespace LalamoMado.Server;

public sealed record DictationModel(string Id, string Name, bool Present);

/// <param name="Local">A model is there and nothing failed to load: the page may offer Local.</param>
/// <param name="Runtime"><c>cuda12</c> or <c>cpu</c> once a model has loaded, else null.</param>
public sealed record DictationStatus(bool Local, DictationModel[] Models, string? Runtime, string? Problem);

public sealed record Transcript(string Text, long Ms, string? Runtime);

/// <summary>
/// Local dictation (plan 09): Whisper in the server, on the GPU when the opt-in install put NVIDIA's DLLs in <c>whisper/cuda12/</c>, else on the CPU.
/// Research, kept removable: this file, its two lines in <see cref="ReviewServer"/>, <c>client/whisper.js</c> and the <c>whisper/</c> folder are all of it.
/// </summary>
public sealed class LocalDictation(string home)
{
    sealed record Model(string Id, string Name, string File);

    static readonly Model[] Models =
    [
        new("turbo", "Turbo", "ggml-large-v3-turbo-q8_0.bin"),
        new("large-v3", "Large v3", "ggml-large-v3-q5_0.bin"),
    ];

    // Whisper's answer to silence or noise: "[BLANK_AUDIO]", "(music)", "*click*" for a key pressed while Local listens.
    static readonly Regex NonSpeech = new(@"^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*)\s*$");

    public static bool IsNonSpeech(string segment) => NonSpeech.IsMatch(segment);

    readonly ConcurrentDictionary<string, Lazy<WhisperFactory>> factories = new();
    readonly SemaphoreSlim oneAtATime = new(1, 1);
    string? problem;

    /// <summary>The dev build reads the released build's models when it has none of its own: 2–4 GB, and only ever read.</summary>
    public static string NextTo(string preferencesPath)
    {
        if (Environment.GetEnvironmentVariable("EDIT_MD_WHISPER") is { Length: > 0 } custom)
            return custom;
        var own = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(preferencesPath))!, "whisper");
        var released = Path.Combine(BuildChannel.Release.DefaultToolHome, "whisper");
        return BuildChannel.Current == BuildChannel.Dev && !Directory.Exists(own) && Directory.Exists(released) ? released : own;
    }

    public DictationStatus Status()
    {
        var models = Models.Select(model => new DictationModel(model.Id, model.Name, File.Exists(ModelPath(model)))).ToArray();
        return new(problem is null && models.Any(model => model.Present), models, LoadedRuntime(), problem);
    }

    public async Task<DictationStatus> LoadAsync(string modelId, CancellationToken cancellation)
    {
        await oneAtATime.WaitAsync(cancellation);
        try
        {
            FactoryFor(modelId);
        }
        finally
        {
            oneAtATime.Release();
        }
        return Status();
    }

    /// <param name="language">Whisper's code, <c>cs</c> or <c>en</c>: forced, not detected.</param>
    /// <param name="prompt">The text Whisper takes as said before the take: it copies the spelling of the reviewer's terms from it.</param>
    /// <param name="samples">16 kHz mono.</param>
    public async Task<Transcript> TranscribeAsync(string modelId, string language, string? prompt, float[] samples, CancellationToken cancellation)
    {
        await oneAtATime.WaitAsync(cancellation);
        try
        {
            var factory = FactoryFor(modelId);
            var clock = Stopwatch.StartNew();
            var builder = factory.CreateBuilder().WithLanguage(language);
            using var processor = (prompt is null ? builder : builder.WithPrompt(prompt)).Build();
            var text = new StringBuilder();
            await foreach (var segment in processor.ProcessAsync(samples, cancellation))
                if (!IsNonSpeech(segment.Text))
                    text.Append(segment.Text);
            return new(text.ToString().Trim(), clock.ElapsedMilliseconds, LoadedRuntime());
        }
        finally
        {
            oneAtATime.Release();
        }
    }

    string ModelPath(Model model) => Path.Combine(home, "models", model.File);

    WhisperFactory FactoryFor(string modelId)
    {
        var model = Models.FirstOrDefault(known => known.Id == modelId) ?? throw new ArgumentException($"No model {modelId}.");
        if (!File.Exists(ModelPath(model)))
            throw new FileNotFoundException($"The {model.Name} model is not installed.", ModelPath(model));
        try
        {
            return factories.GetOrAdd(model.Id, _ => new Lazy<WhisperFactory>(() => Load(model))).Value;
        }
        catch (Exception e) when (e is not ArgumentException)
        {
            factories.TryRemove(model.Id, out _);
            problem = e.Message;
            throw;
        }
    }

    WhisperFactory Load(Model model)
    {
        PrepareRuntime();
        return WhisperFactory.FromPath(ModelPath(model));
    }

    static int runtimePrepared;

    /// <summary>The CUDA runtime finds NVIDIA's DLLs only on the process PATH; without them the loader falls back to the CPU without a word.</summary>
    void PrepareRuntime()
    {
        if (Interlocked.Exchange(ref runtimePrepared, 1) == 1)
            return;
        var cuda = Path.Combine(home, "cuda12");
        if (Directory.Exists(cuda))
            Environment.SetEnvironmentVariable("PATH", cuda + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH"));
        RuntimeOptions.RuntimeLibraryOrder = [RuntimeLibrary.Cuda12, RuntimeLibrary.Cpu];
    }

    static string? LoadedRuntime() => RuntimeOptions.LoadedLibrary switch
    {
        null => null,
        RuntimeLibrary.Cuda12 => "cuda12",
        RuntimeLibrary.Cpu or RuntimeLibrary.CpuNoAvx => "cpu",
        { } other => other.ToString().ToLowerInvariant(),
    };

    public static void Map(IEndpointRouteBuilder api)
    {
        api.MapGet("/dictation", (LocalDictation local) => Results.Ok(local.Status()));
        api.MapPost("/dictation/load", async (string model, LocalDictation local, CancellationToken cancellation) =>
        {
            try
            {
                return Results.Ok(await local.LoadAsync(model, cancellation));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });
        api.MapPost("/transcribe", async (string model, string language, string? docId, HttpRequest request, LocalDictation local, DocumentRegistry registry, Glossary glossary, CancellationToken cancellation) =>
        {
            using var body = new MemoryStream();
            await request.Body.CopyToAsync(body, cancellation);
            if (body.Length % sizeof(float) != 0)
                return Results.BadRequest(new { error = "The body is not 32-bit float samples." });
            var samples = MemoryMarshal.Cast<byte, float>(body.GetBuffer().AsSpan(0, (int)body.Length)).ToArray();
            try
            {
                var prompt = docId is not null && registry.Find(docId) is { } document ? glossary.For(document.Path).Prompt : null;
                return Results.Ok(await local.TranscribeAsync(model, language, prompt, samples, cancellation));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                return Results.Problem(e.Message, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });
    }
}
