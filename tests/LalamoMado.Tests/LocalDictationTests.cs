using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class LocalDictationTests : IDisposable
{
    readonly string home = Directory.CreateTempSubdirectory("edit-md-whisper-").FullName;

    public void Dispose() => Directory.Delete(home, recursive: true);

    [Theory]
    [InlineData("[BLANK_AUDIO]")]
    [InlineData(" (music)")]
    [InlineData(" *click*")]
    public void A_note_of_a_sound_is_not_speech(string segment) => Assert.True(LocalDictation.IsNonSpeech(segment));

    [Theory]
    [InlineData(" Seems to be working okay.")]
    [InlineData(" the *seek* results (all of them)")]
    public void Words_are_speech_even_around_a_note(string segment) => Assert.False(LocalDictation.IsNonSpeech(segment));

    [Fact]
    public void Without_a_model_Local_is_not_offered()
    {
        var status = new LocalDictation(home).Status();

        Assert.False(status.Local);
        Assert.All(status.Models, model => Assert.False(model.Present));
        Assert.Null(status.Problem);
    }

    [Fact]
    public void One_model_is_enough_to_offer_Local_and_only_it_shows_present()
    {
        Directory.CreateDirectory(Path.Combine(home, "models"));
        File.WriteAllText(Path.Combine(home, "models", "ggml-large-v3-turbo-q8_0.bin"), "");

        var status = new LocalDictation(home).Status();

        Assert.True(status.Local);
        Assert.Equal(["turbo"], status.Models.Where(model => model.Present).Select(model => model.Id));
    }

    [Fact]
    public async Task A_missing_model_fails_the_request_not_the_server()
    {
        var local = new LocalDictation(home);

        await Assert.ThrowsAsync<FileNotFoundException>(() => local.TranscribeAsync("large-v3", "cs", null, new float[16000], CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(() => local.TranscribeAsync("tiny", "cs", null, new float[16000], CancellationToken.None));
        Assert.Null(local.Status().Problem);
    }

    [Fact]
    public void The_whisper_folder_sits_beside_the_preferences()
    {
        Assert.Equal(Path.Combine(home, "whisper"), LocalDictation.NextTo(Path.Combine(home, "prefs.json")));
    }
}
