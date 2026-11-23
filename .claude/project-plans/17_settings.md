---
feature: settings
status: landed
created: 2026-11-19
---
# 17 Settings — driven by the AI, shown live

## Goal
edit-md is an AI-first tool, and its settings should show it (review 2026-11-19).
⚙ keeps its ticks and toggles, but above them it says that settings are best changed by asking the agent, in the chat or in the page.
The agent finds and changes any setting directly, and an open page shows the change at once: the tick moves while you watch.
That live change doubles as the onboarding demonstration (plan 05) that this is an AI-first tool.
Hotkeys are a subsection of the settings, with the same contract.
A few built-in comment kinds are stable gateways into the system's own configuration: they're hidden from the everyday chips and reached from ⚙ or by talking to the agent.

## What a setting is
One entry in a **settings registry** the server serves: `key`, a `description` written for the reviewer and the agent alike, `type` (on/off, a choice, a number), `default`, the scopes it may be kept in, and its section (*Comments*, *Dictation*, *Threads*, *Hotkeys*…).
⚙ is built from the registry, so a setting added there shows up in ⚙, in its search and in `edit-md settings` without further code.
Values stay where they are today, `prefs.json` with its pc, session and document scopes (`Server/Preferences.cs`), plus a **repo** level in `<git root>/.claude/edit-md/prefs.json`, layered like the labels.
The more specific value wins: document, then session, then repo, then pc.
The pc level, yours, is the everyday one; the repo level is for the expert case of a team sharing a setting.
The settings plan 16 and plan 09 step 5 add land here: *opening a chat counts as coming back*, *chips for the agent's own threads*, *Fix with Local's transcript too* (built 2026-11-20 as `dictation.fixWithLocal`), *switch to Local when Chrome stops answering*, *after a fallback, stay on Local*.

## The agent changes settings
- `edit-md settings` lists every setting with its description, scope, value and default.
- `edit-md settings --set <key>=<value> [--scope pc|repo|session|document]` changes one, checked against the registry; an unknown key or a wrong value is refused with what is allowed. Without `--scope` it is kept for this PC, as ⚙ does.
- The skill tells the agent: when the reviewer asks for a behaviour, look in the settings first; propose a new setting only when none fits.

## Live in the page
- A change from the agent goes to every open page through the inbox feed the replies already use, so there's no new channel.
- The page re-reads its preferences, moves the control, and flashes it once.
- The status message says *Changed by the agent: Clicking a chat's highlight opens the small card — on*.
- If ⚙ is closed, it stays closed; the gear flashes instead.

## ⚙ itself
- **A banner on top**, in large print: *Settings are best changed by asking the agent — say what you want in the chat, or below.* The ticks stay below it.
- **The main button**, ⚙ *Ask for a setting…*, opens a general comment with the *Setting* kind picked (see below), so the reviewer just says what's on their mind.
- **A search box** filters the settings by name and description as you type.
- **Sections** come from the registry; *Hotkeys* is one of them.

## Built-in comment kinds — stable gateways
These are labels with fixed roles, in the shipped `comment_labels.json`, marked `"hidden": true`.
The chips and the 🏷 palette leave them out, so no one picks one by accident.
`edit-md labels` still lists them, and the skill knows each one's role:
- ⚙ **Setting** — "change or add a setting": the agent uses `edit-md settings --set`, or proposes a new setting when none fits. The main button in ⚙ opens it.
- 🎨 **Customize the page** — styling or behaviour of the page itself, cosmetic or deeper. It sits under ⚙ with an explanation that this is an expert feature: the agent changes the page's own files.
- 🏷 **New comment kind** — "add a label": the agent writes it into your or the repo's `comment_labels.json` and checks it with `edit-md labels`.
- 🔧 **Add a program** (plan 15) — the agent finds a program on this PC and writes an `open` label for it; it sets up the system, so it is a gateway, not a chip.

🎨's changes go into a personal **overlay folder**, holding only the changed page files, which the server prefers over the installed ones and a reinstall keeps — the same idea as `serve --client`, for a few files.

Everything these do can also be asked for in the chat; the buttons make it visible that the system is built for it.

## Hotkeys
- Every action with a key has a stable id: `comment.add` (Ctrl+Enter), `comment.sendNow` (Ctrl+Shift+Enter), `dictation.toggle` (Ctrl+D), `skills.open` (Ctrl+Space), `stamp.palette` (Ctrl+Shift tapped), `label.<id>` (Alt+digit).
  The key bound to each lives in the settings as `hotkeys.<id>`, at the pc or the repo level like any setting.
- When two actions end up on one key, the more specific level's binding wins and the other action loses that key; ⚙'s *Hotkeys* section shows it as shadowed.
- Alt+digit toggles: on a label already picked in the comment popup it unpicks it, and on the label already armed for stamping it disarms it.
- One table in the page binds them. Every hint (placeholders, titles, the palette's digits, chip digits) reads from that same table, so a rebound key shows everywhere at once.
- The structure has to survive people customizing their page heavily: actions are found by id, never by where their code sits.
- ⚙'s *Hotkeys* section lists them read-only, with the banner's advice: to change one, ask the agent.

## Steps & gates
1. ✅ **Registry, `edit-md settings`, live push.** *Built 2026-11-20, gate passed in `roundtrip.mjs` — see As built.* `Server/Settings.cs` holds the registry and `GET /api/settings`, and validates `--set`. The CLI gets `settings`. The page builds ⚙ from the registry and adds the banner and search. A pushed change moves the control and flashes it.
   *Gate:* with a page open, `edit-md settings --set threads.highlightOpensCard=true` ticks the box in ⚙ without a reload, and the status message names it. `edit-md settings` lists every tick ⚙ shows. A wrong value is refused with the allowed ones. Searching "chat" leaves only the thread settings.
2. ✅ **Gateways.** *Built 2026-11-20 without 🔧, which comes with plan 15's open labels; gate passed in `roundtrip.mjs`.* `"hidden"` in the labels contract; the shipped kinds, 🔧 with plan 15's open labels; ⚙'s main button and the 🎨 and 🏷 buttons; the overlay folder for 🎨; the skill's lines for each.
   *Gate:* the chips and palette don't show them; `edit-md labels` lists them as hidden; ⚙ *Ask for a setting…* opens a general comment with *Setting* picked.
3. ✅ **Hotkeys.** *Built 2026-11-20, gate passed in `roundtrip.mjs`.* The action table, binding from `hotkeys.*` at either level, hints from the same table, a collision shown as shadowed.
   *Gate:* `edit-md settings --set hotkeys.dictation.toggle=Ctrl+M` makes Ctrl+M dictate and Ctrl+D do nothing. The 🎤 hover and the comment box's placeholder both say Ctrl+M. A repo binding of Ctrl+M to another action wins, and ⚙ shows the pc one shadowed.

**Build order** (decided 2026-11-20): after plan 09 step 5's first half and before plan 16, so plan 16's two settings land in the registry.

## As built (2026-11-20)
- **Registry:** `Server/Settings.cs` — `SettingsRegistry` lists every setting with `key`, `section`, `name` (the line in ⚙), `description`, `type` (`toggle`, `choice`, `number`, `hotkey`), `default`, `scopes` (the first is where ⚙ and `--set` keep it), `choices`, `min`/`max`/`step`, `requires` (`dictation`, `local`); `Parse` reads a typed value and refuses anything else with what is allowed. Local's model lists only the models installed. `GET /api/settings` lists them with `value` and `from`; `POST /api/settings` changes one and appends an inbox `setting` message to every open page.
- **Levels:** `Preferences` gains `repo`, in `<git root>/.claude/edit-md/prefs.json`, written LF and indented, never over a file that does not read; `PreferenceView.Effective` takes the most specific: document, session, repo, pc. The page reads the same order.
- **CLI:** `edit-md settings [docId] [--set KEY=VALUE | --unset KEY] [--scope pc|repo|session|document]`; without a document, the repo level is that of the folder the agent runs in.
- **Page:** `prefs.js` keeps the registry, whose defaults win over the page's own fallbacks, and tells listeners when a value in effect changes, from ⚙, a pane's control or the agent. `settings.js` builds ⚙: the banner, ⚙ *Ask for a setting…*, a search over names, descriptions and keys, a section per registry section, Dictation's glossary and GPU notes, an *Expert* box with 🎨 and 🏷, and *Reset kept popup positions*. A value kept for a repo, session or document shows `· this repo` and its control is left to the agent. The agent's change flashes its line, or the gear while ⚙ is closed, and the status message says *Changed by the agent: … — on*.
- **Gateways:** `hidden` in the labels contract; ⚙ Setting, 🎨 Customize the page, 🏷 New comment kind shipped hidden, each with a description that tells the agent what to do. The chips, the palette and the hotkeys leave them out; a picked one shows in the popup. A hidden label takes no hotkey (a problem is listed). The overlay folder `~/.claude/edit-md/client/` is created at start and served before the installed client, `index.html` included; `serve` reports it.
- **Hotkeys:** `client/hotkeys.js` is the one table: `comment.add`, `comment.sendNow`, `dictation.toggle`, `skills.open`, `stamp.palette` and `label.<id>`, each the setting `hotkeys.<id>`. A key is named `Ctrl+Shift+Enter`, `Alt+5` or `Ctrl+Shift tapped`. Two actions on one key: the more specific level wins, a default being the least, and ⚙ strikes the other through as *shadowed*. The popup's and the follow-up box's placeholders, the 🎤 hover, the skills button, the stamp button's hover, the chip digits and tips, and the palette's digits all read it. ⚙'s Hotkeys section is read-only: *To change a key, ask the agent*.
- **Skill:** a *Settings* section (look there first, `--set`, `--unset`, scopes, refusals, propose a new one only when none fits), the three gateways in the label list, `hidden` in `labels --set`, and the overlay folder.
- **Tests:** `SettingsRegistryTests` (toggles, refusals, choices, Local's models, scopes, defaults, keys and their refusals, label keys), `PreferencesTests` (the repo level and an unreadable repo file), `CommentLabelsTests` (a hidden label keeps its flag and takes no hotkey); `roundtrip.mjs`: three checks, one per step's gate, and the existing ⚙ checks moved to the registry's keys.

**Deviations:**
- *More settings than ⚙ had:* the right pane's order, *Compact* and *Replies*, the outline and the dictation language joined, so the agent finds them too; their own controls stay and follow the same setting.
- *A name and a description:* the plan named one text; ⚙'s line needs a short one, the agent and the hover a full one.
- *`--unset`* undoes a change; the plan had no way back.
- *⚙ leaves a value kept for a repo, session or document to the agent:* ⚙ keeps values for this PC, which would not win there, so the control is disabled and says where the value lives.
- *Local's three settings* may be kept for this PC or the session only: they depend on the machine's GPU and models.
- *`comment.add` also sends a follow-up* in the thread panel, and the follow-up box takes `comment.sendNow` too, as before; no separate action.
- *Label keys stay Alt+digit:* the digit alone picks while stamping. Other keys need Ctrl or Alt; a tap needs two modifiers, as one alone is taken.
- *The popup's placeholder names the dictation key*, which the gate asked for, and reads *Ctrl+Space skills* instead of *Ctrl+Space — skills*.
- *A tie on one level* goes to the action earlier in the table.
- *Label keys follow the label list as the page loaded it;* a label added later binds by its digit until a reload.

**Lessons:**
- In `page.eval` template strings Node eats `\"`: quote attribute selectors with single quotes.
- A synthetic `KeyboardEvent` has no `code` unless given; matching a letter by what the key prints kept the old tests and gets the Czech Z/Y swap right, digits stay by place.
- The e2e serves the client copied into `bin/` at build: rebuild after a client edit, or the test runs the old file.
- The skill picker opens after loading the skills: a test waits for it.
- One run timed out at "the draft after a reload" and the next passed; watch it.

## Decided
- From review (2026-11-20): 🔧 *Add a program* is a hidden gateway under ⚙, not a chip.
- From review (2026-11-20): 🎨's changes go into a personal overlay folder that a reinstall keeps.
- From review (2026-11-20): settings, hotkeys included, live at the pc and the repo level, the more specific winning on a collision; no file of their own for hotkeys.
- From review (2026-11-20): `--set` without `--scope` keeps the value for this PC; the repo level is for experts and rare.
- From review (2026-11-20): plan 17 is built before plan 16.
- From review (2026-11-20): Alt+digit toggles a label off when it is already picked, in the popup and for stamping — built at once, and passed in the showcase the same day.
- From the showcase (2026-11-20): a label's hover names it at once and adds its description after a ⚙ delay, 1 s by default instead of a fixed 3 s (`labels.descriptionDelaySeconds`) — built.
- From review (2026-11-19): a setting where both options are viable (`.claude/rules/viable-options-become-settings.md`); the agent can find and change every setting.
- From review (2026-11-19): settings are best driven by the AI — a banner says so in ⚙, the agent changes them from the chat, and the page shows it live.
- From review (2026-11-19): built-in comment kinds as stable gateways — *Setting*, *Customize the page*, *New comment kind* — hidden from the general selector, reachable from ⚙ or by asking.
- From review (2026-11-19): hotkeys are a subsection of settings with a stable contract that survives heavy customization of the page.
