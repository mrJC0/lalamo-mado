---
feature: lalamo-mado
phase: C
status: active
created: 2026-10-20
---
# 01c — Layout, rendering, diff & decisions

> Detail for roadmap [01_lalamo-mado.md](01_lalamo-mado.md) · phase **C** of A–D. Turns the bare annotator into the real review surface.

## Goal
The full docked review surface: the filterable left-pane mashup, rich rendering (code/mermaid/katex), server-computed diff, AI-authored decisions, nestable highlights, and the feedback-notes re-review loop.

## Steps & gates
1. ◐ **Layout shell.** Docked panes, no-occlude law (roadmap: only the comment popup, the reply panel and short-lived choosers may overlap); a dedicated window per session. *Gate:* at 1280×800 and at 860 px no pane or status message hides document text; the popover never covers the selected span; switching dock side re-anchors the highlights.
   Built: top bar (file, connection dot, + General, Send drafts (N) │ Apply silently / Apply & review); document column (max 80ch); the **right pane** docked and sticky with its own scroll ("From the agent" + annotations); the comment popover is the only overlay; under 860 px the pane stacks below the document; the status message ("toast") sits in the top bar — it used to cover document text at the bottom (moved 2026-10-26, e2e-checked). Window: landed (see *Dedicated window per session*).
   Landed from review (2026-10-29): the left pane sizes to its content (`fit-content`, capped at min(360px, 30vw)) with no sideways scrolling; both panes resize by dragging their inner edge (double-click resets, widths remembered per browser); **Apply silently** carries a muted version of the primary colour; the right pane orders annotations by document position (default, general ones on top), newest first, or last edited — remembered per browser (lorem round 3, a5).
   To do: **dock side configurable** (left/right, the WANT); a collapse toggle for the right pane (the left pane's landed with step 2).
2. ◐ **Left-pane mashup** (decided 2026-10-26: build the left pane before the diff; the diff's Changes list lands in it). One filterable panel: scroll-tracked TOC + changes + decisions, nested under chapter, per-category checkboxes (default all on). Detail below, under *Left pane*. *Gate:* toggling a category filters the pane; the outline tracks scroll; badges count annotations per section and update as annotations are added or deleted; collapsing the pane gives the document its width back; at 860 px the pane never covers text.
   Landed: the outline (`client/outline.js`) with per-section badges, scroll tracking, click-to-heading, the collapse toggle, and the narrow-screen stacking; with step 4, the Changes category nested under its sections and the category checkboxes; from review (2026-10-29), the pane header with the checkboxes stays on top while the outline scrolls, and an unticked category leaves coloured counts per kind on its headings (e.g. `~1 +1`) — all e2e-checked in `roundtrip.mjs`. The agent's mark sets list as categories of their own (step 5), which is where seek results go: no separate Seek tab (decided 2026-11-04).
3. ◐ **Rendering.** Code highlight (highlight.js); mermaid + katex lazy-loaded. *Gate:* a doc with code + a mermaid diagram + math renders; the diagram is annotatable.
   Landed: **mermaid** — vendored `client/vendor/mermaid-12.1.0.min.js` (MIT), loaded only when the doc has a ```` ```mermaid ```` block, rendered after first paint into the server's `<pre class="mermaid">` (which keeps its `data-src-*`), then anchors re-index; a diagram label is annotatable and maps to its exact source line; diagram `<style>` text is excluded from the text index.
   Landed 2026-11-09, decided in review the same day: **front matter** — without Markdig's YAML extension a skill's or plan's front matter rendered as a rule and one huge heading, which also entered the outline. Now `UseYamlFrontMatter` parses it and our own renderer shows it verbatim at the top as `<pre class="front-matter">`, muted and wrapped, with its `data-src-*`: annotatable, a quote inside it maps exactly to its line, out of the outline, and the change bars treat it as a code block (`MarkdownRenderingTests`). A key/value table was turned down, since lists and nested maps do not fit one, and hiding it, since a skill's description is often what gets commented on. Approved in real use 2026-11-11. Still to do: highlight.js, katex — vendored the same way (pinned, MIT, lazy-loaded, offline incl. katex fonts); mermaid stays committed, not fetched at build time (decided 2026-10-26).
4. ✅ **Server-computed diff** (decided 2026-10-26: it closes the loop the three-exit Submit opened — the round reopened by *Apply & review* shows what changed since the reviewer last saw it; step 5 builds on its change model). Detail below, under *Server-owned diff*. *Gate:* after *Apply & review* the round-2 page marks exactly the blocks the agent edited — added, changed, removed — and nothing else; a reflow-only edit marks nothing; a same-round re-open marks what changed since the page's previous render; a first open marks nothing; each change's old text matches the previous source; the agent receives only a count.
   Landed 2026-10-26: every gate point is checked — `BlockDiffTests` (reflow, edits, adds, removals, table rows, code indentation) and `roundtrip.mjs` (first open marks nothing; a same-round re-open marks a changed heading and an added paragraph; round 2 after Submit marks a removed quote; marks survive a reload; filters and the bar toggle work).
   Follow-up, decided and landed 2026-11-02: the baseline lives on disk, one file per document in `last-seen/` next to `prefs.json` (`Server/LastSeenVersions.cs`, dropped after 30 days unseen), so a new session or a reinstall still diffs against what the reviewer last saw — `LastSeenVersionsTests`, and `roundtrip.mjs` restarts the server and still sees the change.
5. ◐ **Agent marks + nestable highlights — built 2026-11-02, tested in lorem round 10 (a seek for all verbs: 130 marks).** From that round, built 2026-11-04: a focused mark at 38% over the page and uncoloured set rows did not read as its tick's colour, so a focused mark is now the solid label colour with readable text on it, and a set row shows a coloured ◆ per colour it holds. Marks still live in server memory only. The agent highlights spans with a label and a note, a decision being one label; a span can carry an annotation *and* several marks at once. Detail and gate below, under *Agent marks*.
6. **Feedback-notes re-review loop.** A note per change pops in place on re-open. *Gate:* notes appear at their lines.
7. **Theming.** CSS variables + a small side settings icon holding the persisted theme switcher. The ⚙ panel landed with the comment popup (2026-10-29); the theme switch goes into it.

## Implementation detail

### Left pane — step 2
**Place.** A third column on the left, docked and sticky with its own scroll, like the right pane. Fixed width for now; resizing and dock side stay step 1 to-dos. A bar button collapses it and gives the document the width back. Under 860 px it starts collapsed and, when opened, stacks above the document — never over it.

**Outline.** One entry per heading, indented by level, read from the rendered `h1`–`h6`; they already carry `data-src-start`, so no wire change. Each entry has a badge with the number of annotations in its section; a section runs to the next heading of any level (resolved #4). The entry for the section on screen is highlighted as you scroll; clicking an entry scrolls to it.

**Categories.** Checkboxes for Outline / Changes / Decisions, default all on. A category shows only once it has items: Changes come with step 4, Decisions with step 5. Their items nest under the heading of their section.

**Not in step 2:** resizing and dock side (step 1).

### Server-owned diff (offload the client and agent) — step 4, as built
The server diffs; the agent never prepares or reads a diff.

**Baseline = what the reviewer last saw.** The server records the source each time the page loads it (`GET /api/docs/{id}`), in any round. `open` diffs the new source against that record. Opening twice before the page reloads still diffs against what the page showed, not the intermediate version. A first open has no baseline and marks nothing.

**Unit = a leaf block.** Paragraph, heading, code block, thematic break, and each table row on its own. Lists and quotes are not units; their leaves are. Prose compares on whitespace-normalized text with quote markers dropped, so a reflow is not a change; code compares with its whitespace, so indentation is.

**Algorithm** (`Markdown/BlockDiff.cs`, unit-tested):
- Common prefix and suffix first, then an LCS over the rest by normalized text → runs of unchanged blocks.
- Each gap between runs is a hunk. Inside a hunk, old and new blocks first pair in order by word overlap (Jaccard ≥ 0.5, or ≥ 0.25 for two blocks of the same kind — a heading of the same level, two table rows, two paragraphs in the same kind of container) → `changed`.
- What that leaves unpaired may still be rewritten in place — a translation shares no words (round 2 of the lorem test showed it as added + removed). So the leftovers are aligned by a small DP: same-kind blocks in order, as many pairs as possible, then the highest total similarity; ties pair early → `changed`.
- Unpaired new blocks → `added`. Unpaired old blocks → `removed`, merged per spot and anchored before the block that now follows them.
- A table row's span leaves out its outer pipes; its offsets stay as they are (the `<tr>` carries the same), but its old text is the whole source line.
- Moves are not detected in v1: a moved block reads as removed + added.

**Wire.**
- `DocumentView.changes: [{kind: "added"|"changed"|"removed", srcStart, srcEnd, before?}]`, with offsets into the new source; a `removed` change has `srcStart == srcEnd` at its anchor. Computed once per `open` (`ReviewDocument.Load`), so a page reload keeps the round's marks.
- The client (`client/changes.js`) marks the smallest rendered block holding the change — a tight list item has no `<p>`, so its `<li>` stands in. No `headingPath` on the wire: the pane places each change by its text position, like the badges.
- A same-round re-open re-renders in place through the existing inbox `reload`.
- The agent gets only `changes: N` from `open`; no diff text enters its context.

**What the reviewer sees.**
- The document body only colour-marks impacted blocks (resolved #1): a bar in the gutter beside a changed (blue) or added (green) block, a short red tick where blocks were removed. No inline character diff in the body. The marks are drawn in an overlay, like insert points, and repaint on any layout change.
- The detail lives in the left pane's **Changes** category, under the section it belongs to: kind (the card is tinted by it), the new text, and the old text for changed and removed blocks. A removal is listed under the section it left. Clicking an item scrolls to its block and flashes it.
- A **Changes (N)** button in the bar shows or hides the marks. They last for the round.
- Changed and added blocks are annotatable like any text. A removed block is not in the document, so it can't be annotated in place.

**Out of scope for step 4:**
- the previous round's annotations shown as "addressed" beside the changes (step 6, feedback notes);
- a word-level diff inside the Changes list;
- detecting moves.

**Decided 2026-10-26:**
1. The left pane comes first (step 2); the Changes list lands in it, with no interim right-pane section.
2. The baseline lives in memory, per server: a new Claude session starts with no baseline. Persisting it per file is a small follow-up if wanted — wanted and landed 2026-11-02 (step 4 above).
3. Marks on by default, with the toggle in the bar — the recommendation, unannotated; say if you want otherwise.

### Nestable highlights (annotation + decision on one span)
Several named highlights coexist via the Custom Highlight API; CSS layers them. A span that is both annotated and flagged shows both.

```js
CSS.highlights.set("annotation", new Highlight(...annoRanges));
CSS.highlights.set("decision",   new Highlight(...decisionRanges));
CSS.highlights.set("change",     new Highlight(...changeRanges));
```
```css
::highlight(annotation){ background: var(--anno-bg); }
::highlight(decision)  { background: var(--decision-bg); text-decoration: underline wavy var(--decision-line); }
::highlight(change)    { background: var(--change-bg); }
```

### Agent marks — step 5, decided 2026-11-02
Decisions generalize into **agent marks**: the agent highlights spans with a label and a note, and a decision is one label among others (asked in lorem round 4: "AI-induced highlighting with custom labels — light up headers").
Nothing here is derived from the diff; the agent decides what to mark.
The server and page stay generic: they render whatever labels and sets arrive, and what to mark, and when, lives in the skill, which can change freely.

**Agent side.**
```
edit-md mark <docId> --set <name>   # JSON on stdin: [{label, quote, note, lines?, focus?}]
edit-md unmark <docId> <name>
edit-md unmark <docId> --all
```
- Marks come in named **sets**, one reason each — "decisions", or one seek's findings. A call with a new name adds a set and leaves the others; a name already in use replaces only that set, so re-sending a call does no harm.
- `quote` is the exact rendered text, as `push --quote` takes today; `lines` picks the occurrence when a quote appears more than once.
- `focus: true` on one entry names the mark to start focused (below).
- The answer says what could be placed, e.g. `{set: "decisions", placed: 4, notFound: ["…"]}`, so the agent learns about a quote it got wrong.
- Resolving a mark does not remove it: the agent reads the answer, then drops or updates the set. The page never guesses that a decision is settled.
- Seek (01d step 3) needs nothing of its own: a seek's findings are one set, named after the query, and several seeks coexist because sets do.

**Wire.** New inbox message kinds `marks` (one whole set) and `unmark` (a set name, or all). The inbox replays on reload, so the page rebuilds the sets in order; no websocket, as for replies.

**Page.**
- Each label gets its own named highlight (Custom Highlight API), layered under the reviewer's annotations: a span can be annotated and carry several marks at once.
- **Quiet and focused.** One mark at a time is focused: painted in its label's full colour with an underline, its card highlighted, the only strong highlight in the document. The others are a faint tint plus a coloured tick per mark in the right margin beside the line; the left margin keeps the change bars.
- A span paints at most 5 distinct marks; any beyond stay listed in the pane but unpainted.
- The reader focuses a mark by clicking its card (scrolls to it), its outline dot, or its margin tick (no scroll); clicking the focused one's card or tick again unfocuses it. The agent's `focus` applies only while the reader has not picked one, and never scrolls the page.
- Left pane: a **Marks** category; each set is one row with its count, ticked on or off as a whole, and inside it the per-label checkboxes work as they do for Changes (`◆ decision (3)`, `◆ risk (1)`).
- **Headings light up in the outline only:** an outline entry whose section holds marks gets a dot per label in the label's colour, and keeps it while the Marks category is unticked, like the hidden counts. The document's headings stay as they are; the highlight is already there.
- A mark card shows label, note and quote; clicking it focuses the mark. Its **Resolve** button drafts an annotation linked to the mark.

**Labels and colours.** Marks take their colours from the label contract (07). A label without a colour gets one from a fixed palette, so a mark is always visible.

**Back to the agent.** An annotation the reviewer makes on a marked span, or drafts with Resolve, carries `markId` and the set name, so the agent knows which mark it answers.

**Decided 2026-11-02** (open-issues review, rounds 1 and 2):
1. One generic `edit-md mark`, `decision` being one label — no dedicated `edit-md decisions`.
2. Calls add, in named sets; reusing a name replaces that set; `unmark` drops one set or all. Not per-call ids (lost on compaction), not per-mark ids (one removal per settled decision).
3. Up to 5 distinct marks paint per span.
4. Headings light up in the outline only.
5. One focused mark: the reader picks; the agent may only name the start.
6. A **Resolve** button on a mark card.

**As built (2026-11-02).**
- Server (`ReviewDocument.Mark` / `Unmark`): sets per document, in order; ids `m1`, `m2`… per mark; each quote placed with the source map (within `lines` when given), unplaced quotes returned as `notFound`. Every `Load` re-places the sets against the file, so marks follow the agent's edits — a mark whose quote is gone drops out of the page — and a new round re-announces them.
- Wire: `POST /api/docs/{docId}/marks {set, marks}` and `/unmark {set|null}`; inbox `marks` (one whole set) and `unmark`. CLI `edit-md mark <docId> --set NAME` (JSON on stdin) and `edit-md unmark <docId> (NAME | --all)`; the planned `--focus` became `focus: true` on one entry.
- Page (`client/marks.js`): each set is its own left-pane category `◆ <set>` with a checkbox per label; outline headings get a dot per label (clicking one focuses the first such mark in that section); quiet marks share one neutral tint (`mark-quiet`, under the annotations), the focused one is `mark-focus` in its label colour with an underline, above them. A label outside the label list takes a colour from a fixed palette, orange first.
- A quote that repeats within its `lines` takes `before` (the text just before it); each placed mark carries the rendered text before it (`prefix`), so the page highlights that occurrence and not the first — found by the first real seek (all verbs in the lorem doc, round 10).
- Marks live in server memory: a server restart drops them until the agent re-sends them.
- An annotation made on a marked span carries that mark too — the focused one when it overlaps, else the first — not only one drafted with Resolve.
- Tests: `AgentMarksTests` (placement and `lines`, replace and unmark, carried across a round and an edit, `markId` in the payload) and a `roundtrip.mjs` check covering the gate below.

*Gate:* the agent marks two sets with two labels, one span in both; they paint as quiet tints with margin ticks and list under Marks per set and label; the outline headings light up in the label colours; clicking a card focuses its mark; re-sending one set replaces only that set, and `unmark` drops it; an annotation drafted with Resolve reaches the agent with its `markId`.

### Rendering: lazy heavy libs
Code highlight is always on; mermaid and katex are dynamically imported only when a doc actually contains them — keeps first paint cheap without dropping the rich base.

```js
if (hasMermaid) { const m = await import("./vendor/mermaid.js"); await m.run(); }
if (hasMath)    { const k = await import("./vendor/katex.js");   renderMath(k); }
```

### Dedicated window per session (cross-platform) — landed
As built (`Server/BrowserLauncher.cs`): the **server** launches the browser (it knows the session's tabs and outlives each CLI call) with a dedicated profile **per Claude Code session** — `--user-data-dir=<tool home>/profiles/<CLAUDE_CODE_SESSION_ID>` (git-ignored under `~/.claude/bin/edit-md/`; profiles untouched for 14 days are pruned at `serve`), **normal window, not app mode**: `--app` has no tab strip, so it can't give "one window, docs as tabs". The session's first doc (no tab of this server connected) gets `--new-window`; later docs go in as tabs. Pick order: Chrome → Chromium → Edge → system default; `EDIT_MD_BROWSER` (path or `default`), `EDIT_MD_BROWSER_ARGS`, `EDIT_MD_PROFILE_ROOT`, `EDIT_MD_PROFILE_DIR` (one fixed profile) override. Windows launches via ShellExecute so the browser doesn't inherit the server's stdout (the agent's task output). Verified headed by `tests/e2e/grouping.mjs`: two docs share one window, a parallel session gets its own profile and window, session 1's later docs still land in session 1's window, Submit closes its tab.
Two opens in quick succession share the window: a window launched in the last 15 s whose tab has not connected yet still counts as the session's (fixed 2026-10-29, after the explainer opened in a second window).
Decided 2026-10-26: profile **per session** (parallel docs and parallel sessions over different repos are common); the earlier shared-profile limit is gone. Trade-off: per-profile permissions (microphone, plan 03) would be asked once per session — since 2026-11-02 the microphone is pre-allowed in each new profile (plan 08).

## The leftovers, in order (decided 2026-11-19)
1. Code highlighting and math (step 3): highlight.js and KaTeX, vendored and pinned, loaded only when a document has code or math, offline.
2. Feedback notes (step 6).
3. The theme switch in ⚙ (step 7).
4. Dock side and a right-pane collapse (step 1) only if you miss them.

From the same review, built 2026-11-19: the document column is wider, with less padding at its sides — "the main document in the middle seems too thin".

## Resolved in review (01c)
1. **Diff signals *where*, not *what*.** Block-level diff: the main document render only **colour-emphasizes impacted blocks**; the actual diff **detail lives only in the left pane**. No inline char-diff in the document body.
2. **Chrome-only features gate behind a Chrome check; the core app does not.** The dedicated window per session and voice in/out need Chromium, so they detect it and self-hide when it's missing — the rest of the review surface stays usable in any modern browser. Absent Chrome, open the default browser and hint that the dedicated window and voice need Chrome, rather than refusing to start.
3. **Persist snapshots to disk if cheap — not a key demand.** Diff mainly serves the immediate flow; mid-session termination is uncommon, so a lost baseline across restarts is tolerable. Attempt persistence, don't gate on it.
4. **Mashup nesting: nearest preceding heading (any level)** — confirmed.
5. **Server renders HTML** — one source of truth with the source-map (per 01b); mermaid/katex still run client-side on the emitted HTML.
