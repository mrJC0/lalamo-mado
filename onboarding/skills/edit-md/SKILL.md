---
name: edit-md
description: Review a Markdown file in the browser editor with the agent in the loop — annotate, send notes mid-read, get answers in place, finish with Approve, Apply and review, or Apply silently. Use when the user runs /edit-md [path].
argument-hint: "[path of a .md]"
disable-model-invocation: true
---

# edit-md — drive the browser review

The human reads and annotates in the browser; you receive only structured annotations anchored to file lines.
You own the whole loop: server, open, wake-ups, replies, edits, further rounds, shutdown.

## The binary
`"$HOME/.claude/bin/edit-md/edit-md"` — written `edit-md` below.
Call it by that full path, double-quoted, from the Bash tool; the quotes keep Git Bash on Windows from eating the path.
It lives outside `skills/` because a git-synced harness tracks `skills/`; this folder holds only this file.
Each subcommand prints one JSON line on stdout — trust that line, not the exit code.
Missing binary → run `pwsh onboarding/install.ps1` in the lalamo-mado repo (https://github.com/mrJC0/lalamo-mado).

## 1. Get the document onto disk
- `$ARGUMENTS` names a file → use it.
- No argument → the .md the conversation is about; ask if that is ambiguous.
- Content that exists only in the chat → write it to a `.md` first (where the user wants it, else a sensible repo path, or the scratchpad for throwaway text) and say where.
- Never paste the document into the chat: the human reads it in the browser, and re-emitting it only burns context.
- Read from disk only the lines an annotation points at.

## 2. Bring the server up
- Foreground `edit-md status` → a JSON status means it runs; an `error` means it does not.
- Not running → Bash with `run_in_background: true`: `edit-md serve`.
- `serve` is idempotent and lives until the session ends or `edit-md stop`.
- Once per session, after starting it, feed the models you know for the page's picker: `edit-md models --set` with `[{"id": "claude-opus-5-5", "name": "Opus 5.5"}, …]` on stdin.
- Then report the user-only skills (`disable-model-invocation: true`) you have already run in this session, this one included: `edit-md skills --ran edit-md <name>…`. Report again after running another. The picker shows ❗ on user-only skills not yet run, so the reviewer knows to type those in the chat once.

## 3. Open and arm the wake-up
- Foreground `edit-md open <path>` → `{docId, url, browser, newWindow, changes, labels, ...}`.
- `changes` counts the blocks the page marks as changed since the reviewer last saw the doc, in this session or an earlier one (0 when they never saw it); the diff itself stays in the page.
- The server opens it in a dedicated browser profile per session, never the user's everyday window: the session's first doc gets its own window, later docs become tabs in it; an already-open doc just stays where it is.
- `labels: "custom"` means the reviewer's labels differ from the defaults below: run `edit-md labels <docId>` once and follow each label's `description`.
- `browser: "default"` means no Chrome, Chromium or Edge was found — it opened in the default browser, without the dedicated window.
- Then Bash with `run_in_background: true`: `edit-md wait <docId>`.
- Tell the human in one line that it is open, then carry on or end the turn.
- Never poll, sleep, or run `wait` in the foreground — the background `wait` is what keeps the chat free.
- Keep exactly one `wait` armed per doc: each event goes to exactly one `wait`, and events queue on the server meanwhile.

## 4. On each wake
The task notification arrives → `Read` its output file → one JSON event:
```json
{"seq":2,"kind":"send","docId":"d1","round":1,"path":"…/plan.md","mode":"reply",
 "annotations":[{"id":"a1","label":"question","text":"Why only the replica?","scope":"span",
                 "quote":"The export runs","lines":"13","sourceStart":434,"sourceEnd":449,"exact":true}],
 "hint":"answer: `push d1 --to a1` (markdown on stdin), then `wait d1`"}
```
`hint` is the one-line next step.
Handle the event, then re-arm `wait` unless the table ends the review:

| event | the human did | you do | re-arm `wait` |
|---|---|---|---|
| `send`, `mode: "reply"` | **Send now** on one annotation | answer it in the page: `push <docId> --to <id>` | yes |
| `send` with `replyTo` | a follow-up in a thread — no label, no quote | answer it in the page: `push <docId> --to <replyTo>`; `edit-md thread <docId> <replyTo>` prints the thread if your context lost it | yes |
| `send` with `agent` | **Brief**: a separate run answers, and you only brief it | write a brief from what you know, free text, not the answer; `edit-md delegate <docId> --to <id>` with the brief on stdin | yes |
| `send` with `button` | a send button with `by: "session"` | do what `button.instructions` say, by any means: a reply of your own, several runs compared, a workflow; answer with `push <docId> --to <id>` | yes |
| `fix` | **✨ Fix** on a comment still being written | correct misheard words in its spoken parts against the document, the conversation and the event's `glossary`, returning the rest verbatim; `push <docId> --fix <fixId>` with the corrected text on stdin (plain text, no markdown) | yes |
| `send`, `mode: "silent"` | **Send drafts (N)** — a coherent group | work the group as a whole (e.g. edit the file); no reply | yes |
| `submit`, `decision: "approve"` | **Approve** (no annotations) | change nothing; confirm in chat | no |
| `submit`, `decision: "apply-review"` | **Apply & review** | apply the annotations, then `open` the same path → round N+1 in a new tab | yes |
| `submit`, `decision: "apply-silent"` | **Apply silently** | apply the annotations, summarize in chat | no |
| `aborted`, `reason: "closed"` | closed the tab unsubmitted | nothing is approved; ask in chat how to proceed | no |
| `aborted`, `reason: "lost"` | page went silent (sleep, crash) | nothing yet; `resumed` follows if it returns | yes |
| `resumed` | the lost page is back | continue the review | yes |
| `server-stopped` | — | `serve` in the background again, then `open` | after `open` |

After `submit` the page is closed and `push` is refused, so answer in chat.
`submit.annotations` holds only what no `send` delivered.
`fileChanged: true` means the file changed on disk since it was opened: a separate run or another window edited it. `lines` then belong to the version the page shows, so find the place by `quote`.
`glossary` — on a `fix`, and on an event with a dictated annotation, when the reviewer keeps one: their `terms` and known `mishearings` (heard → meant); read dictated words against them, as the page has already replaced the known mishearings.
`round` counts review rounds; events from an older round are never delivered.
An event whose `seq` you already handled is a redelivery (its `wait` died before confirming it) — skip it.

## Reading an annotation
- `lines` — 1-based file lines (`"13"` / `"13-15"`): `Read` that slice, then `Edit`.
- `exact: false` — `lines` is the enclosing block, not the exact span.
- `quote` — the selected text as rendered, markdown stripped; long ones arrive as head … tail with `quoteLength`.
- `scope: "general"` — about the whole document; no quote, no lines.
- `scope: "block"` — a whole block the reviewer picked or stamped: `lines` are the block's, `quote` its rendered text.
- `text: ""` — no comment: the annotation means what its label says, nothing more.
- `label` — the defaults below, unless `open` reported `labels: "custom"`:
  - `comment` — a remark; act on it if it asks for something.
  - `question` — answer it.
  - `change` — rewrite the quote as described.
  - `remove` — delete the quote.
  - `insert` — a point (`quote` empty, `sourceStart == sourceEnd`); insert the text there.
  - `good` — approved; leave it.
  - `reject` — rejected as it stands; drop it, or propose another way if one is obvious.
  - `seek` — find in the document what the comment describes and answer with a mark set named `seek: …`, one mark per finding with a short note; reply in one line only, saying how many were found.
  - `setting` — change or add a setting of edit-md itself; see *Settings*.
  - `customize-page` — change the review page itself: copy each file you change from `~/.claude/bin/edit-md/client/` into the overlay folder `~/.claude/edit-md/client/` and edit the copy, which the server serves instead and a reinstall keeps; reply with the files changed.
  - `new-kind` — add a label to `<git root>/.claude/edit-md/comment_labels.json`, or to `~/.claude/edit-md/comment_labels.json` when it is the reviewer's own, and check it with `edit-md labels <docId>`.
  - The last three are hidden gateways: the page offers them from ⚙, never among the chips.
- `labels` — present when the reviewer picked several; `label` is the first.
- A tag like `[❓ question]` in `text` counts as a label too.
- `markId` / `markSet` — the annotation answers that mark of yours (see *Marking spans*).
- `dictated: true` — spoken and transcribed, all of it, or only the parts in `spoken`. Expect misheard words there ("secret" for *seek*, "market" for *mark*) and read them against the document, the conversation and the repo's terms before acting. Everything else was typed or corrected by hand: take it at face value, exactly as written, and never "fix" it.
- `skills` — the skills the comment names as `/name`. What naming means depends on the wording, as in the chat: when it asks for one, invoke it with your Skill tool, the rest of the comment as arguments, and say so in the reply. A user-only skill you already ran in this session you can follow again from context; one you have not, you cannot run: say so and ask the reviewer to type it in the chat once.
- `maybe` — maps a spoken word to what the recognizer also heard: it may be one of those, or none. In Czech dictation English terms can arrive spelled Czech (`zík` for *seek*).
- `localTranscript` — on a `fix`, when the reviewer keeps Local beside Chrome: Whisper's transcript of the same speech. Two engines heard one take; reconcile them word by word against the document. Where they differ, Whisper's words are already in `maybe`; a phrase only one of them caught may be real.

## Replying into the page
A reply answers one query while the review is open:
```bash
"$HOME/.claude/bin/edit-md/edit-md" push d1 --to a1 <<'EOF'
The primary serves **live invoicing**; an export there would compete for locks.
EOF
```
- `--to <id>` threads it under that annotation; without it, it lands under "From the agent" as a thread of its own, and the reviewer can answer there.
- `--quote "<exact rendered text>"` also highlights a span you choose.
- A reply never replaces the document; to show edits, change the file and `open` it again — same round while the tab is open, a new round after a submit.

## Marking spans
Marks are your highlights in the page — decisions the reviewer has to take, risks, one seek's findings — each with a label and a note:
```bash
"$HOME/.claude/bin/edit-md/edit-md" mark d1 --set decisions <<'EOF'
[{"label": "decision", "quote": "Windows-1250", "note": "Keep it, or move to UTF-8?", "focus": true}]
EOF
```
- `--set` names the reason. A new name adds a set; a name in use replaces just that set, so re-send the whole set when it changes.
- `quote` is the exact rendered text; `lines` picks the occurrence when it repeats, and `before` (the text just before it) when it repeats within those lines. The answer lists `notFound` quotes — fix and re-send them.
- `focus: true` on one mark shows it strongly first; after that the reviewer moves the focus.
- Any label id works; one in the label list takes its colour, any other a colour of its own.
- Marks stay — across reloads, re-opens and rounds, following edits — until you drop them: `edit-md unmark <docId> <set>`, or `--all`. Answering a mark does not remove it; drop or update the set once the answer is in.

## Settings
When the reviewer asks for a behaviour of the page, in the chat or in a comment, look in the settings first: `edit-md settings [docId]` lists each with its description, value, default and where the value comes from.
`edit-md settings [docId] --set KEY=VALUE` changes one, and every open page shows it at once; `--unset KEY` removes it from that scope again.
It is kept for this PC unless `--scope repo|session|document` says otherwise; the repo level is a tracked file for a team, so use it only when asked.
An unknown key or a value the setting does not allow is refused with what is allowed.
Propose a new setting only when none fits.

## Housekeeping
- `edit-md status` — open docs, round, connection, pending events.
- `edit-md buttons <docId> --set` (`{"buttons": [{id, icon, name, description, by, repo, model, edit, allow, prompt, system, tellSession, maxTurns, maxBudgetUsd, timeoutSeconds, instructions}], "replace"?: true}` on stdin) sets send buttons for this review only; `--clear` drops them. Lasting lists live in `<git root>/.claude/edit-md/send_buttons.json` and `~/.claude/edit-md/send_buttons.json`. Offer this when the reviewer keeps needing the same way of answering.
- `edit-md skills <docId>` — the user's and the repo's skills the page lists; the server reads them itself, so you never need to feed them.
- `edit-md skills --ran <name>…` — user-only skills you have run in this session; their ❗ goes. If you have lost a reported skill's text since, after `/clear` or a compaction, ask the reviewer to type it again rather than guess.
- `edit-md glossary <docId>` — the reviewer's terms and known mishearings, merged, and the Whisper prompt made of them. They live in `<git root>/.claude/edit-md/glossary.json` and `~/.claude/edit-md/glossary.json` as `{"terms": [...], "mishearings": {"heard": "meant"}, "replace"?: true}`; a mishearing of several words (`"secret results"`, never `"secret"`) keeps an everyday word safe. The page adds to them when the reviewer chooses to remember a correction of dictated words, so a changed `glossary.json` in the repo is theirs.
- `edit-md thread <docId> <id>` — a whole thread in order: quote, lines, every turn.
- `edit-md events [docId]` — every event with its state (`pending` / `taken` / `delivered` / `superseded`); recovers a missed wake.
- `edit-md labels <docId> --set` (`{"labels": [{id, icon, name, description, color?, hotkey?, hidden?}], "replace"?: true}` on stdin; `hotkey` is a digit from 1 to 9; `hidden` keeps a label off the chips) sets labels for this review only; `--clear` drops them. Lasting lists live in `<git root>/.claude/edit-md/comment_labels.json` and `~/.claude/edit-md/comment_labels.json`.
- `edit-md stop` once the user is done reviewing; the server also ends with the session.
- The page is plain files in `$HOME/.claude/bin/edit-md/client/`, meant to be tailored.
- A reinstall overwrites them, so changed copies of a few files go into the overlay folder `~/.claude/edit-md/client/`, which the server serves first; a whole personal variant lives in its own folder and runs via `serve --client <dir>` or `EDIT_MD_CLIENT_DIR`.
