---
feature: block-document-orchestration
status: idea
created: 2026-10-19
---
# 06 Dynamic block-document & multi-session orchestration (speculative)

> **Status: parked brainstorm.** Captured at your request from a greenfield-spec annotation; explicitly **not** current scope. Near-term work is the build-raw annotator ([01_lalamo-mado.md](../project-plans/01_lalamo-mado.md)). This file exists so the "taken further" idea isn't lost.

## The seed idea
Taken further, the same **browser + server + Markdown + interactivity** could facilitate a different *workflow*: a **browser-IDE-like** surface orchestrating **several AI sessions** at once over a shared, live document.

## Core shift — document as rewritable blocks, not a static render
- The thing under review stops being a 1:1 HTML render of a static `.md` and becomes a set of **tagged text blocks** that can be **rewritten in place** — by an AI when prompted.
- Edits land **per-part**: no whole-document reload phase.
- Each AI edit is **logged and diffed as it comes**, so the diff / change-gutter capability survives — arguably improves, since it becomes a live edit log rather than a per-open snapshot.

## Multi-session orchestration
- The server is the shared substrate: it can **list the full current state** of the dynamic document, with sections **tagged**, **targetable, and readable in part**.
- Several AI sessions exchange through the server; each can **refresh itself on the current document state** at any time.
- Coordination is cooperative — the **user takes care not to parallelize edits over the same section** (no hard locking proposed yet).

## Even single-session value
- A per-part-mutable document is interesting on its own: it removes the reload cycle and keeps a natural running diff, with no multi-session needed.

## Known shortfalls / open questions
- **Loss of obvious tooling** — `grep` and friends don't apply cleanly to a block-store the way they do to files; the AI's normal file-search affordances would need an equivalent over the block model.
- Concurrency / consistency across sessions editing one doc (cooperative-only today).
- How blocks map to/from an on-disk `.md` — is there still a file of record?
- Relationship to the build-raw annotator — an evolution of it, or a distinct product?

## Why parked
This is a materially bigger system than a review annotator. Noted now so the idea survives; revisit only after the build-raw annotator and its live-conversation layer (greenfield section H) exist and have taught us what the block / live-edit model should actually be.
