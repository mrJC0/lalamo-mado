# Parked idea — multi-session dynamic-document hub

Parked 2026-10-20. Cut from the active plan to keep LaLaMo-Mado single-session and lean. This is the resurrectable record of the grand vision, not a commitment.

## The vision

LaLaMo-Mado as a **permanent, indispensable hub** for working with AI — the real channel of communication, replacing the chat window — where **block-based dynamic documents** are rewritten in place and **shared live across several concurrent AI sessions** at once (one doc being iterated, another awaiting an explanation, a third approved).

## What it implied architecturally

Cross-session sharing is the forcing function. A document live in *many* sessions at once cannot be a per-session server (one spawned per session, dying with it — N sessions means N servers, N ports, N browsers). It demands:

- **One permanent local HTTP daemon** as the hub — every Claude Code session and every browser tab connects to the same resident process holding all docs.
- Claude Code reaches it through a **thin, swappable edge**: a Bash CLI / HTTP client over the daemon. The integration transport becomes a pluggable detail over a permanent core.
- Server-owned diff/change-gutter, push-wake (a browser event wakes an idle session), live reply-push, and `doc_id`-routed multi-doc state — the full H feature suite from the greenfield spec, plus the block-document orchestration (greenfield plan 06).

## Why parked

The permanent daemon introduces a **lifecycle owner** problem that the ephemeral shapes dodge entirely: who starts it, keeps it warm, restarts on crash, and — on an install-afresh third-party PC driven by a setup skill — installs it as a Windows service / tray app / launch-and-keep-warm process. That plus cross-session doc-state coordination is materially bigger than current needs justify. A per-session tool delivers the token-efficiency value prop without any of it.

## Resurrection trigger

Revisit if single-session proves limiting in practice — specifically if a genuine need emerges to have the **same live document shared across multiple concurrent AI sessions**, or for block-level dynamic rewrite-in-place. Until then, per-session is the shape.

## Downstream effect on the active plan

With this parked, the transport decision collapses to a per-session shape. The active plan still adopts a **resident local server driven over Bash** (woken via Monitor) as its basis, and keeps a **single-thread, single-session live reply** (AI reply rendered in-page). What this parked idea removes is only the *cross-session* dimension: no permanent daemon, no one-server-for-all-sessions, no doc shared live across concurrent sessions, no block-level dynamic rewrite.
