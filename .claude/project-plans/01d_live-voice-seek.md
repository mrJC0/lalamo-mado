---
feature: lalamo-mado
phase: D
status: active
created: 2026-10-20
---
# 01d — Live reply, conversation side-channel, seek, voice

> Detail for roadmap [01_lalamo-mado.md](01_lalamo-mado.md) · phase **D** of A–D. The "late" features; build last, on the spine from A–C (resident server + Bash). Feature intent: plans 02 (side-channel), 03 (mic), 04 (read-aloud).

## Goal
The interactive layer: the agent pushes replies in place, the reviewer sends individual annotations mid-read, arbitrary natural-language **seek** highlights lines, and voice goes both in and out.

## Steps & gates
1. ✅ **Live reply (single thread)** — pulled forward into the demo: `edit-md push --to aN` threads a markdown reply under the annotation; `--quote` highlights an agent-chosen span. `edit-md push` renders a markdown reply bound to a span/annotation, in place. *Gate:* a reply docks to its span without a reload.
2. ✅ **Conversation side-channel (plan 02)** — validated 2026-11-09; plan 02 is retired, carried notes in the roadmap (01). Landed: "Send now" = one query, mode `reply` (the server forces `silent` for any group); "Send drafts (N)" = all drafts as one silent group; no double-send into Submit. Reply threads — Reply on agent replies, the ⤢ panel as the thread's chat, follow-ups, the replies-only filter (plan 02) — built 2026-11-04, approved in real use. Per-annotation send-silent / send-with-reply; right pane; replies bound; interactively-sent annotations excluded from the final batch. *Gate:* send-with-reply shows a bound reply; the final Submit omits already-sent annotations.
3. ◐ **AI-assisted seek (01 Later).** A query → the agent returns lines to highlight; several seeks coexist; each is a selectable set row in the left pane, of clickable findings; no separate Seek tab (decided 2026-11-04). *Gate:* two seeks show as two set rows, each navigable — passed: since 2026-11-02 the agent answers a seek with a set of marks (`edit-md mark --set "seek: …"`, 01c step 5), and two sets coexisted in lorem round 10. Asking from the page, decided 2026-11-19: a shipped 🔍 *Seek* label, its description telling the agent to answer with a mark set; and a large 🔍 *Seek* button in the left pane above the set rows, which opens a general comment with *Seek* preselected, so the reviewer starts describing what they want to see and expects the answer where the button is. Not waiting for plan 11.
4. ✅ **Voice in — mic (plan 03).** *Gate:* dictated text streams into the comment field. Fast-tracked ahead of the rest of D; built and validated with a real microphone 2026-11-02 (lorem round 9). Plan 03 is retired; carried notes in the roadmap (01).
5. **Voice out — read-aloud (plan 04).** *Gate:* a chapter reads with a word-tracking caret.

## The event loop (harness-driven)
The resident server (01a) queues browser events per doc; the agent is woken by a **backgrounded `edit-md wait`**, never pinned in a blocking call:

```
edit-md serve                          resident server, run_in_background (01a)
loop:
  edit-md wait <docId>   (bg)          long-polls; exits on the next event → notification
    event {kind:"send"|"seek"|"submit"}
      agent reacts →
        edit-md push <docId> {reply|seekResult}   renders in place
  re-launch wait                       (events queue server-side, so none is lost)
```
This is the pivot's whole point: **the chat is never blocked** — the background `wait` wakes the agent on an event without occupying the turn, so driving the AI via chat while a doc is under review is free. `submit` is just the terminal event.

Rendering the reply/seek result **in the page** live needs a server→**browser** push — a **client-side** channel first introduced in C (the decisions sidecar, 01c) and reused here. It is a browser-side **long-poll** (the same long-poll shape as the agent event queue, consumed by JS in the page), **no websocket** — consistent with the pivot. It is not part of the agent sync and has no bearing on the Bash loop above.

## Targeting channel — make the AI's aim easy
Pushed results (replies, seek hits) bind to phase-B anchors, which re-resolve across re-render like annotations — the natural, viable start. But seek especially wants **fine-grained, easy targeting**: the agent should aim at spans with confidence, which means knowing the document's addressing scheme well. Proposal — a **document map** the agent can fetch: the server's block model (01b) exposed as a stable, AI-facing index — `{blockId, headingPath, sourceLineRange, charRange, textPreview}` per block — so the agent targets by `{blockId, charRange}` (precise) or by text-quote (robust), and the server resolves either to highlights. The agent reasons over a compact map instead of guessing offsets, and sub-block char ranges become addressable. Prototype the map shape against real seek queries. This compact, on-demand map (and the agent's own fresh disk reads for seek) is the intended exception to 01's "never re-emit content": that rule bars pointlessly re-shuffling the same content across the boundary, not deliberate on-demand lookups.

## Voice (client-only, Web Speech) — from 03/04
- **In:** `webkitSpeechRecognition` → caret insert into the comment field; Ctrl+D toggle; cs-CZ/en-US. Self-hides if absent.
- **Out:** `speechSynthesis` + `boundary` events → word-span caret; prefer a boundary-emitting voice, degrade to sentence-level.
Both need the dedicated Chrome profile (01c); both self-hide on unsupported browsers.

## Resolved in review (01d)
1. **Harness-driven event loop** (resident server + backgrounded `wait` + a server-side event queue); nothing to register or keep alive, no websocket in the agent sync. The chat-blocking tension is **resolved by the pivot** — the background `wait` wakes the agent without occupying the turn.
2. **Single interaction model** — server-emits-events + agent-pushes; the original md-annotator has no bearing.
3. **Voice privacy accepted** — audio out (Web Speech → Google) is fine for v1.
4. **Binding starts with phase-B anchors**, strengthened by the proposed document map.
5. **Seek resolution: pure agent first** (decided 2026-10-26) — the agent reads the file fresh per seek and returns lines; server-assisted lookup over the block model when documents get large.
6. **Document-map shape: prototype first** (decided 2026-10-26) — try `{blockId, headingPath, line+char range, preview}` against real seek queries before confirming it as the targeting contract; that prototype also settles 01b's postponed `blockId`.
