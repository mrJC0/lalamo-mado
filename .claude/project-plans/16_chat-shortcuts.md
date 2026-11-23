---
feature: chat-shortcuts
status: draft
created: 2026-11-16
---
# 16 Chat shortcuts — every chat one click away in the top bar

## Goal
With several queries running in the right pane, getting back to one chat means scrolling cards (asked 2026-11-16).
Every chat you have had in the page gets a chip in a strip inside the top bar; a click opens it in the thread panel.
A chat appears without a bump; a chip, once shown, keeps its place, and only which chats are shown changes (amended 2026-11-16).
📌 marks a chat as important: it stays at the front and is never pushed out.
"Top panel" is the top bar itself: it is mostly blank, so the chips go into it, not a second row (review 2026-11-18).

## What a chat is
A thread (02's reply threads, `threadFor` at `app.js:374`) you sent into with Send now, or that has at least one agent reply.
Drafts, and annotations sent in a silent group that got no reply, are not chats.

**Its activity** is the last time you came back to it: a send into it (the Send now of its first annotation, or a follow-up), or opening it in the thread panel or the small card.
A thread you never touched — the agent's own (`r<seq>`), or a reply to a silent group — takes the agent's first reply as its activity until you do.
Agent replies otherwise never count: only what you do changes the strip.

**Annotations gain `sentAt`**, set where Send now and Send drafts mark them sent (`sendMidRead`, `app.js:628`); today an annotation records no send time.
Ones restored from before fall back to `editedAt`.
Follow-ups already carry `at` (`app.js:453`).

## The strip
- **Slots:** chips have one fixed width, so the strip holds a whole number of slots for the bar's free width.
- **Positions stay:** a shown chip never moves.
  A new chat takes the next free slot, left to right; with none free, it takes the slot of the least active shown chat, which goes under `+N ▾`.
- **Returning** to a hidden chat — picking it under `+N ▾`, or opening or sending into it from the right pane — puts it into the least active chip's slot the same way.
- **Replies change nothing:** a reply to a hidden chat leaves the row as it is; `+N ▾` shows ● while one of its chats has an unread reply.
- **`+N ▾`** sits at the row's right end and lists the hidden chats, most active first; it is absent while every chat has a slot.
- **Width change:** a wider bar fills the new slots with the most active hidden chats; a narrower one drops the least active, and the rest keep their left-to-right order.
  The bar's free width changes with the window and with the bar's own buttons — *Apply silently* appearing, *Send drafts* growing its count; a slot is dropped only when a chip would no longer fit.
- **Chip:** the label icon(s) and the first ~28 characters of your comment, else the quote, else *From the agent*.
  Hover shows the whole comment, the id and lines, and the time of your last send.
- **State:** ⏳ while it waits — your latest send is newer than its latest reply, or a run is answering or waiting; ● a reply you have not opened; nothing once settled.
  The chat open in the thread panel has an accent outline; one whose run may edit carries the panel's red, as `.may-edit` does.
- **Click** opens the thread panel on it (`openThreadPanel`, `thread.js:55`) and clears ●.
  Opening the thread any other way — the panel's ⤢ or Reply, the small card — clears it too.
- **Empty:** the strip shows nothing until the first chat; the bar looks as today.

## Pin
📌 in the thread panel's head toggles it; on a chip, 📌 shows on hover.
Pinning moves the chip into the pinned group at the row's left end, before a thin rule — the one move you make on purpose; unpinning returns it to the first free slot after the rule.
A pinned chip never gives up its slot; with every slot pinned, new and returning chats stay under `+N ▾`.

## Where it lives in the page
- **Markup:** `<nav id="chats">` inside `#bar` in `index.html`, in place of its `.spacer` — after the file name and *Changes*, before the status message and *🏷 · + General · Send drafts*. It takes the flexible width the spacer takes today.
- **Height:** none added — the bar keeps its one row and `--bar-height`, so the panes, heading scroll margin, ⚙, `underTheBar()` (`floating.js:15`) and the popup's free top (`popup.js:41`) are untouched.
- **The status message** (`#banner`) shares that width: see *Open*, 5.
- **Narrow windows:** under 860 px, where the panes stack, the strip keeps at least `+N ▾`, so every chat stays one click and a pick away.
- **State:** pins, slot positions, the last-opened time per thread (for ● and activity) and `sentAt` persist with the drafts in `save()` (`app.js:84`) — per server instance, as drafts are; nothing on the server.
- **Code:** the strip in its own `client/chats.js`, fed by `app.js` with the chat list and given `openThreadPanel`; the 📌 toggle and an on-open callback in `thread.js`.

## Steps & gates
1. **The strip.** `sentAt` and activity; the slots and their swaps; `client/chats.js` with chips, state markers, `+N ▾`; layout variables and the two measurements.
   *Gate* (`tests/e2e/roundtrip.mjs`, next to the reply-thread checks at ~`:594`), at a width of three slots: no strip before the first send; Send now on a1, a2, a3 → a1 a2 a3; a4 → a4 a2 a3, a1 under `+N ▾`; a reply to a1 changes no slot and puts ● on `+N ▾`; a1 picked from `+N ▾` → a4 a1 a3, the panel open on it, ● gone; a follow-up on a3 shows ⏳ until answered and moves nothing; a loose agent reply joins by its time; widening to four slots brings back a2 in the fourth; the bar stays one row high; slots survive reloading the tab.
2. **Pin.** 📌 in the panel head and on chip hover; persisted.
   *Gate:* pin a3 → a3 | a4 a1, a2 under `+N ▾`; returning to a2 takes a4's or a1's slot, whichever is less active, never a3's; unpin a3 → it takes the first free slot after the rule.

## Decided
- Plan 17 landed 2026-11-20: this plan's two settings are entries in `SettingsRegistry` (`Server/Settings.cs`), so ⚙, its search and `edit-md settings` show them without more code; the code that acts on them listens with `onPreferenceChange`.
- From review (2026-11-19): **opening a chat is a ⚙ setting**, *Opening a chat counts as coming back*, **off by default** — only a send counts. With it on, opening a hidden chat from the right pane, the panel or `+N ▾` gives it a slot.
- From review (2026-11-19): **the agent's own threads get a chip** (`r<seq>`, replies to a silent group), their activity the agent's first reply until you touch them; a ⚙ setting, on by default. Such a chip flashes once as it lands and carries 🤖 before its title for as long as it is shown; hovering the 🤖 says *Started by the agent* and the thread's first line.
- From review (2026-11-19): **no ×**; 📌 is the one action on a chip, and an action you take on purpose needs no setting.
- From review (2026-11-19): **a *Last active* order** joins `#order`, on the same key as the strip; drafts sort by their last edit. More orders are welcome.
- From review (2026-11-19): **the status message covers the strip's right end** while it is up; the slots stay as they are.
- Landed beside this plan (2026-11-19): a double-click on a card's background — anywhere off the text itself, the empty end of a line included — opens its chat; ⤢ is a larger target; the right pane's head lost its *Annotations* heading and count, the order sits on its own line under the ticks, so the pane can stay thin; a reply already on its way cannot be sent again — *Send* reads *Sending…* until it is accepted, after a busy session let one follow-up go three times; a *Compact* tick shows one line per card; a chat's highlight in the document opens the large panel, the small card being a ⚙ switch, off by default. The small card therefore no longer counts among the usual ways to open a chat.
- Tried in the showcase (2026-11-20) and passed: the double-click off the text, the thinner head, and the send guard on cards and follow-ups.
- From the showcase (2026-11-20): a question the session has not answered yet shows a small moving ●●● *waiting for the answer 0:12* on its card and in its chat until the answer comes; a separate run keeps its own *answering…* — built.
- From the ask (2026-11-16): a chat can be marked important and gets a shortcut in the top panel.
- From the ask (2026-11-16): the top panel lists every chat without a bump, ordered by when you sent your answers.
- From chat (2026-11-16), amending the order: a shown chip keeps its place; only visibility changes, and a chat you come back to that has no slot takes the least active chat's.
- From review (2026-11-18): the strip goes into the top bar, which is mostly blank, not a second row under it.
