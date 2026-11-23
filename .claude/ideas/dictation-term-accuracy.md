---
feature: dictation-term-accuracy
status: draft
created: 2026-10-19
---
# 05 Dictation term accuracy — domain terms survive voice prompts to Claude Code

## Goal

Make dictated **prompts to Claude Code** (the claude.ai app mic and the VS Code extension mic) resolve mangled domain identifiers — `XTbl`, `IRows`, `XSql` — back to canonical form instead of collapsing to common words ("ex table", "eye rows").
Distinct from plan 03, which dictates into md-annotator's comment field; this targets the Claude Code **prompt** itself.

## Verified constraints (do not re-derive)

- Claude Code dictation is a **separate ASR stage**; the claude.ai app mic and the VS Code extension mic use the **same pipeline**, and the model/harness only ever receives text.
- The recognizer biases on **coding-vocabulary + project name + git branch name** only — **not** conversation history; a term appearing earlier in the chat does not improve its own recognition.
- There is **no custom-vocabulary / phrase-hint / initial-prompt knob** for the native feature (`voice` config = `enabled`, `mode`, `autoSubmit`, `language`).
- **Hooks cannot detect voice provenance** — no payload field marks a prompt as dictated vs typed, so any filter is provenance-blind.
- **`UserPromptSubmit` cannot replace the prompt** — it can only inject `additionalContext` alongside it (for this event, the hook's stdout is fed to the model as context). In-place rewrite is offered only at the tool boundary (`PreToolUse`/`PostToolUse`), which never touches the user prompt.

## Shared component — per-repo glossary (build first)

One repo-local file (e.g. `.claude/glossary.md`) carrying each domain term in **both directions**:

- `mishearing → canonical` — e.g. `"ex table" → XTbl` (feeds the repair below).
- `token → spoken-form` — e.g. `XTbl → "ex table"` (feeds read-aloud pronunciation, plan 04; could also help plan 03's in-browser dictation).

Generic consumer code, **repo-local data**: the harness auto-discovers the glossary in `cwd`, so each repo carries its own term set.
This is the common dependency under plans 03/04/05, so it lands first.

## Design

- **Shape 1 (cheap, always-on):** a `UserPromptSubmit` hook reads the repo glossary and injects it as `additionalContext` with an instruction to interpret the message against it. It is a no-op on correctly-typed text, so running it provenance-blind is harmless.
- **Shape 2 (optional, costs tokens):** the hook calls **Haiku** with the glossary to produce a corrected rewrite and injects that ("corrected intent: …") as context. Stronger because it hands the model a finished correction — but advisory, not enforced, and it needs its own Claude API key (separate from the subscription that powers dictation).
- **Opt-in variant:** package Shape 2 as a **skill** fired after dictating, so typed messages pay nothing.

## Tasks

- [ ] Define the glossary file format + location, both directions (`.claude/glossary.md` or repo-local convention)
- [ ] (deferred) generate a repo's glossary from its symbol set
- [ ] Shape 1: `UserPromptSubmit` hook that discovers the `cwd` glossary and injects it as `additionalContext`
- [ ] Wire the hook in user `settings.json`
- [ ] (optional) Shape 2: hook calls Haiku for a corrected rewrite, injected as context; API-key handling
- [ ] (optional) skill wrapper for opt-in use after dictating

## Decisions / notes

**Resolved in conversation:**
- Native dictation exposes no vocabulary knob and the recognizer ignores chat history, so correction must happen **downstream** in the harness, not at the ASR.
- A hook cannot rewrite the prompt in place; the realistic lever is **context injection** (Shape 1), optionally strengthened by a **Haiku correction pass** (Shape 2) — both advisory.
- The glossary is **shared** with plans 03/04 and is built first.

**Still open:**
- Exact glossary format (tables vs lists; how pronunciation hints are expressed).
- Whether always-on Shape 1 or opt-in skill is the default day-to-day mode.
- Whether to spend a Haiku call per prompt (Shape 2) or rely on Shape 1 context alone.
