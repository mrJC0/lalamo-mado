---
feature: read-aloud
status: parked
created: 2026-10-19
---
# 04 Read-aloud — listen to a chapter with a moving caret

## Goal

Read an existing `.md` aloud inside LaLaMo-Mado: pick a heading, press ▶, and the chapter is spoken while a caret-style highlight tracks the current word.
It is the operator-facing counterpart to dictation (plan 03) — voice **out** of the document where 03 is voice **in** to the comment field.
English texts assumed; domain-term mispronunciation is accepted as best-effort only (see Pronunciation).

## Mechanism

A pure **client-side** feature of LaLaMo-Mado, same shape as the mic feature (plan 03) — no server change.

- **Web Speech API `speechSynthesis`** speaks the text, and its **`boundary` events** carry a `charIndex` into the spoken string — giving word-level timing for the highlight **for free**, with no forced alignment and no audio file.
- Same secure-context / Chrome story as plan 03: `http://localhost` is a trustworthy context, and the dedicated Chrome profile persists the installed voice list and any permission state.

## UI / behaviour

| Capability | Mechanism |
|---|---|
| MD → audio | `speechSynthesis.speak(utterance)` over the selected chapter's text |
| Caret follows read | tokenize the chapter into `<span data-i>`; on each `boundary`, map `charIndex` → span, toggle a highlight class + `scrollIntoView` |
| Chapter + one button | parse the rendered `<h1..h3>`; a chapter = heading → next same-or-higher heading; a ▶ button per heading |
| Scrub / pick moments | click any word or paragraph → restart the utterance sliced from that offset (the API has no seek); play/pause (`pause`/`resume`), stop (`cancel`), `rate`, voice picker |

## Pronunciation (best-effort, secondary)

Optional pre-speak, word-boundaried substitution using an optional `token → spoken-form` glossary — e.g. `XTbl → "ex table"`.
Accepted as a mitigation, not a solve: Web Speech has weak SSML support, so plain substitution is the realistic lever.
No glossary of its own (review 2026-11-18): it reads plan 09's `glossary.json` backwards — a mishearing `"ex table" → "XTbl"` is how XTbl is spoken.

## Open risk to settle at build time

`boundary`-event granularity varies by voice: local Windows neural voices fire word boundaries reliably, while some remote voices do not fire them at all (which kills the highlight).
The feature must prefer a boundary-emitting voice and degrade to sentence-level highlighting otherwise.

## Baselines / escalation

- **Zero-build sanity check:** open the rendered MD in **Edge → Read Aloud** to judge Web-Speech voice quality before investing.
- **Escalation if voices disappoint:** cloud neural with purpose-built timing — **Amazon Polly Speech Marks** or **ElevenLabs timestamps** return an audio file plus exact word offsets, syncing the highlight off the timing JSON against an `<audio>` element. Cost: an API key, network, and more wiring.

## What we build

- A read-aloud client component of LaLaMo-Mado: heading ▶ buttons, a word-span tokenizer over the rendered chapter, `boundary` → highlight + `scrollIntoView`, transport (play/pause/stop/rate), click-to-start-here.

## Tasks

- [ ] Read-aloud component: heading ▶ buttons, word-span tokenizer, `boundary` → highlight + `scrollIntoView`, transport, click-to-start-here
- [ ] Voice selection: prefer a boundary-emitting voice; sentence-level fallback when none
- [ ] Optional glossary pre-speak substitution
- [ ] Verify in the dedicated Chrome profile; self-hide where `speechSynthesis` or voices are absent
- [ ] Add to setup docs (verify step)

## Decisions / notes

**Parked in review (2026-11-18):** not much use foreseen; if it is built, the pronunciation glossary is 09's read backwards.

**Resolved in conversation:**
- **Web Speech API for v1** — boundary-event karaoke, zero infra; escalate to cloud TTS only if the voices aren't good enough.
- **Mispronunciation is explicitly secondary** — glossary substitution is best-effort, not a solve.

**Still open:**
- Which boundary-emitting voice to prefer on this machine (empirical).
- Chapter granularity (per heading level) and whether a chapter read includes its nested subsections.
- The word tokenizer's `<span data-i>` breaks 01b's no-wrappers rule; at build, the caret should be a Custom Highlight range (noted 2026-11-04).
- Click-a-word-to-start collides with select-and-comment; at build, it needs a modifier or a ▶ of its own (noted 2026-11-04).
