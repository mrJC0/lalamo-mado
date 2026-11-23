using LalamoMado.Server;

namespace LalamoMado.Tests;

public sealed class SettingsRegistryTests
{
    static readonly Setting[] Registered = SettingsRegistry.For(new DictationStatus(true, [new("turbo", "Turbo", true), new("large-v3", "Large v3", false)], null, null),
        [new("good", "👍", "Looks good", Hotkey: 5), new("comment", "💬", "Comment"), new("insert", "➕", "Insert here", Point: true), new("setting", "⚙️", "Setting", Hidden: true)]);

    static Setting Named(string key) => SettingsRegistry.Find(Registered, key);

    [Theory]
    [InlineData("true", true)]
    [InlineData("ON", true)]
    [InlineData("off", false)]
    [InlineData(" no ", false)]
    public void A_toggle_reads_the_usual_words_for_on_and_off(string typed, bool expected) =>
        Assert.Equal(expected, SettingsRegistry.Parse(Named("threads.highlightOpensCard"), typed).GetValue<bool>());

    [Fact]
    public void A_wrong_value_is_refused_with_what_the_setting_allows()
    {
        Assert.Contains("true or false", Assert.Throws<SettingRefusal>(() => SettingsRegistry.Parse(Named("scroll.adaptive"), "maybe")).Message);
        Assert.Contains("from 0 to 10", Assert.Throws<SettingRefusal>(() => SettingsRegistry.Parse(Named("labels.descriptionDelaySeconds"), "11")).Message);
        Assert.Contains("document, created, edited", Assert.Throws<SettingRefusal>(() => SettingsRegistry.Parse(Named("annotations.order"), "random")).Message);
    }

    [Fact]
    public void A_choice_is_kept_as_the_registry_spells_it_and_a_number_reads_with_a_dot()
    {
        Assert.Equal("en-US", SettingsRegistry.Parse(Named("dictation.language"), "en-us").GetValue<string>());
        Assert.Equal(0.5, SettingsRegistry.Parse(Named("labels.descriptionDelaySeconds"), "0.5").GetValue<double>());
    }

    [Fact]
    public void Locals_model_offers_only_the_models_installed()
    {
        Assert.Equal(["turbo"], Named("dictation.model").Choices!.Select(choice => choice.Value));
        Assert.Throws<SettingRefusal>(() => SettingsRegistry.Parse(Named("dictation.model"), "large-v3"));
    }

    [Fact]
    public void An_unknown_key_or_scope_is_refused_with_the_known_ones()
    {
        Assert.Contains("scroll.adaptive", Assert.Throws<SettingRefusal>(() => Named("no.such")).Message);
        Assert.Equal(PreferenceScopes.Pc, SettingsRegistry.ScopeFor(Named("dictation.engine"), null));
        Assert.Contains("pc, session", Assert.Throws<SettingRefusal>(() => SettingsRegistry.ScopeFor(Named("dictation.engine"), PreferenceScopes.Repo)).Message);
    }

    [Fact]
    public void Every_setting_is_described_kept_for_this_pc_first_and_has_a_default_it_allows()
    {
        foreach (var setting in Registered.Where(setting => setting.Key != "dictation.model" || setting.Choices!.Length > 0))
        {
            Assert.False(string.IsNullOrWhiteSpace(setting.Description), setting.Key);
            Assert.Equal(PreferenceScopes.Pc, setting.Scopes[0]);
            Assert.Equal(setting.Default.ToJsonString(), SettingsRegistry.Parse(setting, setting.Default.ToString()).ToJsonString());
        }
    }

    [Theory]
    [InlineData("hotkeys.dictation.toggle", "ctrl+m", "Ctrl+M")]
    [InlineData("hotkeys.comment.sendNow", "shift+control+enter", "Ctrl+Shift+Enter")]
    [InlineData("hotkeys.stamp.palette", "shift+ctrl tapped", "Ctrl+Shift tapped")]
    [InlineData("hotkeys.stamp.palette", "Ctrl+K", "Ctrl+K")]
    [InlineData("hotkeys.label.good", "alt+7", "Alt+7")]
    [InlineData("hotkeys.dictation.toggle", "none", "")]
    public void A_key_is_kept_in_one_spelling(string key, string typed, string kept) =>
        Assert.Equal(kept, SettingsRegistry.Parse(Named(key), typed).GetValue<string>());

    [Theory]
    [InlineData("hotkeys.dictation.toggle", "M")]
    [InlineData("hotkeys.dictation.toggle", "Shift+M")]
    [InlineData("hotkeys.dictation.toggle", "Ctrl+Shift tapped")]
    [InlineData("hotkeys.stamp.palette", "Ctrl tapped")]
    [InlineData("hotkeys.label.good", "Ctrl+5")]
    [InlineData("hotkeys.label.good", "Alt+0")]
    [InlineData("hotkeys.skills.open", "Ctrl+Hyper+K")]
    public void A_key_that_would_type_or_clash_with_the_page_is_refused(string key, string typed) =>
        Assert.Contains("takes", Assert.Throws<SettingRefusal>(() => SettingsRegistry.Parse(Named(key), typed)).Message);

    [Fact]
    public void Each_visible_label_but_a_point_has_a_hotkey_its_digit_gives()
    {
        Assert.Equal("Alt+5", Named("hotkeys.label.good").Default.GetValue<string>());
        Assert.Equal("", Named("hotkeys.label.comment").Default.GetValue<string>());
        Assert.DoesNotContain(Registered, setting => setting.Key is "hotkeys.label.insert" or "hotkeys.label.setting");
    }
}
