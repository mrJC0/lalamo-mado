---
feature: lenses-and-payoff
status: parked
created: 2026-11-02
---
# 11 Lenses, quiz and payoff — keep the reviewer in the document

## Goal
A review should hold attention and pay back the effort put into it (asked 2026-11-02, from a session brainstorm on focus and engagement).
Six pieces:

| piece | what the reviewer gets |
|---|---|
| **Reply shine** | an arriving agent reply is noticed, warmly and without noise |
| **End card** | Submit ends on what the round achieved, not on a closing tab |
| **Work summary** | quiet tracking of reading, presence and chat, shown on the end card in time, words and tokens — next to what a Silicon Valley senior dev would cost for the same |
| **📞 Phone a friend** | a menu of friends to call on the document — the Socratic one, the devil's advocate, the assumption hunter, the fact-checker — each a lens defined as JSON anyone can edit and share |
| **Questionnaire** (experimental) | a card latched over the page that asks multiple-choice questions under a formal contract the agent can use when asked; the page stays a Markdown reader |
| **Quiz** | the questionnaire's first use: on request, a few questions on where the document and the repo actually stand — one right answer, three or four plausible fakes — so the reviewer checks they still follow what is being built |

## Why these
- **End card:** people remember an experience by its peak and its end (Kahneman, peak-end rule); seeing what your notes did feeds competence, the strongest pull games have (Ryan, Rigby & Przybylski 2006).
- **Work summary:** watching your own behaviour changes it — the reactivity of self-monitoring (Nelson & Hayes 1981) — and coverage next to time tells a read from a skim.
The price tags set the costs side by side: the tokens are usually the cheapest line on the card, the reviewer's attention the dearest.
- **Reply shine:** the reply is the variable reward already in the loop (Skinner); making it visible is enough — no urgency, no streaks, no sound by default (Chou's "white hat" drives only).
- **Phone a friend:** curiosity and autonomy (Malone; self-determination theory) for every reviewer, and a creative outlet for the explorers among them (Bartle).
Few people author while most consume (Nielsen's 90-9-1), so using a lens is one click and writing one is one JSON entry; authorship shows on the lens, which rewards the few who write them (IKEA effect, Norton, Mochon & Ariely 2012).
- **Quiz:** the agent writes as if it and the reviewer already share an understanding, but common ground has to be evidenced, not assumed (Clark & Brennan 1991).
Fluent text makes people believe they understand more than they do until they are asked (illusion of explanatory depth, Rozenblit & Keil 2002), and answering a question fixes knowledge better than rereading (testing effect, Roediger & Karpicke 2006) — so the quiz measures and strengthens at once.
- **Questionnaire:** the chat window already has one (`AskUserQuestion`) and it earns its place there; the page gets the same shape, off by default until it earns its place here too.

## How it works

### Reply shine
Today a reply flashes its card's background for 1.2 s, scrolls it into view and toasts "The agent replied."
Instead:
- The card glows softly in the accent colour and settles into a **new** dot, which stays until the card is clicked or has been in view for a moment.
- The span the reply belongs to glows once, the first time it is on screen after the reply arrived.
- In a hidden tab, the title counts unseen replies: `(2) plan.md`.
- The toast names the thread: "a3 answered".
- `prefers-reduced-motion` drops the animation and keeps the dot.
- A soft sound is a ⚙ opt-in, off by default.

### End card
Submit stops calling `window.close()` straight away; the page turns into a card that stays until you close it, with a big **Close** button so nobody has to aim at the browser tab.
Close calls `window.close()`; if the browser refuses, the card says to close the tab.
It shows what the client already knows — nothing new on the server:
- the outcome: Approved, Apply & review, or Apply silently;
- the notes by label (`💬 3 · ✏️ 2 · 🗑️ 1`), how many went mid-read, and how many replies came back;
- each mark set and how many of its marks the reviewer answered;
- the lenses run this round;
- the work summary, below.
After Apply & review it adds "Round 2 opens with the diff."; round 1's card stays beside round 2's new tab until its Close.

### Work summary
Quiet tracking in the page, shown on the end card: time, words, tokens, and — cheekily — what the same would cost from a senior dev.
It is on by default, listed in ⚙ with an off switch, and stays on this machine: the page reports to the local server; the one thing to leave it is the coverage line the agent gets at Submit (open question 12).

**Reading coverage.**
The page times each block while it is at least half on screen, not under the ⤢ panel or the comment popup, and the tab is visible and focused.
A block counts as **read** when that time fits its words at 400 words a minute or slower — well above the 238 a minute measured for silent reading of non-fiction (Brysbaert 2019) — as **skimmed** when it was seen faster, and as **unseen** otherwise.
Coverage is the share of the document's words in each state.

**Presence.**
- **reading** — the page visible and focused, with input or a new block in view within the time the blocks in view take to read, and at least two minutes;
- **in chat** — the page not focused while the chat shows activity;
- **agent working** — from the reviewer's prompt to the end of the agent's turn;
- **away** — everything else.

**Chat activity and agent turns** come from Claude Code hooks.
`UserPromptSubmit` marks chat activity and opens an agent turn; `Stop` or `StopFailure` closes the turn; an interrupted turn sends neither, so the next prompt closes it.
The hooks are `type: "command"` with `async: true` in `~/.claude/settings.json`, running `edit-md hook`: it reads the hook's JSON on stdin, finds the session's server through `<temp>/edit-md/<session_id>/server.json`, forwards the event, and exits quietly when no server runs.
A command hook rather than `type: "http"`, because an HTTP hook holds the prompt until it answers and could not know the per-session port.
`UserPromptSubmit` also fires for scheduled tasks, background agents reporting back and messages from other sessions; the docs do not say how to tell those from a typed prompt, so step 4 settles it.

**Session tokens** come from Claude Code's OpenTelemetry export.
Each `claude_code.api_request` event carries a timestamp, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd` and `session.id`; the server sums those inside the review's span.
The export goes to one fixed local URL while servers listen per session, so whichever edit-md server holds the fixed telemetry port, outside plan 08's session range of 41000–41999, receives OTLP `http/json` and files each event under its session (`<temp>/edit-md/<session.id>/telemetry.jsonl`); a later server takes the port over when that one exits.
The exporter settings are a one-time opt-in at user level — Claude Code ignores them in a repo's settings — and apply to sessions started afterwards; without them the card says "tokens: telemetry off" and counts delegated runs only.
The same export's `claude_code.active_time.total` (`user` and `cli`) cross-checks the page's own presence estimate.
`cost_usd` is Claude Code's client-side estimate, which is all the card claims.
Delegated runs report their own `usage` and `total_cost_usd` (plan 10); a lens handed off to another agent counts under that agent's own session, not on this card.

**Not used:** the session transcript, whose format the docs call internal and liable to change between versions; and the status line, whose token fields are a snapshot of the context rather than a running total, and which the VS Code extension reportedly does not run.

*Checked 2026-11-02* against code.claude.com — hooks, env-vars, sessions, statusline, monitoring-usage, headless, agent-sdk cost-tracking — for Claude Code 2.1.304.

**The yardstick** — a random senior dev from Silicon Valley; every figure is an assumption, editable in ⚙:

| | assumption | gives |
|---|---|---|
| Total compensation | $320k a year | |
| Fully loaded — benefits, office, overhead | × 1.4 | $448k a year |
| Working hours | 1,800 a year | **≈ $250 an hour** |
| Lines shipped | 50 a day (Brooks' famous figure was 10) | |
| A line | 8 h × $250 ÷ 50 | **≈ $40 a line** |

Lines are the non-blank lines of the document and of this round's diff; a plan's line is priced like a line of code, which flatters nobody.

**On the card** (figures illustrative):

```
Your time      34 min — reading 18 · chat 9 · away 7      ≈ $140
Read           78 % of 3,200 words · skimmed 15 % · unseen 7 %
Words          410 written in notes · 1,150 read in replies
This round     42 lines changed                           ≈ $1,680 by hand
The document   177 lines                                  ≈ $7,080 by hand
Tokens         1.2 M in · 38 k out                        ≈ $4 at API prices
```

### 📞 Phone a friend — lenses
In the page the menu is **📞 Phone a friend**, as in the quiz show, and each entry is a friend you call; in the contract and the code each one is a **lens**.

**A definition** is JSON, in `lenses.json`, layered exactly like `comment_labels.json`: shipped → user (`~/.claude/edit-md/`) → repo (`<git root>/.claude/edit-md/`) → session, the same id overriding, `"replace": true` dropping the layers below.
The server re-reads the files on each request, so an edit shows on the next load.

```json
{
  "lenses": [
    { "id": "assumptions", "icon": "🧱", "name": "Hidden assumptions",
      "description": "Marks what the text takes for granted without saying so.",
      "prompt": "Find each claim this document relies on but never states or justifies. Mark it; in the note say what is assumed and what breaks if it is false.",
      "author": "jcernohub" }
  ]
}
```

`description` is for the reviewer (hover); `prompt` is for the agent; `output` is `marks` (the default), `quiz` or `ask`; `author` is shown on hover.

**Shipped four:**

| lens | marks it sets |
|---|---|
| 🤔 Socratic questions | `question` — one question per weak spot, nothing answered for you |
| 😈 Devil's advocate | `counter` — the strongest objection to each decision |
| 🧱 Hidden assumptions | `assumption` — what is taken for granted, and what breaks if it is false |
| ✅ Verified facts | `verified` · `unverified` · `contradicted` — each checkable claim checked against the repo |

**Running one.**
A **📞 Phone a friend** button in the toolbar opens the menu; with text selected the lens reads only the selection, otherwise the whole document.
The page posts `lens` with the lens id and the optional range.
The server queues a `lens` event for `wait` with the prompt, the document's path, the range and the command that pushes the result.
**How it is worked is the agent's call** (review 2026-11-04): it works the lens in the session, spending its own context, or hands it off to another agent with a summary of the task and the link to the document, and that agent pushes the highlights itself.
Either way the work has the repo's context, because a lens pertains to the open document, and is read-only: it sets marks and touches no file.
The event gives the command so it works from any process: `EDIT_MD_HOME=<the server's state folder> edit-md mark <docId> --set "<name>"`, JSON on stdin. `EDIT_MD_HOME` exists today (`ServerState.cs:15`); a headless agent has a session id of its own and would not find the server without it.

The result is a mark set named after the lens, in the left pane with the other sets; running the lens again replaces its set.
The reviewer answers a mark — a Socratic question, a counter — with an ordinary note on it, which carries its mark id and is delivered like any other.
The last menu entry, **Custom…**, takes a free prompt: an ad-hoc lens, which is the page-side way to ask a seek (01d step 3).

**Editing and sharing.**
⚙ → Friends lists the effective lenses with their source.
A form edits name, icon, description and prompt; **Edit JSON** shows the raw entry.
Save writes to the user or the repo layer; a repo lens reaches the team with the next pull.
**Copy** puts one lens's JSON on the clipboard for chat.
The agent manages lenses like labels: `edit-md lenses <docId> [--set | --clear]` with JSON on stdin for the session layer, and the reviewer promotes a session lens to user or repo from ⚙.

### Questionnaire (experimental)
A card latched over the page, not part of it: the document underneath reads, selects and annotates exactly as without it, and closing the card leaves nothing in the review.
Off by default; ⚙ → Experimental → Questionnaires turns it on, per user.

**The contract** follows the shape of Claude Code's `AskUserQuestion` tool, as defined in this session (2026-11-02): questions with a short header, options with a label and a description, single or multiple select, and a free "Other" answer.

```json
{ "title": "Quiz — Document now", "kind": "quiz",
  "questions": [
    { "id": "1", "header": "Runner", "question": "Who answers a New agent send?",
      "multiSelect": false, "other": false,
      "options": [{ "label": "A new headless run", "description": "" }],
      "key": [0], "why": "…", "source": { "quote": "…" } }
  ] }
```

`kind` is `ask` or `quiz`.
An `ask` has no key, and its answers go back to whoever asked.
A `quiz` carries `key`, `why` and `source`; the server keeps them and sends each to the page only after the pick.
Options run from two to five, one more than `AskUserQuestion` allows, so a quiz fits four fakes.

**The card** sits in the bottom corner, one question at a time; keys 1–5 (when no text box has the focus; an open palette takes digits first) or a click, Enter to confirm a multiple choice.
It never blocks reading, and it folds to a chip that reopens where it left off; it folds by itself whenever the comment popup opens, whose dock it shares (plan 01's no-occlude law names it as the one exception).

**Who fills it.**
- The session agent, with `edit-md ask <docId>` and the questionnaire on stdin; the answers come back through `wait` as an `answers` event — the page's counterpart of `AskUserQuestion`. It asks when the reviewer asks for it in the chat, or on its own when a choice is better made beside the text than in the chat.
- **💡 Propose** on a decision mark, below.
- Quiz lenses, below.

With the switch off, the Quiz and Propose buttons are not there and `edit-md ask` fails with a message naming the switch.

### Propose on a decision
A decision mark has **Resolve** today, which drafts a note linked to the mark.
Next to it, **💡 Propose** asks an agent for ways to settle it.
The answer is a questionnaire of `kind: ask` docked to the mark: one question — the decision — with two to four proposals, each a label and a line of why, the recommended one first, and Other for the reviewer's own.
Picking one drafts the note Resolve would, prefilled with the choice, so the decision travels like any other note; the pick alone settles nothing.
Propose is a lens with `"output": "ask"` and id `propose`, so its prompt is edited and shared like any lens.
Why a decision is open usually lives in the conversation, so the skill's row says to work this one in the session.

### Quiz
**Quiz** in the toolbar runs a questionnaire of `kind: quiz` on where things actually stand — in the document as it reads now, or in the repository.
A quiz is a lens with `"output": "quiz"`, so it is defined, edited and shared the same way; the Quiz button lists those, Phone a friend the rest.
Shipped two: **Document now** and **Repo now**.

**Generating.**
Like any lens it goes to the agent, in the session or handed off, with the prompt, the document, the round's changes with their old text (`changes[].before`; the last-seen baseline itself is overwritten when the page loads), and read access to the git root.
It pushes `[{question, answer, distractors, why, source}]` with `edit-md ask`, with three or four distractors and `source` as a quote from the document or a file and lines.
The best distractors are what used to be true — last round's wording, a decision since reversed, the old name of a renamed class — next to near-misses: a neighbouring number, a sibling file.
The server drops malformed items, shuffles the options into a questionnaire and keeps the key; the page gets the questions and the options only.

**Answering — tips, not an exam.**
Three questions per batch by default, in the questionnaire card.
Picking reveals ✓ or ✗, the right answer, one line of why, and a jump to the source: the span in the document, or `file:line` in the repo.
Then **Next**, **Enough** or **Dispute**.

**A miss** offers **Ask about this**, which turns it into a ❓ note on the source span, so the gap reaches the agent.
**A wrong key** is what **Dispute** is for: it sends a ❓ note with the question, the key and what the reviewer believes instead.
A quiz that is wrong about the repo has found a misunderstanding on the agent's side, which is just as worth knowing.

**Score.**
The end card shows the round's result: `Quiz 4/5 · 1 disputed`.

## Steps & gates
1. **Reply shine** — after plan 02, whose threads rewrite the same cards. *Gate:* a Send-now reply on lorem glows its card and its span once; the dot stays until the card is clicked; a hidden tab's title shows `(1)`; with reduced motion nothing animates and the dot still shows.
2. **End card.** *Gate:* Submit on a lorem round with three notes, one reply and one mark set shows those counts and the outcome; the card stays until its big Close, which closes the tab.
3. **Work summary, page side.** Coverage and presence from the page, the yardstick in ⚙, the card's time, words and price lines. *Gate:* on lorem, scrolling through at a reading pace shows read near 100 %, flicking through shows skimmed, and leaving the tab counts as away; a changed hourly rate in ⚙ changes the card.
4. **Work summary, chat and tokens.** `edit-md hook`, the telemetry receiver, and both offered by `install.ps1`. *Gate:* a prompt typed in the chat mid-review counts as chat time, not away, and a background agent's report does not; with telemetry on, the card's tokens equal the sum of the review span's `api_request` events; with it off, the card says so; with no server running, a prompt goes through without a hook notice.
5. **Lens definitions and the menu.** `Server/Lenses.cs` mirrors `CommentLabels.cs`; `GET /api/docs/{docId}/lenses`; the toolbar menu; the `lens` event and its skill row. *Gate:* Hidden assumptions on lorem fills a mark set in the left pane; a second lens's set coexists with it; a lens added to the user file shows after a reload.
6. **Handing a lens off.** The command in the event; the skill's row on when to work a lens in the session and how to hand it off read-only. *Gate:* Verified facts on a plan in this repo, handed off, marks a claim `contradicted` by citing the file; the marks land in the open page; the session's context holds the hand-off, not the checking.
7. **Questionnaire, experimental.** The contract in `Server/Contracts.cs`, the card, the ⚙ switch, `edit-md ask`, the `answers` event and its skill row. *Gate:* switched off, nothing shows and `edit-md ask` fails naming the switch; switched on, an `ask` with two questions shows the card and the answers come back through `wait`; the document underneath reads and annotates as before.
8. **Propose on decisions.** *Gate:* 💡 on a decision mark in lorem docks a questionnaire with two to four proposals, the recommended one first; picking one drafts a note linked to the mark with the choice prefilled; switched off, the button is gone.
9. **Quiz, document scope** — after steps 6 and 7. *Gate:* Document now on a lorem plan edited since the last round asks three questions, at least one with last round's wording as a distractor; the page holds no key before the pick; Ask about this lands a ❓ note on the source span; the end card shows the score.
10. **Quiz, repo scope.** *Gate:* Repo now on this repo asks about a fact checkable in code and cites `file:line`; Dispute delivers a ❓ note carrying the key.
11. **Editing and sharing.** ⚙ → Friends, save to user or repo, Copy, `edit-md lenses`. *Gate:* a lens edited in the page lands in `~/.claude/edit-md/lenses.json` and runs; a repo lens shows its author on hover.
12. **Custom…** *Gate:* a free prompt from the menu produces a mark set named after the prompt's first words.

## Open — your call
1. **Results as marks only, or replies too?** → marks: they anchor, coexist, navigate, and can be answered; a lens that wants a summary adds one general reply.
2. *Settled 2026-11-04 — see Decided.*
3. **Where Phone a friend sits** — toolbar, or the left pane by the mark sets? → toolbar: calling a friend is an action; the answers live in the left pane.
4. *Settled 2026-11-04 — see Decided.*
5. *Settled 2026-11-04 — see Decided.*
6. **Ship the four, or more?** → the four; the next ones should come from use, which is what the editor is for.
7. **Quiz on demand only, or also offered?** → on demand only: the reviewer asks; an offered quiz is an exam.
8. **Options per question** → four (one right, three wrong) by default; `"options": 5` in the definition for five.
9. **Track the quiz score across rounds?** → not yet: the end card shows the round; a history only if the round score proves useful.
10. **Does the agent see quiz results?** → mid-read only what Ask about this and Dispute send; at Submit one line — the score and the missed questions — so it learns where understanding drifted.
11. **A pick on Propose — draft or send?** → draft: the pick prefills the note Resolve would make and Ctrl+Enter sends it, since the reviewer may want to add a condition.
12. **Does the agent get the coverage?** → yes, one line at Submit — the read share and the unseen sections — so it knows what went unreviewed; time and prices stay on the card.
13. **Price tags on by default?** → yes, they are the point; one ⚙ switch hides them.
14. **Hooks and telemetry on the reviewer's machine** → `install.ps1` offers both and never sets them silently; an OTLP endpoint already configured is left alone, and the card then says "tokens: telemetry goes elsewhere".

## Decided
- From the ask (2026-11-02): an end card; an arriving reply shines, positively and decently; a menu of predefined ways to respond to the document (Socratic questions, devil's advocate, induced assumptions, verified facts), built on seek and reply, defined as JSON the server serves and the client shows, editable, so keen users can hand others their ways of treating documents.
- From the follow-up (2026-11-02): the planted error resolves into a quiz the reviewer asks for — short tips, not exhausting — on the current state of the document or the repository, with the right answer and three or four plausible fakes, so it shows the reviewer is still following what is being built.
- From the follow-up (2026-11-02): the quiz implies an embedded questionnaire under a formal contract, which the agent can use when asked; the page stays a pure-ish Markdown reader, and the questionnaire is a side toy latched over it — experimental, not a mainstay, until it proves its keep as the chat's questionnaire has.
- From the follow-up (2026-11-02): a questionnaire starts from the chat or from the agent itself; a decision mark gets a button that sets an agent proposing solutions.
- From the follow-up (2026-11-02): a quiet work summary — reading, presence and chat activity — on the end card in time, words and tokens, with the cheeky yardstick of a Silicon Valley senior dev's hour and line set against the tokens burned.
- From review (2026-11-02): the lens menu is named **📞 Phone a friend**, after the quiz show.
- From review (2026-11-04): the end card stays until a manual Close, after every exit including Apply & review, and carries a big Close button, because clicking the browser tab is annoying.
- From review (2026-11-04): lenses and send buttons (plan 10) stay separate logic: their output differs and lands in different places, and a lens targets the document by contract while a send is general. A lens does not use plan 10's runner.
- From review (2026-11-04): a lens runs with the repo's context and read-only. It goes to the session agent, which decides whether to spend its own context or to hand it off with a summary of the task and the link to the document, that agent pushing the highlights.
- From review (2026-11-04): the questionnaire card stays latched over the page, as the no-occlude law's one named exception, and folds to its chip whenever the comment popup opens.
- From review (2026-11-04): no separate Seek tab; a lens's results are selectable set rows in the left pane.
- From review (2026-11-04): parked for later; not to be implemented for now, its eleven open questions unanswered.
- Not taken up from the same brainstorm: review room (focus layout), approve-unread speed bump, personal catch record, claims instead of hedges; the planted error became the quiz.
