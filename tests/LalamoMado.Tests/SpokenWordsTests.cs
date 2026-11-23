using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class SpokenWordsTests
{
    const string Corrected = "the seek results should stay in the pain see XTbl";

    static int[] RangeOf(string text, string part)
    {
        var at = text.IndexOf(part, StringComparison.Ordinal);
        Assert.True(at >= 0, part);
        return [at, at + part.Length];
    }

    [Fact]
    public void A_mixed_comment_lists_its_spoken_parts_and_leaves_the_typed_words_out()
    {
        var reading = SpokenWords.Read(Corrected, [RangeOf(Corrected, "the "), RangeOf(Corrected, " results should stay in the pain")], null);

        Assert.True(reading.Dictated);
        Assert.Equal(["the", "results should stay in the pain"], reading.Parts!);
    }

    [Fact]
    public void A_fully_spoken_comment_is_dictated_without_a_list_of_parts()
    {
        var reading = SpokenWords.Read("the export runs", [[0, 15]], null);

        Assert.True(reading.Dictated);
        Assert.Null(reading.Parts);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(new int[0])]
    public void A_fully_typed_comment_carries_neither(int[]? noRange)
    {
        var reading = SpokenWords.Read("typed by hand", noRange is null ? null : [], null);

        Assert.Null(reading.Dictated);
        Assert.Null(reading.Parts);
        Assert.Null(reading.Maybe);
    }

    [Fact]
    public void A_typed_comma_does_not_split_a_part()
    {
        const string text = "hello, world";
        var reading = SpokenWords.Read(text, [[0, 5], [7, 12]], null);

        Assert.True(reading.Dictated);
        Assert.Null(reading.Parts);
    }

    [Fact]
    public void A_word_of_only_punctuation_between_spoken_words_does_not_split_a_part()
    {
        const string text = "first — and more typed";
        var reading = SpokenWords.Read(text, [[0, 5], [8, 16]], null);

        Assert.Equal(["first — and more"], reading.Parts!);
    }

    [Fact]
    public void One_typed_letter_makes_its_word_typed()
    {
        const string text = "market value";
        var reading = SpokenWords.Read(text, [[0, 5], [6, 12]], null);

        Assert.Equal(["value"], reading.Parts!);
    }

    [Fact]
    public void Ranges_outside_the_text_do_no_harm()
    {
        var reading = SpokenWords.Read("short", [[-3, 900]], null);

        Assert.True(reading.Dictated);
    }

    static readonly PhraseGuesses Probed = new("označ ten Mark a pošli jí do plánu",
    [
        "označten Mark a pošli zík do plánu",
        "označ ten Mark a pošli zík do plánu",
        "Označte Mark a pošli zík do plánu",
        "označ ten Mark a pošli jí doplánu",
    ]);

    [Fact]
    public void The_recognizers_guesses_become_maybe_by_changed_runs()
    {
        var reading = SpokenWords.Read(Probed.Phrase, [[0, Probed.Phrase.Length]], [Probed]);

        Assert.Equal(["zík"], reading.Maybe!["jí"]);
        Assert.Equal(["označten", "Označte"], reading.Maybe!["označ ten"]);
        Assert.Equal(["doplánu"], reading.Maybe!["do plánu"]);
        Assert.Equal(3, reading.Maybe!.Count);
    }

    [Fact]
    public void A_corrected_word_loses_its_guesses()
    {
        const string text = "označ ten Mark a pošli seek do plánu";
        var typed = RangeOf(text, "seek");
        var reading = SpokenWords.Read(text, [[0, typed[0]], [typed[1], text.Length]], [Probed]);

        Assert.False(reading.Maybe!.ContainsKey("jí"));
        Assert.True(reading.Maybe!.ContainsKey("do plánu"));
    }

    [Fact]
    public void A_phrase_with_one_guess_gives_no_maybe()
    {
        const string text = "výsledky hledání";
        var reading = SpokenWords.Read(text, [[0, text.Length]], [new(text, [])]);

        Assert.Null(reading.Maybe);
    }

    [Fact]
    public void Guesses_differing_only_in_case_or_punctuation_or_by_a_dropped_word_give_no_maybe()
    {
        const string text = "mark a plan";
        var reading = SpokenWords.Read(text, [[0, text.Length]], [new(text, ["Mark a plan.", "mark plan"])]);

        Assert.Null(reading.Maybe);
    }
}
