---
feature: local-dictation
status: active
created: 2026-11-02
---
# 09 Local dictation — Whisper in the server, a vocabulary, and the agent as a fixer

## Goal
Chrome's speech engine mishears this reviewer badly: Czech, English with a Czech accent, and domain terms ("secret" for *seek*, "market" for *mark*, lorem round 10).
Add a second engine — Whisper, running inside the edit-md server on this PC's GPU — next to Chrome's, **toggleable**, both working.
Feed both a vocabulary kept per repository and one for the reviewer personally, and let the agent fix a transcript on demand, with the document as context.

## Facts this rests on (researched 2026-11-02)
- Claude Code's own dictation cannot be borrowed: it streams audio to Anthropic's transcription service, has no API, and reusing the claude.ai sign-in from another app breaks the terms. The agent never hears audio — the Messages API takes no sound — but it can correct text.
- **Whisper.net** 1.9.1 (MIT, whisper.cpp bindings, net10): in-process, `WithPrompt`, `WithLanguage("cs"|"en"|"auto")`, Silero VAD, a runtime loader that falls back GPU → CPU by itself. Input: 16 kHz mono PCM or `float[]`.
- This PC: RTX 4060 Laptop, 8 GB, driver 577.02 = CUDA 12.9 — so the **Cuda12** runtime (CUDA 13 needs a newer driver). The CUDA libraries (cuBLAS) are not bundled and no CUDA toolkit is installed here.
- Models (ggml, Hugging Face `ggerganov/whisper.cpp`): large-v3-turbo q8_0 874 MB, large-v3 q5_0 1.08 GB, medium q8_0 823 MB. Third-party Czech word error rates: large-v3 ≈ 12, turbo ≈ 11. No figures exist for Czech-accented English — we measure our own.
- Vocabulary biasing is the prompt: it fills Whisper's "previous text" slot, last 224 tokens only; the model copies spelling and style from it; long word lists can cause hallucinations. A mishearing → canonical map after transcription is the reliable complement.
- Accent adaptation beyond that is a LoRA fine-tune (hours of one's own transcribed audio, 6–8 h of training on an 8 GB GPU), convertible to ggml.

## Steps & gates
0. ✅ **Fix with agent — Chrome first.** *Built 2026-11-02; tested in lorem round 11: three fixes, Use → Send now, the dictated mark.* A ✨ *Fix* button in the comment popup sends the comment's text, the span and its lines to the agent as a `fix` event. The agent corrects misheard words against the document, the conversation and the vocabulary, and pushes a suggestion back: it shows under the comment box as *Agent suggests: … [Use] [Dismiss]* — it never overwrites what you typed. Needs no Whisper, so it can land first. *Gate:* "the secret results" over a span about seeks comes back as "the seek results", offered, not applied.
1. ✅ **The switch — Chrome | Local (Whisper)**, first since 2026-11-09 (was step 2; the lab moved to step 6). You compare the engines in real reviews. *Validated in real use 2026-11-11 — see below.*
   **Server.**
   - `Whisper.net`, `Whisper.net.Runtime` and `Whisper.net.Runtime.Cuda12.Windows` 1.9.1 in the project.
   - `Server/LocalDictation.cs`, a singleton. Its home is `whisper/` beside `prefs.json`, the tool home; `EDIT_MD_WHISPER` overrides it, for a dev build and the tests. Before the first load it puts `whisper/cuda12/` first on the process `PATH` and orders the runtimes Cuda12 → CPU. A model loads on first use and stays loaded; one transcription runs at a time per model.
   - `GET /api/dictation` → `{ local, models: [{ id, name, present }], runtime }`. `local` is true when the runtime loads and at least one model is there; `runtime` is `cuda12`, `cpu`, or null before the first load.
   - `POST /api/transcribe?model=turbo&language=cs` takes the take's 16 kHz mono `float32` samples as the body → `{ text, ms, runtime }`.
   **Page.**
   - `client/whisper.js` records with `getUserMedia` into an `AudioContext` at 16 kHz and an AudioWorklet. It cuts at a pause (about 0.7 s under an energy floor, or 25 s at most) and posts each piece.
   - While a piece transcribes, "…" stands at the caret; the text replaces it through the same path as Chrome's, so it counts as spoken (`sources.spoke()`) and ✨ Fix works unchanged. Whisper gives no alternatives, so `maybe` stays empty with Local.
   - `mic.js` picks the engine; Ctrl+D, 🎤 and CZ/EN work as today, the language forced per piece.
   - **The switch:** a badge beside CZ/EN in each box, `Chrome` or `Local`, cycled by a click like CZ/EN; ⚙ holds the engine and the model (turbo | large-v3). Kept for this PC. Shown only when the server reports `local`; ⚙ also says whether it runs on the GPU or the CPU.
   *Gate:* a dictated comment with Local lands at the caret, counted as spoken, and ✨ Fix still works; switching engines mid-comment keeps the text; without `whisper/cuda12/` it runs on the CPU and ⚙ says so; without models Local is not offered. Tests: `LocalDictation` status in unit tests; a new `tests/e2e/local-dictation.mjs`, kept out of `roundtrip.mjs` because it needs the models, feeds a recorded take as the microphone (Chrome's `--use-file-for-fake-audio-capture`) and checks the text.
2. ✅ **Installing it on another PC — opt-in, offered by the agent.** *Built 2026-11-09 (`onboarding/install-whisper.ps1` and the README section). Gate passed 2026-11-16: into an empty tool home it fetched the turbo model and NVIDIA's three DLLs (1.6 GB on disk), every hash checked, and `local-dictation.mjs` pointed at it ran Local on the GPU; a second run kept every file. Its JSON's `models` was an object with one model, not the list the README reads; now always a list.* An optional section in `onboarding/README.md`, the guide the agent follows, asks the user whether they want local dictation. It states the size (about 2 GB) and that without an NVIDIA GPU it runs on the CPU, about 30× slower (12 s for 7 s of speech here). Only on a yes does the agent run `onboarding/install-whisper.ps1`, which fetches NVIDIA's three CUDA DLLs (SHA-256 checked) where an NVIDIA GPU is present, and the turbo model; large-v3 on request. `install.ps1` itself never installs it, and the server never downloads anything. *Gate:* a fresh tool home after `install-whisper.ps1` gets Local on the GPU; without it the page shows Chrome only.
3. **Vocabulary — per repo and personal.** *Built 2026-11-16, its gate passed in `local-dictation.mjs` — see As built — step 3; real use next.* Decided 2026-11-11. Two files: `<git root>/.claude/edit-md/glossary.json` and `~/.claude/edit-md/glossary.json`, beside the label lists, the most specific winning — terms (`XTbl`, `IRows`, `edit-md`) and mishearings (`"ex table" → "XTbl"`). Terms build Whisper's prompt as one short sentence under 224 tokens; mishearings correct both engines' text, the word staying marked as spoken with the original in plan 14's `maybe`; the agent's *Fix* reads both. *Gate:* a repo term dictated without the glossary comes out wrong, with it right. Detail below, under *Step 3 — the glossary (decided 2026-11-16)*.
4. **Learning from corrections.** *Built 2026-11-18, its gate passed in `roundtrip.mjs` — see As built — step 4; real use next.* Its five questions decided 2026-11-18 — detail below, under Step 4. When you edit dictated words before adding the comment, or accept an agent fix, the page offers *Remember "ex table" → XTbl: [This repo] [Me] [×]*; never silently. *Gate:* an accepted pair corrects the next dictation, and its term reaches Whisper's prompt.
5. **Chrome with Local behind it.** *Reading confirmed and widened 2026-11-18 — detail below, under Step 5. First half, ✨ Fix with Local's transcript, built 2026-11-20 and its gate passed in `local-dictation.mjs` — see As built — step 5, first half; the fallback waits for a stall on record.* Chrome stays the everyday engine; where Local is installed, the page also keeps the take's audio while Chrome dictates. ✨ then sends Whisper's transcript of it too, so the agent reconciles two hypotheses against the document, as plan 14's `alternatives`. And when Chrome's service stops answering, the page switches to Local by itself and transcribes what Chrome missed. Each behind its own ⚙ switch, off by default, so nothing runs on the GPU unasked. *Gate:* the fix event carries both transcripts; with Chrome's service cut off mid-take, the words still land, by Local.
6. ~~**The lab — only if real use leaves the model unclear.**~~ *Dropped 2026-11-11: real use settled the model.* A page that records one take and shows Chrome's text beside turbo and large-v3, each with and without the vocabulary prompt, with the time each took. Chrome's recognizer can take the same recorded audio through `start(track)` (probed 2026-11-04, plan 14), so every engine hears one take. *Gate:* numbers from your own voice decide the default model.
7. *Later:* an opt-in corpus — your takes with their corrected text, kept in the tool home, never synced — and, once it holds hours, a LoRA adapter for your accent, merged and converted to ggml.
8. *Later, once step 4's pairs pile up* (split out 2026-11-18): **measure what is still worth building.** Each correction pair, remembered or not, goes to a local JSONL in the tool home, never synced, with whether the right word was among the recognizer's alternatives, in the document, or in the top three by phonetic or by edit distance. Plan 14's candidates from the document come only if those numbers ask for them. *Gate:* `edit-md` prints the tallies.

## As built — step 0 (2026-11-02)
- **✨ Fix** sits in the popup's button row. It sends a `fix` browser event — one annotation-shaped draft with a fresh `fixId` (`f1`, `f2`…), the span and lines located as usual — and the agent gets a `fix` event whose hint says `push <docId> --fix <fixId>`.
- The agent's text comes back as an inbox `fix` message, plain text as typed, shown under the comment box: *Use* replaces the comment, *Dismiss* drops it; a suggestion for a comment no longer open is ignored. While the agent is busy the row says so.
- **Dictated flag:** `client/mic.js` remembers each phrase the dictation wrote; an annotation, and a fix request, carry `dictated: true` when any of those phrases is still in the text at the moment it is added. Accepting a fix that changes the misheard words clears it, as there is nothing misheard left. Since 2026-11-04 plan 14's tracker replaces the phrase list, and the flag says which words were spoken and which typed.
- Skill: a `fix` row in the event table, and `dictated: true` under *Reading an annotation*.
- Tests: `ReviewDocumentTests` (the flag reaches the agent only when true) and a `roundtrip.mjs` check — a fake recognizer dictates "the secret results", ✨ Fix delivers it marked dictated, `push --fix` offers "the seek results" without touching the comment, *Use* takes it; a comment still holding dictated words arrives marked.

## As built — step 1 (2026-11-09)
- **Server:** `Server/LocalDictation.cs` — the status, `POST /api/dictation/load` to warm a model when dictation starts, and `/api/transcribe`; a load failure or a missing model fails the request with a message, never the server. Whisper's "[BLANK_AUDIO]"-style answers to silence are dropped. Two lines in `ReviewServer.cs` register and map it.
- **Build:** the three packages, and a target in `LalamoMado.csproj` that keeps `runtimes/` beside the exe. In a single-file publish the native libraries were otherwise bundled into the exe, where Whisper.net's loader never finds them (the process crashed); with the target the published build runs on the GPU (0.4 s for the 6.9 s take).
- **Page:** `client/whisper.js` — the 16 kHz AudioWorklet tap from a blob URL, the energy gate (pre-roll 0.3 s, a pause of 0.7 s, 25 s at most), the pieces transcribed in order, and the ⚙ section (engine, model, GPU or CPU). In `mic.js`: the `Chrome` / `Local` badge after CZ/EN, the branch to `startLocally`, and `place()`, which both engines now write through.
- **Tests:** `LocalDictationTests`; `roundtrip.mjs` checks that without Whisper neither the badge nor its ⚙ section shows; `tests/e2e/local-dictation.mjs` plays a synthesized take as Chrome's microphone, switches to Local by the badge, and sees "The SEEK results show every mark in the chapter." at the caret, on the GPU, sent as `dictated: true`.

## Real use — step 1 (2026-11-11)
- Every gate held in the page: the badge and ⚙, text at the caret, an engine switch mid-comment keeping both parts, ✨ Fix on Local text, `dictated: true` on every send. "Better than expected, honestly."
- **Turbo stays the default.** Large-v3 felt slower, and is (0.7 s against 0.4 s for a 7 s take), with more mishearings in its one take ("BQ, large B" for *V3, large-v3*).
- **Czech with English terms, one sentence each:** Local heard every word and spelled the terms by sound ("Xtable" for *XTbl*, "EditMD" for *edit-md*, "Louklo" for *Local*); Chrome lost two of three ("ex table", "Edit and", "the prelu" for *projdou*), with no right word among its alternatives. Spelling is the glossary's job, so **step 3 is next**.
- The 0.7 s pause stays; "a bit late" was not worth a change.

## Fixed 2026-11-11 — typing while dictating doubled the words
Reported in that review: typing a character while the dictation was still finishing wrote the last words twice, after what was typed.
The page re-anchored at the caret on every keystroke and left the words still being recognized in the box; their final version then landed again at the caret.
Local had the same flaw with its "…".
A first fix the same day gave each Chrome result its own place, and in real use it repeated and lost words — "wild and unpredictable", "I'd be much happier with the original duplication" (round 2, served from the repo only; the installed build never had it): Chrome keeps a stable and an unstable interim result, moves words between them, merges them into one final result, and keeps one result running across pauses (recorded on synthesized takes, English and Czech). A result index is no unit of words.
Now `mic.js` writes into a *region* — final words, then the words still being recognized — as before the fix; typing while a region still has words being recognized leaves it where it stands and opens the live region at the caret. For Chrome the typing also ends the run (`stop()`), so Chrome returns a final result for what it heard so far, which settles in the old region; the run restarts into the live one. For Local each piece writes into the region that was live when it was cut.
Words the reviewer typed into are theirs, and their later version is dropped. Known cost: speech during Chrome's restart, a fraction of a second, may be lost; a typed character is usually a pause anyway.
Gates in `roundtrip.mjs`: a replay of Chrome's split-and-merge pattern lands each word once; interim "the seek", `/` typed, the run ended, final "the seek results", the next run's " and on" → `the seek results/ and on`; typing "peak" over "seek" → `the peak and on`.
**Real use 2026-11-11 (round 3):** plain dictation is back to how it was ("I think it does" work the way it used to); slashes typed mid-sentence land where typed with the next words after them ("behaves nicely", "kind of fluent"); words typed in the middle stay typed. Open: whether one "the secret result the secret result/" was said twice or repeated by itself, and Local's "…" with typing, not tried.
**Real use 2026-11-16 (round 4, the installed build):** Chrome with a `/` typed while settling — the phrase once, then the `/`, "perfectly as intended"; Local with typing while "…" showed — the sentence replaced the "…" before the typed text, nothing stray ("seems to be working okay"). Found there: Local heard the keys and wrote "*click*"; the server now drops a segment that is only a sound note in asterisks too, as it did for "[BLANK_AUDIO]" and "(music)" (`LocalDictation.IsNonSpeech`, `LocalDictationTests`).

## Step 3 — the glossary (decided 2026-11-16)
What real use asks of it (2026-11-11): Local hears the terms and spells them by sound — "Xtable", "EditMD", "Louklo" — so a prompt that shows the spelling should fix most of it; Chrome loses them ("ex table", "Edit and"), so for Chrome only the mishearing map helps, and only where the wrong words are not everyday ones ("jsi" for *seek* stays out of reach).

**The file** — `glossary.json`, layered like `comment_labels.json`: user `~/.claude/edit-md/`, then repo `<git root>/.claude/edit-md/` (the document's git root, as for labels and skills). Nothing shipped.
```json
{
  "terms": ["XTbl", "IRows", "edit-md", "seek", "mark"],
  "mishearings": { "Xtable": "XTbl", "ex table": "XTbl", "EditMD": "edit-md", "secret results": "seek results" }
}
```
- `terms` are unioned across the layers, the repo's first; `mishearings` merge by key, the repo winning. `"replace": true` drops the layers below, as for labels.
- A mishearing key may be several words, which is what makes an everyday word safe: `"secret results"`, never `"secret"` alone. Matching ignores case and stops at word edges.
- A bad file lists a problem in the page's ⚙ and in `edit-md glossary`, as a bad label list does, and never fails a review.

**Server** — `Server/Glossary.cs`, mirroring `CommentLabels.cs`:
- `GET /api/docs/{docId}/glossary` → `{ terms, mishearings, problems }`; `edit-md glossary <docId>` prints the same.
- `POST /api/transcribe` takes `docId` too; the terms become Whisper's prompt (`WithPrompt`, one line in `LocalDictation`): `"Glossary: XTbl, IRows, edit-md, seek, mark."`, cut to stay under 224 tokens, the repo's terms kept first.
- A `fix` event, and a `send` or `submit` event with a dictated annotation, carry `glossary` — the merged lists, as the endpoint returns them — when there is any, so the agent reads dictated words against it without another call.

**Page** — `mic.js` applies the mishearings to both engines' words before they land, final and interim alike, so a word does not flip when it settles. A corrected phrase stays spoken, and the original goes in as one of the recognizer's other guesses: the agent's `maybe` then reads `"XTbl": ["ex table"]`.

**Skill** — one line: a `fix`, `send` or `submit` event's `glossary` lists the reviewer's terms and known mishearings; read dictated words against them.

**Seed files**, written when built, from 2026-11-11's real use: this repo's with edit-md's own words (`edit-md`, `seek`, `mark`, `Send now`, `Local`, `Chrome`; `"EditMD" → "edit-md"`, `"Louklo" → "Local"`, `"secret results" → "seek results"`); yours with `XTbl`, `IRows` (`"Xtable"` and `"ex table"` → `XTbl`).

**Gates:**
- `GlossaryTests`: layering, `replace`, multi-word keys, word edges, the prompt's cut.
- `roundtrip.mjs`: the fake recognizer says "the ex table works" → `the XTbl works`, sent with `maybe` `{"XTbl": ["ex table"]}`; a `fix` event and a `send` with a dictated annotation carry the glossary, a `send` with typed text only does not.
- `local-dictation.mjs`: a synthesized Czech take with *XTbl* comes out wrong without the glossary and right with it — the step's gate.

## Decided in review (2026-11-16)
All five recommendations stand; the third grew by one event.
1. **Nothing shipped**; edit-md's own words go in this repo's file: they matter only when edit-md itself is reviewed.
2. **Mishearings apply to interim words too**, so "Xtable" never shows and then flips to *XTbl* when it settles.
3. **The glossary travels inline**, only when non-empty — in `fix` events, and also in `send` and `submit` events with a dictated annotation, which the agent reads against the terms as well (`submit` approved after the build). It is small and present exactly when needed; fetching it would cost a tool round trip while the reviewer waits.
4. **No per-review layer** now: step 4 writes to the files, and a session list would be lost.
5. **The document's own rare words stay out of Whisper's prompt** now: long prompts can make Whisper invent words; step 4's numbers decide.

## As built — step 3 (2026-11-16)
- **Server:** `Server/Glossary.cs`; `GET /api/docs/{docId}/glossary` and `edit-md glossary <docId>` also return the `prompt`, so you can see what Whisper gets. The prompt stays under 224 bytes: a token is at least a byte, so it always fits Whisper's window whole — some 25 short terms. `/api/transcribe` takes `docId`, and `LocalDictation` passes the prompt on (`WithPrompt`).
- **Events:** `glossary` — the lists only, and only when non-empty — on every `fix`, and on a `send` or `submit` with a dictated annotation.
- **Page:** `client/glossary.js`, re-read as each dictation starts, so an edited file counts from the next one. Matching takes whole words, any case, any spaces between a key's words. `mic.js` corrects Chrome's final results one by one, its interim words joined, and each Local piece; the original goes to `heard()` as one more guess. ⚙ says "Glossary: 9 terms, 5 known mishearings." and lists any problem with the files.
- **Known limit:** a mishearing split between two of Chrome's final results, or between words already settled and the next ones, is not caught.
- **Skill:** the `glossary` line in *On each wake*, the `fix` row, and `edit-md glossary` under *Housekeeping*.
- **Seed files:** this repo's `.claude/edit-md/glossary.json` and `~/.claude/edit-md/glossary.json`, as listed above.
- **Tests:** `GlossaryTests` — layering, `replace`, the prompt's cut, broken files; multi-word keys and word edges are the page's, so `roundtrip.mjs` checks them, with interim and final corrections, `maybe`, and the glossary on a fix and a dictated send but not on a typed one. `local-dictation.mjs` holds the gate: a Czech voice saying "eks tejbl" comes out "Rex Table" without the glossary and "XTbl" with it, on the GPU; and the page corrects Local's own words, sending the original as `maybe`.

## Step 4 — learning from corrections (decided 2026-11-18)
**When it offers.** Spoken words — as plan 14's tracker marks them — replaced by typing before the comment is added, or changed by an accepted ✨ Fix.
The pair is the smallest span of spoken words that changed → what replaced it.

**The offer.** A row under the comment box, like ✨ Fix's suggestion: *Remember "ex table" → XTbl: [This repo] [Me] [×]*, one row per pair.
It shows only while the comment is open and is never in the way of Ctrl+Enter; adding the comment drops what was not taken.
A document outside a git repository offers *Me* only.

**The key** is offered as heard and is editable in the row: whether a one-word key is safe is the reviewer's call — "Xtable" is, "secret" is not.
The meant side is editable too, found when built: widening "secret" to "secret results" must widen "seek" to "seek results" as well.

**Remembering** writes the pair into the chosen `glossary.json`, and the meant word into its `terms` when no layer has it yet, so Whisper's prompt learns the spelling and not only the page's correction.
Of a meant phrase, only the words the recognizer did not hear join (found when built): "secret results" → "seek results" adds `seek`, not "seek results".
The server writes the file: it re-serializes it, keeping the order of terms and keys and losing hand formatting — accepted for the repo's tracked file too.
The page re-reads the glossary as the next dictation starts, as today.

**Measurements** are step 8, later.

## As built — step 4 (2026-11-18)
- **Finding the pairs:** `client/spoken.js` keeps the box as the dictation last left it; a word-by-word diff along the longest common sequence against it gives the smallest runs of spoken words replaced. Insertions, deletions, runs of more than four words, case-only changes and punctuation at a phrase's edges (`.`, `,`, `/`, quotes — never `#` or a leading dot, so `C#` and `.NET` survive) are not corrections. Corrections made before the dictation writes again are kept while their words are still in the box. An accepted ✨ Fix is diffed against the box's spoken words before it replaces them.
- **The offer:** `client/remember.js`, rows under the comment box 0.8 s after typing settles, at once after ✨ Use. Pairs the glossary already holds, and ones remembered or dropped with × in this comment, are not offered again. Enter in a row's field does nothing; Ctrl+Enter still adds the comment. *This repo* shows only when the document is in a git repository (`repoFile` in the glossary answer).
- **Server:** `POST /api/docs/{docId}/glossary` `{heard, meant, layer}` → the glossary as it now stands; `Glossary.Remember` creates the file and its folder, replaces a known key in place whatever its case, and refuses a file that does not read rather than overwrite it. The file is written indented, LF, UTF-8, `replace` kept and never written when false.
- **⚙ switch** (asked 2026-11-18): *Offer to remember dictated words you correct*, on by default, kept for this PC; off, no row shows.
- **Scope:** the comment popup only; the thread panel's follow-up box does not offer yet.
- **Skill:** the `edit-md glossary` line says the page adds to the files.
- **Tests:** `GlossaryTests` — the written file, terms from unheard words only, a known key replaced in place, no repo layer outside a repository, a broken file left alone, incomplete corrections refused. `roundtrip.mjs` — "ex table" typed over is offered, nothing written until *Me*, then the next dictation comes out "the XTbl works" (the gate); a widened pair for *This repo*; typed words corrected give no offer; an accepted fix offers "market → mark", and × writes nothing; with the ⚙ switch off nothing is offered.

## Step 5 — Chrome with Local behind it (decided 2026-11-18)
**Real use (2026-11-18):** Chrome stays the everyday engine — somewhat faster, about as accurate; Local is the backup, as Chrome's service sometimes stops answering.

**Both gated in ⚙, off by default** (review 2026-11-18: "we don't burn the GPU"): *Fix with Local's transcript too* and *Switch to Local when Chrome stops answering*.
With both off, Chrome dictates exactly as today: no tap, no Whisper work, nothing loaded on the GPU.

**The take.** With either switch on and Local installed, the page taps the microphone for Whisper while Chrome dictates — the AudioWorklet of `whisper.js`, cut at pauses as today — and keeps the pieces of the comment being written, not sent anywhere until needed.

**✨ Fix with both.** With its switch on, ✨ transcribes the kept pieces with Local — only then, on the press — and sends that text beside the comment's own, as `alternatives`; the agent reconciles the two against the document.

**Falling back by itself** — to be explored first:
- What Chrome's service does when it stops answering, recorded the way 2026-11-11 recorded its interim results: an `error` event (`network`, `service-not-allowed`), or no result at all while the energy gate hears speech.
- On such a stall the page switches the box to Local, transcribes the pieces since Chrome's last final result, and goes on with Local; the badge shows `Local` and a status message says why.
- Behind its ⚙ switch, *Switch to Local when Chrome stops answering*.

**Getting a stall on record** (decided 2026-11-19): both — staged once, you dictating while the network is cut, to build against; and logged in real use, the page writing Chrome's errors and silent stretches while the gate hears speech to a local file, for the stall you actually meet.

**After a fallback** (decided 2026-11-19): the next dictation tries Chrome again, the badge keeping your choice — a ⚙ setting, *After a fallback, stay on Local*, off by default.

**Open:** how long a silent stall counts — settled once a stall is on record.

## As built — step 5, first half (2026-11-20)
- **⚙ switch:** *Fix with Local's transcript too: while Chrome dictates, keep the sound for ✨* (`dictation.fixWithLocal`), off by default, kept for this PC, in the Dictation section that shows only where Local is installed.
- **The take:** `whisper.js` now splits recording from transcribing: `recordPieces` cuts at pauses as before, `listenLocally` transcribes each piece, and `keepTake` only keeps them. `mic.js` starts the tap with Chrome's dictation when the switch is on, stops it with the dictation, and starts a fresh take whenever a box opens.
- **✨ Fix:** with sound kept, the row says *Local is transcribing what you said…*; `transcribeTake` sends the pieces to `/api/transcribe` with the glossary's prompt, each piece once however often ✨ is pressed, and the page corrects known mishearings in the result. If Local fails, a status message says why and the fix goes with Chrome's text alone.
- **On the wire, two ways:** the whole transcript as the annotation's `localTranscript`, and the same text as one more of the recognizer's guesses at the whole comment, so `SpokenWords` turns the words where the two differ into `maybe`, as plan 14 meant (`alternatives`).
- **Skill:** a `localTranscript` line under *Reading an annotation*.
- **Tests:** `ReviewDocumentTests` — the transcript reaches the agent whole, and of a partly typed comment only the spoken word that differs becomes `maybe`. `local-dictation.mjs` holds the gate: with the switch off, Chrome (faked) dictates without the page opening the microphone and ✨ sends no transcript; with it on, the page records the take while Chrome writes "the secret results…", and the fix carries Local's "The SEEK results show each mark in the chapter." and `maybe` `{"secret": ["SEEK"]}`, on the GPU.

**Deviations:**
- *Both, not only `alternatives`.* The plan sent Local's text as `alternatives`, which the server reduces to `maybe`. That drops a phrase only Local caught, and Chrome drops words (real use 2026-11-11), so the whole transcript travels too.
- *A take per opening of the box.* Re-opening a draft, or widening a block pick, starts an empty take, so Local's transcript then covers only what was said since. Keeping the sound with each draft would need storage, for a rare case.
- *The reply box keeps a take too*, though ✨ is only in the comment popup: the fallback half needs it there, and it costs only memory, about 64 KB a second of speech.
- *No model warm-up when the tap starts.* The model loads on the first ✨, about a second, so nothing touches the GPU until you ask.

**Lessons:**
- Chrome's fake microphone (`--use-file-for-fake-audio-capture`) plays the file from its start for every new stream, so one take serves several checks in one run.
- With *seek* in the glossary's prompt, Whisper writes it "SEEK"; compare it ignoring case.

## Installed on this PC (2026-11-09)
Proven by a scratch console app, before any product code: nothing in the repo yet.
- **Packages:** `Whisper.net`, `Whisper.net.Runtime` (CPU) and `Whisper.net.Runtime.Cuda12.Windows`, all 1.9.1. The unversioned `Whisper.net.Runtime.Cuda` is built for CUDA 13 (`cublas64_13.dll`), which this driver cannot run. The Cuda12 runtime lands in `runtimes/cuda12/win-x64/`; its `ggml-cuda-whisper.dll` alone is 564 MB, so every build and install grows by that much.
- **CUDA DLLs:** the runtime needs `cudart64_12.dll` as well as `cublas64_12.dll` and `cublasLt64_12.dll` — not cuBLAS alone. Taken from NVIDIA's 12.9 redistributable archives (`cuda_cudart` 12.9.79, `libcublas` 12.9.1.4, SHA-256 checked) into `~/.claude/bin/edit-md/whisper/cuda12/`, 770 MB. Found when that folder is on the process `PATH`; when it is not, the loader falls back to CPU without a word, so the server must say which runtime it got.
- **Models:** `ggml-large-v3-turbo-q8_0.bin` and `ggml-large-v3-q5_0.bin` in `~/.claude/bin/edit-md/whisper/models/`, SHA-256 checked against Hugging Face.
- **First numbers** (a 6.9 s synthesized English take, warm): turbo 0.4 s on the GPU, 12.2 s on the CPU; large-v3 0.7 s on the GPU. Both got every word, "seek" included. Load takes about a second.
- **Chrome in real use the same day:** in Czech, *seek* became "jsi" with no alternative near it. A mishearing map cannot fix that safely, since "jsi" is an everyday Czech word; Whisper, given the term in its prompt, has a chance. That is why the switch comes before the vocabulary.

## Decided in review (2026-11-09)
- The switch comes first, turbo by default with large-v3 in ⚙; the lab only if real use leaves the choice unclear.
- **The switch** is a `Chrome` / `Local` badge beside CZ/EN, cycled by a click, plus ⚙.
- **Local dictation is optional and research.** The agent offers it during onboarding and installs it only on a yes (step 2), and the feature must stay **removable cleanly**. Everything of it lives in its own files: `Server/LocalDictation.cs` with one line mapping its endpoints, `client/whisper.js` with the badge, the `whisper/` folder in the tool home, and a few hook lines in `mic.js`. Cutting it means deleting those and the three package references.
- **The 564 MB CUDA runtime stays in the build for now**; the user is told that without a proper GPU it is slow — in the onboarding question, and in ⚙, which says when Local runs on the CPU.

## Decided in review (2026-11-19)
1. **Step 4's offers stay on by default**, for you and for colleagues; ⚙ turns them off.
2. **Steps 3 and 4 close in real use:** the agent asks after your next few dictated reviews. First real use, 2026-11-19: `pain → pane`, remembered from a correction during a review, reached the next events' glossary.
3. **Step 5's stall goes on record both ways**, and **after a fallback Chrome is tried again** — see Step 5.
4. **Offers in the thread panel's reply box** too, under the same ⚙ switch — built 2026-11-19, since follow-ups are dictated in real use.
5. **The microphone follows the focus** between the comment popup and the reply box: while dictating, the box you move into listens; with ⚙ *Dictate as soon as a comment opens*, any way of opening a chat listens in its reply box — built 2026-11-19, from review: the panel opened by ⤢ stayed silent and collided with the popup. Passed in the showcase of 2026-11-20.

## Decided in review (2026-11-18)
1. **Step 4's offer** is a row under the comment box, while the comment is open, never in the way of Ctrl+Enter.
2. **A one-word key** is offered editable; you judge whether it is safe.
3. **The meant word joins `terms`**, so Whisper's prompt learns the spelling.
4. **The server rewrites the tracked file**, losing hand formatting.
5. **The measurements are a later step** (now 8): they mean something only with volume.
6. **Step 3 committed** on its own (`04013fa`), before step 4.
7. **Step 5 stays, widened:** Chrome is the everyday engine, so Local's transcript of the same take is a real second hypothesis; and Local takes over by itself when Chrome stops answering — "let's also explore" that. Both behind ⚙ switches, off by default: "we don't burn the GPU".

## Decided in review (2026-11-02, approved with one note)
All seven recommendations below stand. The note adds one thing to step 0:
- **Dictated text is marked.** When words the dictation put in are still in the comment when it is added — not merely the mic having been on — the annotation carries `dictated: true`. The agent reads that as a cue to spend the extra tokens: interpret misheard words against the document, the conversation and the glossary before acting. The ✨ *Fix* request carries the same flag.

## Open — answered (kept for the record)
1. Default model: large-v3-turbo q8_0 (874 MB, fast), with large-v3 q5_0 on trial in the lab? → yes; the lab's numbers settle it.
2. The GPU libraries: install the CUDA 12 toolkit once on this PC, or have the installer fetch only NVIDIA's cuBLAS 12 runtime DLLs into the tool home? → the DLLs into the tool home: no system-wide install, and colleagues without a GPU simply get the CPU runtime.
3. Utterances travel as plain POSTs cut at pauses, keeping the project's no-websocket line — or a WebSocket stream for lower latency? → POSTs per pause; revisit only if the lab shows the delay hurts.
4. Glossary as JSON beside `comment_labels.json` — or a Markdown `glossary.md`, shared with the chat-prompt idea in `.claude/ideas/dictation-term-accuracy.md`? → JSON beside the labels; that idea can read the same file later.
5. ✨ *Fix* costs tokens per press — on demand only, or also offered automatically when Local and Chrome disagree? → on demand only.
6. Step 0 first, before any Whisper work? → yes: it helps today, with Chrome.
7. Keeping takes for a future accent fine-tune — opt-in under ⚙, off by default? → yes.

## Not in scope
- Claude Code's own dictation (not reachable, see the facts).
- Cloud speech services with keys (Azure, Deepgram): the point is local, and Chrome stays as the no-setup engine.
