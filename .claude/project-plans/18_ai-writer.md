---
feature: ai-writer
status: draft
created: 2026-11-19
---
# 18 AI writer — write with the agent and watch the text change, every version a slider step away

## Goal
Write a text with the agent faster than by hand: a letter, a reply, a short piece (asked 2026-11-19).
The review editor keeps the document still and talks around it; that works well and stays as it is.
The writer is the other regime: here the document is what moves.
Your comments roll it out: each send yields a new version that replaces the shown one in place, with what changed visible — no new tab, no new round.
A slider in the top bar walks back and forth through every version; the newest is the head, and only the head is written to.
A passage from an old version can be brought back into the head.
"AI writer" is a working name (see *Open*, 1).

This resurrects, in part, what 01 lists as a non-goal — "a WYSIWYG AI-powered editor / live synchronizer" — and the parked `ideas/block-document-orchestration.md` (rewrite in place, an edit log diffed as it comes).
It does so without blocks or several sessions: whole versions of one file, one session.
01's non-goal keeps holding for the review editor; the writer is its own page beside it.

## On a branch first — `main` stays as it is (asked in review 2026-11-19)
- **All writer code goes on the branch `ai-writer`**, off `main`; nothing of it lands on `main` until the writer is validated in real use and you say to merge.
- **The everyday edit-md is never replaced while the writer is tried.**
  `onboarding/install.ps1` installs over `~/.claude/bin/edit-md/`, so the branch build is published to its own folder, `~/.claude/bin/edit-md-writer/`, and runs with its own `EDIT_MD_HOME`.
  It then has its own server, state file, port and `prefs.json`, and the review server a session already runs is never shared or stopped by it.
- **`/write-md` on the branch calls only that build.** `/edit-md` keeps calling the installed one.
- **`main` keeps moving meanwhile** (parallel sessions work on the review page): the branch rebases onto it before each step's gate, and `roundtrip.mjs` runs on the rebased branch.
- This plan file is on `main` as a draft (moved there on your word, 2026-11-23); the writer's code still goes on the branch.

## Shape — its own page and API (decided in review 2026-11-19)
A separate page, API, document model, CLI verbs and skill, standing on the infrastructure that already exists underneath.

### A and B, from your side
**A — its own page, API and loop** (decided).
| for you | against you |
|---|---|
| The review editor can't break: writer code never runs on the review page; the shared edits are three small seams. | What the review page has does not come for free: each feature wanted in the writer — labels, threads, delegated runs, send buttons, marks, the skill picker — is ported or made again. |
| The agent can't mix the modes up: different ids, verbs, wake-ups, event kinds and skill, refused when crossed. | Two pages drift: an improvement to the review page does not reach the writer by itself. |
| The writer takes the shape writing needs — comments that roll the text, a chat, a slider, ghost text — without bending review's rounds and Submit. | More to build before the first try: a page, routes, CLI verbs and a skill. |
| Parallel sessions changing the review page and work on the writer touch different files. | Some duplication: a comment box, an inbox loop, tab presence. |
| If the idea doesn't hold, it goes away as a folder and a skill. | Two skills to know, `/edit-md` and `/write-md`. |

**B — a write mode of the review page, chosen by the skill that opens it.**
| for you | against you |
|---|---|
| Fastest to try: the page already re-renders on a file change and diffs it; B adds a version store, the slider and a skill. | Every writer behaviour is a condition in `app.js` and `ReviewDocument` — the part that works, the one you don't want touched. |
| Everything the page has works in the writer on day one: labels, dictation, threads, delegated runs, send buttons, marks. | The agent sees the same ids, the same `wait` and the same `send` events, told apart only by a mode field it must read on every event. |
| One page to learn; an improvement reaches both. | The semantics clash in shared code: rounds and Submit against Done; annotations that stay against comments a version consumes; ghost text against anchoring; read-only old versions. |
| Less code overall. | Parallel sessions on the review page and writer work collide in the same files. |
| | Hard to take back out if the idea doesn't hold. |

**Why A:** your two conditions — the review editor stays safe, and the agent cannot confuse the modes — are structural in A and only disciplined in B.
B's real gain is speed to the first try; the branch removes B's risk to `main`, but not its entanglement once merged.

### What is shared, and what is the writer's own
**Shared, used as they are:**
- Markdown: `MarkdownRendering.ToAnnotatableHtml`, `SourceMap`, `BlockDiff` (`src/LalamoMado/Markdown/`); the file on disk as the record.
- `Preferences`, `Glossary`, `LocalDictation` (Whisper), `StablePort`, `BrowserLauncher`, and new instances of `ReplayFeed`, `AgentEventQueue` (`Server/Feeds.cs`) and `TabPresence`.
- Client: `anchor.js` (selection → quote), dictation (`mic.js`, `whisper.js`, `spoken.js`, `glossary.js`, `remember.js`), `prefs.js`, `diagrams.js`, and `app.css`'s colour tokens and markdown styles.

**Shared, through one seam each:**
- `/api/prefs`, `/api/transcribe` and the glossary route find a document's path through `registry.Find(docId)` in the review registry.
  They get a small resolver over both registries (`d…` review, `w…` writer), so dictation and preferences work for a writer document.
- The shared client modules import `./api.js`, the review page's route module.
  The writer page swaps it for its own `client/write/api.js` with an import map (`{"imports": {"/api.js": "/write/api.js"}}`), exporting the names they use (`docId`, `fetchGlossary`, `rememberMishearing`) — no review file changes.
- `ReviewServer.cs` gains one call that maps the writer; `Cli/Commands.cs` one `write` verb that hands over to the writer's commands.

**The writer's own:**
- Server, `src/LalamoMado/Writer/`: `WriterDocument` (path, versions, comments, chat, inbox, presence, file watcher), `WriterRegistry` (ids `w1`, `w2`…, its own event queue), `VersionHistory`, `WriterRoutes` (page `/w/{docId}/`, API `/api/write/…`), `WriterContracts`; later `Markdown/WordDiff.cs`.
- Client, `client/write/`: `index.html`, `write.js`, `api.js`, `versions.js` (slider, version cache), `comments.js`, `chat.js`, `changes.js`, `write.css`.
- CLI `Cli/WriterCommands.cs`; skill `onboarding/skills/write-md/SKILL.md`.
- Tests: `tests/e2e/writer.mjs`, `VersionHistoryTests`, `WordDiffTests`.

### The two never collide (asked in review 2026-11-19)
The agent must never mistake one loop for the other, and neither page may change the other's behaviour.
- **Separate ids:** review documents are `d1`, `d2`…; writer documents `w1`, `w2`….
  A review verb given a `w…` id, or a writer verb a `d…` id, is refused with the right command in the message: *w1 is a writer document — `edit-md write chat w1`*.
- **Separate wake-ups:** each registry has its own event queue; `edit-md wait` never returns a writer event, `edit-md write wait` never a review one.
  Writer event kinds (`comments`, `chat`, `rollout`, `done`, `closed`, `tab-lost`, `tab-back`) share no name with review kinds (`send`, `fix`, `submit`, `aborted`, `resumed`), and every hint spells the full `edit-md write …` command.
- **One file, one loop:** a path open for review cannot be opened in the writer, nor the reverse; the refusal names the open one (*already open for review as d1 — finish or close it first*), so the agent asks you instead of running both.
  Different files may run both loops in one session, each with its own `wait`.
- **Separate skills:** `/write-md` opens with what it drives and that `/edit-md`'s events, verbs and Submit do not apply there; `/edit-md` gets the mirror line.
- **`/edit-md` never moves the document under you** (stipulated in review 2026-11-19).
  The review page keeps its rule — nothing re-renders on its own; ↻ *Show the edit* is your click — and gets no file watcher, no versions, no roll-out.
  The review loop's events and hints never ask the agent to rewrite or revise; it changes the file only where the review already says so (a silent group, Apply), and you see it only when you click.
  `/edit-md`'s skill names no writer verb or behaviour beyond the one line saying `edit-md write …` does not apply there.
- **An obvious API cut:** the writer is `/api/write/…`, `/w/{docId}/`, `edit-md write …` and `/write-md`; the review is `/api/docs/…`, `/d/{docId}/`, the plain verbs and `/edit-md`. No route or verb serves both.
- **Separate code:** the writer stays out of `ReviewDocument`, `DocumentRegistry` and `app.js`; the seams above are the only shared edits.
- **Gate, every step:** `roundtrip.mjs` and the unit tests pass unchanged, and `writer.mjs` checks each refusal above.

## Two ways the agent revises — tried side by side (decided in review 2026-11-19)
Both are worth trying for a while; if both earn their place, they stay as two modalities of the writer, for the agent above all.
- **Rewrite** (default — the proven case, what the agent does with a plan anyway): it reads the file and writes the whole text anew with its own Write.
  The AI's strength is keeping a text together; a comment on one passage still gets a whole new text, written with that comment in mind.
- **Segments:** it pulls the passages a send touches and changes them with its own Edit; what it does is itself the diff.
- ⚙ *The agent revises by:* rewriting the whole text (default) | editing segments.
  The server stamps `revise: "rewrite" | "segments"` on each `comments` and `rollout` event from `prefs.json` as it raises it (key `write.revise`, document over PC), so a switch the agent makes at your request holds from the next send on.
- **Each version records how it was made** (`revise`), so after a while of use it shows which way serves which text.
- Either way the page and the server do the same thing: the server diffs consecutive versions mechanically, and the agent never describes its changes.

**Kept fast and native:** the agent works the file with its own Read, Write and Edit — nothing piped through the CLI.
The server watches the file, so the page shows each change as it lands (see *Server and wire*: a version is one send's worth of changes).

Working on the file of record is also what lets the writer stand on the existing infrastructure: server rendering with its source map, the server's block diff.
A text held in a store of blocks is what would have needed a different one — the parked `ideas/block-document-orchestration.md`.

## The writer page
**Two ways in** (review 2026-11-19, my reading — see *Open*, 3):
- **Comments roll the document out by themselves.**
  Selecting a passage on the head opens a small comment box; **Add** stages the comment, **Send now** sends it alone.
  **Send (N)** in the bar sends every staged comment as one, with an optional note for the whole text.
  Either send makes the agent revise the text — whole or by segments, per the ⚙ — and the new version is shown as it lands.
- **The chat talks and leaves the text alone.**
  A message in the chat box (right pane, Ctrl+Enter, 🎤 and Ctrl+D as in the review page) is answered in the chat; no version comes of it.
  **↻ Roll out** in the bar asks the agent for a new version from what the chat settled since the last one — the explicit refresh for whatever was worked out in the background.

**The rest of the page:**
- **Top bar:** file name and link dot; the slider `◀ ━━━●━━ ▶ v5 / 7` — one stop per version, head at the right end, Alt+← / Alt+→ step, a stop's hover shows what asked for it and when; **Send (N)**; **↻ Roll out**; **Restore** while an old version is shown; **Copy** — the shown version as rich text and plain text, for pasting into a mail; ⚙; **Done**.
- **A long history** (asked in review 2026-11-19): the slider keeps the recent tail, where the work is, and folds the oldest versions behind `◀ +12` at its left end once the stops no longer fit (a stop needs ~14 px of the bar's free width).
  Clicking `+12` expands the older part of the timeline in place, the slider scrolling within its own width if they still don't fit; ▸ folds it back, as does going back to the head.
  Stepping with Alt+← past the shown tail unfolds the older stops as it reaches them, and a Restore's source version shows in the hover even when folded.
- **Right pane:** staged comments on top; below them the conversation — sends, chat messages, the agent's replies, and a `→ v5` chip on each turn that made a version.
  Clicking a chip moves the slider there; the slider on v5 highlights the turn that made it.
  ⏳ shows on a send or roll-out from the moment the agent takes it until its version arrives.
- **A new version arrives** → shown in place, the reading position kept on the same block, the slider at head, changes painted, the comments it answered marked done.
  If an old version is on screen, the page stays on it and the slider's head end shows ● until you go there.
- **An old version** is read-only for the text: a comment made on it is a **Bring back** — staged like any comment, marked *from v3*, asking the agent to work that passage into the head.
  **Restore** makes the shown version the new head, as a new version that copies it; the history stays linear and loses nothing.
- **Changes** on the shown version against the one before it: inserted words tinted, removed words struck through inline as ghost text, kept out of the text index so quotes ignore it.
  ⚙ *Show changes as:* words (default) | blocks | off.
- **↶ on a change** reverts that one block to what it said before, mechanically, without the agent — a new version *by you*.
- **Closing the tab** loses nothing: the head is the file on disk. The agent hears `closed`; **Done** says the text is finished.
- Under 860 px the right pane stacks below the document, as in the review page.

## Server and wire
- `VersionHistory`: `{n, source, at, by: "agent" | "you" | "disk", sendId?, revise?}` in order.
- **Where versions come from:** a file watcher on the writer's document — and only there; the review page has none (see *The two never collide*).
  **One send, one version:** from the moment the agent takes a `comments` or `rollout` event, every change to the file goes into one open version, `by: "agent"`, carrying that `sendId` and `revise`.
  The page shows it live as the writes and edits land, the head marked ⏳; it closes when the agent asks for its next event (`write wait`), however many Edits it took.
  A change while nothing is taken settles after ~300 ms and becomes its own version, `by: "disk"` (you, in VS Code); a version is added only when the source differs from the head by hash.
- **Agent side:** `edit-md write open <path>` → `{docId, url, versions}`; `write wait <docId>` (background, as `wait` is); `write reply <docId> --to <id>` (markdown on stdin); `write chat <docId>` prints the conversation, for a context that lost it; `write show <docId> <n> [--lines A-B]` prints an old version's source, read on demand; `write status`.
- **Events:**
  ```json
  {"seq":3,"kind":"comments","docId":"w1","path":"…/letter.md","sendId":"s3","head":5,"revise":"rewrite",
   "note":"warmer overall",
   "comments":[{"id":"c1","quote":"Dear Mr Novák","text":"less stiff","lines":"1","version":5},
               {"id":"c2","quote":"Thank you for your patience","text":"bring this back","version":3}],
   "hint":"Read the file and rewrite it whole with Write; `edit-md write reply w1 --to s3` only if there is something to say; then `edit-md write wait w1`"}
  ```
  `chat` carries the message and a hint to answer with `write reply` and not touch the file; `rollout` a hint to revise, per `revise`, from what the chat settled since `head`; with `segments` the hint says to Edit instead of Write.
  Then `done`, `closed`, `tab-lost` / `tab-back`; delivery is acknowledged and leased as `wait`'s is.
- **Routes** (`/api/write/…`): `open`; `{docId}` (head view and version list); `{docId}/versions/{n}` (HTML with `data-src-*`, and changes against n−1); `{docId}/send` (comments), `{docId}/chat`, `{docId}/rollout`; `{docId}/inbox` (the page's long poll: `version`, `reply`, `working`); `{docId}/leaving`; `next` and `ack` for the agent; `{docId}/reply`; `{docId}/versions/{n}/restore`, `{docId}/versions/{n}/revert`; `{docId}/glossary`.
- **Word diff** (`Markdown/WordDiff.cs`): an LCS over words inside each `changed` pair `BlockDiff` already makes; insertions as offsets into the new source, removals as text with the offset they sit at.
- **↶** is a splice: the change's new span replaced by its `before` (an added block removed, a removed block's `before` put back at its anchor).
- **History** in memory first; kept on disk per document beside `prefs.json`, as `last-seen/` is, in step 4.

## Skill
`/write-md [path]`, user-invoked like `/edit-md`; on the branch it calls only the branch build (see *On a branch first*).
It names the binary and starts `serve` as `/edit-md` does, then holds only the writer's loop: open, wait; on `comments` or `rollout` revise as `revise` says — `rewrite`: read the file and write it whole with Write; `segments`: pull the passages the send touches and Edit them; on `chat` answer with `write reply` and leave the file alone; ask for the next event only once the file is done, since that closes the version; stop at `done` or `closed`.
It names the `write.revise` key and where `prefs.json` lives, so it can switch the way of revising for you.
No file yet → it writes an empty one where you want it, else in the scratchpad; v1 is empty and the first send writes v2.

## Steps & gates
0. **Branch and side-by-side build.** The `ai-writer` branch; a publish of the branch build to `~/.claude/bin/edit-md-writer/` with its own `EDIT_MD_HOME`.
   *Gate:* the branch build's server and the installed edit-md's server run in one session at once, each with its own port and state file, and stopping one leaves the other up.
1. **Versions, slider, comments, chat.** The writer's server, watcher, routes and CLI; the page with the slider, staged comments and Send now / Send (N), the chat with dictation, ↻ Roll out, read-only old versions, Restore, Copy, Done; block-level change marks against the previous version; both ways of revising and their ⚙; the skill.
   *Gate* (`tests/e2e/writer.mjs`): open an empty file → v1; three sends, each answered by writing a whole new file → four stops, slider at head, each version carrying its send; a send answered with `revise: "segments"` by three Edits makes one version, shown live as the edits land and closed by the next `write wait`; a send carries `revise` as `prefs.json` holds it; the review page, with the same file changed under it, re-renders nothing until ↻; an edit made outside while nothing is taken becomes a `by: "disk"` version; a chat message reaches the agent as `chat` and its reply makes no version; ↻ Roll out raises `rollout`; v2 shows its own changes and opens no comment box on the text; a version arriving while v2 is shown leaves the page on v2 with ● at head; Restore v2 → v5 equals v2; Copy puts HTML and text on the clipboard; dictation works in the chat box; with more versions than fit, the oldest fold under `+N`, a click unfolds them, ▸ and going to head fold them back, and Alt+← past the tail unfolds one at a time; every refusal in *The two never collide*.
   `tests/e2e/roundtrip.mjs` and the unit tests pass unchanged.
2. **Word-level changes.** `WordDiff`; inline insertions and ghost removals; the ⚙ *words | blocks | off*.
   *Gate:* a one-word edit shows exactly that word inserted and the old one struck; a quote taken across a ghost removal on the head still gets the right `lines`.
3. **Bring back and ↶.** *Gate:* a comment on v3 reaches the agent with `version: 3`; ↶ on a changed block gives a version equal to the previous one with only that block put back.
4. **History across sessions.** Beside `prefs.json` per document, pruned like `last-seen/`. *Gate:* after a server restart the slider shows the same versions.

Merge to `main` only after real use of 1–3 and your explicit go.

## Open — your call
1. **Name.** Working name AI writer; proposed `/write-md` for the skill and *writer* for the page, matching `/edit-md`. Alternatives: *Takes* (each version a take), *Redraft*.
2. **Who writes:** the session (recommended — it holds the conversation: who the letter is for, what was said before), or a delegated run (plan 10) on a faster model picked in the page, for quicker turns at the cost of that context.
3. **Comments and chat, as read above:** comments roll the text by themselves, staged or one at once; the chat only talks until ↻ Roll out. Confirm, or say if the chat should roll the text too.
4. **History across sessions:** kept beside the prefs (recommended; a letter is often finished the next day), or per session only.
5. **Typing yourself.** The text changes only through the agent or the file on disk; a name or a typo through the agent is slow. An *Edit block* that opens the block's markdown in place and saves a version *by you* would cover it without a WYSIWYG editor. Recommended as a later step, after real use of 1–3.
6. **Outline.** None in v1 — a letter is short. `outline.js` could join later, as it is wired only to its own elements.
7. **Streaming.** Seeing the text appear as the agent writes is not possible through the session, whose Write lands whole; a delegated run (plan 10) streaming `stream-json` could show it. Left out; revisit after use.

## Decided
- From the ask (2026-11-19): a regime separate from review — the document is what moves; a slider in the top bar walks the versions; one head.
- From the ask (2026-11-19): the review editor's concept stays intact; writing must not confuse or degrade it.
- From the ask (2026-11-19): the diff is mechanical and the server's; the agent never describes its changes.
- From review (2026-11-19): shape A — its own page, API and logic, standing on the shared infrastructure; B was weighed twice (see *A and B, from your side*) and dropped.
- From review (2026-11-19): the two modes are wedged apart so neither the agent nor the code can mix them up — see *The two never collide*.
- From review (2026-11-19): two ways of revising are tried side by side behind a ⚙ — rewriting the whole text (default, the proven case) and editing segments — and may both stay as modalities; each version records which made it.
- From review (2026-11-19): the agent works the file natively with its own Read, Write and Edit; the server watches the writer's file, gathers one send's changes into one version shown live, and diffs it mechanically.
- From review (2026-11-19): an obvious API and behaviour cut — invoking `/edit-md` must never lead to the agent changing the document under your hand; the review page gets no watcher, versions or roll-out.
- From review (2026-11-19): comments are staged and sent as one, or sent at once, and the document rolls out by itself; an explicit ↻ covers what was settled in the chat.
- From review (2026-11-19): with many versions the slider keeps the recent tail and folds the oldest under an expander at its left end.
- From review (2026-11-19): the writer is built on the branch `ai-writer` with a side-by-side build, and merges to `main` only on your go.
