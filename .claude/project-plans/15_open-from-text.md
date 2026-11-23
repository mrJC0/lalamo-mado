---
feature: open-from-text
status: draft
created: 2026-11-11
---
# 15 Open from text — labels that open the file a passage points at

## Goal
Pick a label on a passage that names a file — a path, a class, "the runner" — and the file opens: in an editor at its line, or its folder with the file selected (asked 2026-11-11).
The AI finds the exact file from the context.
The programs are a short list picked ahead and resolved once, so a pick opens at once and only installed ones show — my reading of "prefetch these variants", which stood in review 2026-11-18.
The list is lean and the user's own: two ship, and any other program is added by the agent on request (review 2026-11-18).
VS Code opens it in the window the session runs in, also with several windows open (asked 2026-11-11).

## Open labels
A label with an `open` field is an open label: picking it opens, nothing more — no draft, no highlight, no card, nothing in Submit.
The top bar's status message says what happened: *Opened RunPlan.cs:20 in VS Code*, *finding the file…*, or why it could not.
A comment typed with it is a hint for the finding ("the test for this"), not a remark.
This departs from 01's "labels merely prefix the comment": an open label is an action, kept in the labels contract so it layers, overrides and takes a hotkey like any other.

```jsonc
{ "id": "open-code", "icon": "📝", "name": "Open in VS Code", "hotkey": 7,
  "description": "Open the file this points at, at its line, in the session's VS Code window.",
  "open": {
    "windows": { "exe": ["code.cmd"], "args": ["{sessionFolder}", "-g", "{path}:{line}:{column}"], "iconFrom": "{exeDir}\\..\\Code.exe" },
    "macos":   { "exe": ["code"],     "args": ["{sessionFolder}", "-g", "{path}:{line}:{column}"] },
    "linux":   { "exe": ["code"],     "args": ["{sessionFolder}", "-g", "{path}:{line}:{column}"] }
  } }
```

- **`exe`** lists candidates, the first that resolves wins: a name on `PATH`, an absolute path, or a glob (`%ProgramFiles%\JetBrains\JetBrains Rider *\bin\rider64.exe`, newest first).
- **Placeholders:** `{path}` the file, long form; `{line}` and `{column}`, 1 when unknown; `{folder}` its folder; `{exeDir}` the resolved program's folder; `{sessionFolder}` the folder `serve` started in (`ReviewServer.cs:37`), which is the session's VS Code workspace.
- **Prefetched:** programs resolve once when the server starts and again when a labels file changes, not per request — a glob over Program Files is slow.
- **Missing:** a label with no entry for this OS, or whose program does not resolve, is left out of the page, and `edit-md labels` lists it under `missing`. It is not a problem: another PC may have the program.
- Layered like every label (07): shipped → user → repo → session, by id.

**Shipped** — these two only (review 2026-11-18), plus 🔧 *Add a program*, which asks the agent for any other (review 2026-11-19) and is a hidden gateway under ⚙ (plan 17):

| label | Windows | macOS / Linux (not tried) |
|---|---|---|
| 📝 Open in VS Code, Alt+7 | `code.cmd {sessionFolder} -g {path}:{line}:{column}` | `code`, the same |
| 📂 Show in folder, Alt+8 | `explorer.exe /select,{path}` | `open -R {path}` / `xdg-open {folder}` |

Not shipped: the OS default app — for an `.exe`, `.ps1` or `.bat`, "open" means run.

**Any other program is the user's,** added by the agent: asked "add Rider" — in the chat or a comment — it finds the program on this PC, works out how it takes a line (`--line {line}`, `-n{line}`, `:{line}`), writes an `open` label into `~/.claude/edit-md/comment_labels.json` (the repo's file when asked), and checks with `edit-md labels` that it resolves.
The skill documents the `open` contract so the agent knows its shape; beside 🔧 *Add a program*, nothing else ships for it.
This PC's user file gets 🧩 Rider and DataGrip that way, as the behaviour's first real use; Notepad++ is dropped.

**In the page:** open chips sit apart from the others in the popup, after a thin rule, and a click fires instead of toggling.
In the stamp palette (13) they are tiles like any other; armed, an Alt+click opens instead of stamping, and the drafts stay as they were.

## Where the file comes from
**The AI, by default**, chosen as Send now's row chooses (plan 10).
All off — the session, which knows the conversation ("the runner" → `DelegatedRuns.cs`).
New agent — a run, blank or with the repo, on the picked model.
A stamp has no row in front of it, so it takes the ticks saved with 💾.
- **The session** gets an `open` event with the label, the passage and the comment, finds the file, and runs `edit-md launch <docId> --to <id> <path>[:line[:column]]`, or `--none "<why>"` naming the candidates when it cannot choose.
- **A run** gets the same request with one system line: *find the file the reviewer points at and return it as `open`; do not answer*. `RunPlan.cs`'s schema gains `open: {path, line?, column?}`, and the server launches it.

**⚡ The server's literal path, as another button.**
The server alone can get it wrong, so a plain pick never goes to it (review 2026-11-11).
When the passage — the quote, or the block's text for a block pick — holds a link or path-like token that resolves to exactly one existing file, each open chip in the popup gains a small ⚡ part, its hover naming the target: `⚡ src/LalamoMado/Server/RunPlan.cs:20`.
A click on ⚡ opens that target in the chip's program at once; the AI is not asked and the session is not woken.
A token resolves relative to the document's folder, the git root or the session folder; a bare file name (`RunPlan.cs`) counts when exactly one file `git ls-files` lists has it.
A line comes from `:42`, `#L42`, `#L42-L51` or a link's anchor.
Stamps have no ⚡: they go to the AI.

## Opening in the session's window
What VS Code 1.145.2 does with `code {sessionFolder} -g {path}:{line}:{column}` (`windowsMainService.ts` 596–606 and 676–685, `windowsFinder.ts`):
- **A folder already open in a window:** that window is reused, and the files passed with it open there.
- **A file alone:** the window whose workspace contains it, the longest folder winning; with none, the last focused window. A file outside the workspace — another repo, the scratchpad — would go wherever you last clicked, which is why the folder is passed.
- **`-r`** only stops a new window; it picks nothing.
- **Limit:** a session window holding a `.code-workspace` has no single folder to match, and passing the folder would open a new window. Such a setup overrides the label in its repo or user file and drops `{sessionFolder}`.

Nothing in the session's process names its window: there is no `VSCODE_IPC_HOOK_CLI`, an integrated terminal's handle to its own window, only the main process's `VSCODE_IPC_HOOK`, shared by every window. The folder is the handle.

## Program icons
An open label shows its program's own icon — VS Code's, Rider's — taken from the installed program when it is prefetched, so no artwork ships and none goes stale (asked in review 2026-11-11).
- **Server:** on Windows the icon is extracted from the resolved program (`PrivateExtractIcons` at 64 px, sharp enough for the palette tiles; `ExtractAssociatedIcon` gives only 32 px), cached as a PNG and served at `GET /api/icons/<hash>.png`; the label as the page gets it carries `image`. A `.cmd` carries no icon, so the label names the source in `iconFrom`. Windows-only calls sit behind an OS check, as 01 asks of per-OS concerns.
- **Page:** one `labelIcon(label)` helper in the five places that print `label.icon` today: the popup chips (`labels.js:47`), the palette tile and the icon at the cursor (`stamp.js:77`, `:56`), the annotations list (`app.js:299`) and mark heads (`marks.js:171`).
- **The emoji stays required:** the agent reads it, it is the fallback, and `[📝 open-code]` tags are text.
- **Any label** may take an image of its own, `"image": "icons/x.svg"` relative to its label file, through the same helper; send buttons too (`sendrow.js:78`).
- **macOS / Linux:** the `.app`'s `.icns` through `sips`, the `.desktop` file's `Icon=` — postponed with the rest of cross-OS; the emoji shows meanwhile.

## Safety
- The server runs only a label's program, never through a shell of its own, the path as one argument (`BrowserLauncher.StartDetached`, moved where both can use it).
- The path must name an existing file, in long form (plan 10 learnt 8.3 paths break `--add-dir`).
- Through a `.cmd` such as VS Code's `code.cmd`, `cmd.exe` parses the line, so a path holding `& | < > ^ % !` or `"` is refused there; plan 10 hit the same shim with line breaks.
- Any file on disk may open: an editor on a file is harmless, and the default app, which could run it, does not ship.

## Steps & gates
0. *Dropped (review 2026-11-19):* no separate probe session. How a program opens is each label's own business, carried in its command and description, so each is checked when it is added — the shipped two at step 1's gate, any other when the agent adds it. Your preference: an open happens in the background; a window flashing in the taskbar is enough, and it never takes the focus. A label can change that for itself if it proves inconvenient.
1. **Labels, programs, the session finds it.** `open` in `Server/CommentLabels.cs` with resolution and `missing`; `Server/Openers.cs` fills the placeholders and launches; the page's open request and the `open` event; `edit-md launch` with `--none` (`Cli/Commands.cs`); in `onboarding/skills/edit-md/SKILL.md` the `open` row and how to add a program; open chips apart in the popup (`client/app.js`, `client/app.css`); the status message; the three shipped labels in `client/comment_labels.json` — 📝, 📂 and 🔧 *Add a program*, the last a hidden gateway of plan 17 (➕ is *Insert here*, 🧩 the added programs). Launched from the server as a background process, with another VS Code window focused: `code -g` on a repo file lands in the session's window, `code <session folder> -g` on a scratchpad file too; whether the window only flashes in the taskbar; `explorer /select,` on a path with a space, through `ArgumentList` quoting.
   *Gate:* in this plan, 📝 on `RunPlan.cs:20` makes the session open it in the session's window on line 20; 📝 on "the delegated runner", with no path, opens `DelegatedRuns.cs`; 📂 shows Explorer with the file selected; `--none` puts its reason in the status message; asked in the chat, the agent adds Rider and DataGrip to your user file and both open on the line; with Rider renamed away its label is gone and listed `missing`; a `.cmd` label refuses a path with `&`. `roundtrip.mjs` with a fake program that records its arguments.
2. **⚡ and runs.** The server's finder for literal paths behind ⚡ (`Server/Openers.cs`, `client/app.js`); a run's `open` in `Server/RunPlan.cs`.
   *Gate:* ⚡ shows on `src/LalamoMado/Server/RunPlan.cs:20` with that target in its hover and opens it with no event for `wait`; no ⚡ on "the delegated runner" or on a name two tracked files share; with New agent ticked, a Haiku blank run opens `DelegatedRuns.cs` and `wait` never returns. `OpenersTests` cover the token forms and the refusals.
3. **Stamps and hotkeys.** An armed open label opens through the AI on Alt+click (`client/stamp.js`); Alt+7 and Alt+8.
   *Gate:* Alt+7, then Alt+click on a block naming a file opens it, and the drafts list is unchanged.
4. **Program icons.** Extraction, the cache and `/api/icons` (`Server/Openers.cs` or its own class), `iconFrom`, `image` on any label and send button, `labelIcon` in the five places.
   *Gate:* the popup chips, palette tiles and cursor icon show VS Code's, Rider's and DataGrip's own icons; a label with `"image"` shows its file; with extraction failing, the emoji shows.

## Checked 2026-11-11
- From this session's shell, a child of the Claude Code extension under VS Code 1.145.2: `code -r -g "…\src\LalamoMado\Server\RunPlan.cs:20:5"` exited 0, and `RunPlan.cs` opened in the session's window (you confirmed). Whether it landed on line 20 is not yet confirmed.
- That shell has `VSCODE_IPC_HOOK` (the main process's) and `VSCODE_PID`, and no `VSCODE_IPC_HOOK_CLI`.
- VS Code 1.145.2 source, `src/vs/platform/windows/electron-main/`: `windowsFinder.ts` and `windowsMainService.ts`, as quoted under *Opening in the session's window*.
- On this PC: Rider at `C:\Program Files\JetBrains\JetBrains Rider 2026.1.2\bin\rider64.exe`, Notepad++ under Program Files; no Total Commander.

## Decided
- From review (2026-11-19): **adding a program is a shipped label**, 🔧 *Add a program* (➕ is *Insert here*, 🧩 the added programs), after 📝 and 📂, sent like any comment; its description tells the agent to find the program, work out its line argument, write the open label into `~/.claude/edit-md/comment_labels.json` and check it with `edit-md labels`. No popup entry and no event kind of its own. The skill's list of default labels grows by the three.
- From plan 17's review (2026-11-20): 🔧 *Add a program* is a **hidden gateway** — `"hidden": true`, left out of the chips and the 🏷 palette, reached from ⚙ or by asking the agent; plan 17 is built first, so it ships that way.
- From review (2026-11-19): **no probe session ahead of code** — see step 0; opens stay in the background.
- From review (2026-11-18): **only VS Code and Show in folder ship**; the list is kept lean and the user's own, with no programs hard-coded beyond those two. Any other is added by the agent on request — the infrastructure and the agent's behaviour make that easy and expected. Rider and DataGrip are this user's.
- From review (2026-11-18): **an open leaves nothing behind** — no highlight, card or Submit entry, only the status message.
- From review (2026-11-18): **Alt+7 and Alt+8** for VS Code and Show in folder, next to 👍 5 and 👎 6.
- From the ask (2026-11-11): comment kinds that make the AI open what a passage points at — the file, or its folder with the file in it — in programs picked and resolved ahead; the AI finds the exact file from the context.
- From chat (2026-11-11): with several VS Code windows open, it opens in the one the session runs in.
- From review (2026-11-11): the AI finds the file by default; the server's literal path is another button, ⚡, shown only when exactly one path resolves, its target on hover — the server alone can get it wrong.
- From review (2026-11-11): open labels show their program's own icon, as step 4 — taken from the installed program, not shipped.
