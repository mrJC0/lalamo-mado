# Onboarding — install edit-md for a user

For the AI agent (Claude Code) setting edit-md up on a user's machine.
Follow it top to bottom; every step is checkable.

## What gets installed — two places, on purpose
| where | what | size |
|---|---|---|
| `~/.claude/skills/edit-md/SKILL.md` | the personal skill — text only | ~6 KB |
| `~/.claude/bin/edit-md/` | the self-contained `edit-md` binary + `client/` (the browser page, incl. vendored mermaid) + `profiles/` (one dedicated browser profile per session, created on use, pruned after 14 idle days) + `prefs.json` (the page's settings) and `last-seen/` (the version of each document the reviewer last saw, for the diff; dropped after 30 days unseen), both kept across reinstalls + `runtimes/` (Whisper's native libraries, used only after the optional local dictation below; nearly all of it the CUDA one) | ~55 MB + ~560 MB + profile |

`~/.claude` is `%USERPROFILE%\.claude` on Windows, or `$CLAUDE_CONFIG_DIR` if set.

**Never put the binary inside `skills/`.**
Many users keep `~/.claude` as a git repo of their harness, synced to a remote, with `skills/` tracked.
A binary there becomes a 55 MB blob that gets committed and pushed with their rules and skills.
`skills/edit-md/` holds only `SKILL.md`; it calls the binary as `"$HOME/.claude/bin/edit-md/edit-md"`.
In such a repo `bin/` must be git-ignored (an allowlist `.gitignore` starting with `/*` already does that); the installer reports `binaryIgnoredByGit` and warns if not — it never edits the user's `.gitignore`.

Nothing else is installed: **no rules**, no settings, no hooks, no CLAUDE.md edits.
The installer commits nothing; if `~/.claude` is a git repo, tracking `skills/edit-md/SKILL.md` is the user's call.
Do not copy this repo's `.claude/` contents (e.g. `project-planner-repo`) — that is tooling for developing edit-md, not for using it.
The same goes for `scripts/deploy-dev.ps1` and the `/edit-md-dev` skill it writes: the dev build, for whoever works on edit-md itself.

The skill is user-invoked only (`disable-model-invocation: true`): the user types `/edit-md <path>`; the agent never starts a review on its own.
Its base copy is `onboarding/skills/edit-md/SKILL.md` in this repo.

## Prerequisites
- `git`, PowerShell 7 (`pwsh --version`), and the .NET 10 SDK (`dotnet --list-sdks` lists a `10.x`) — needed to build, not to run.
- Chrome, Chromium or Edge for the dedicated review window (one window per session, docs as tabs, never the user's everyday window); otherwise the default browser is used.
  `EDIT_MD_BROWSER` overrides the pick (a browser path, or `default`).
- Dictation into comments (🎤, Ctrl+D) needs Chrome or Edge, a microphone and the internet: the browser sends the audio to its speech service. The dedicated profile has the microphone pre-allowed for the review page, so Chrome does not ask; without the speech API the 🎤 stays hidden.
- Windows, macOS or Linux; Windows is the tested platform so far.

If one is missing, tell the user what to install and stop.

## Install
1. Get the repo if it is not already checked out: `git clone https://github.com/mrJC0/lalamo-mado.git`.
2. From the repo root: `pwsh onboarding/install.ps1`.
   Options: `-ToolHome <dir>` for the binary (default `<ClaudeHome>/bin/edit-md`; the installed `SKILL.md` is rewritten to match), `-ClaudeHome <dir>` for a non-default config dir, `-Rid <rid>` to build for another platform, `-Ref <commit or tag>` to install that commit, built in a temporary git worktree with its own installer, rather than the checkout as it stands.
   It stops any running edit-md, publishes the binary into `<ToolHome>`, writes `SKILL.md`, and removes a `bin/` that older installs left inside the skill folder.
3. Check its JSON output:
   - `skillFiles` is exactly `["SKILL.md"]`;
   - `selfCheck` starts with `edit-md —`;
   - `binaryIgnoredByGit` is `true` (or `null` when `~/.claude` is not a git repo).
4. If `~/.claude` is a git repo: `git -C ~/.claude status --short` should show at most `skills/edit-md/` holding `SKILL.md` — never `bin/`.

## Optional: local dictation (Whisper on this PC)
Research, opt-in: ask the user, and install only on a yes.
Ask in these words or close to them:
> Chrome's dictation sends your voice to Google and mishears Czech and project terms. edit-md can also transcribe on this PC with Whisper: about 2 GB to download (1.7 GB more for the larger model). With an NVIDIA GPU it takes under a second per sentence; without one it runs on the CPU and is slow, about 12 s for a 7 s sentence. Install it?

On a yes: `pwsh onboarding/install-whisper.ps1` from the repo root, with `-LargeV3` if they want the larger model too, and `-ToolHome` as for `install.ps1`.
It fetches the turbo model into `<ToolHome>/whisper/models/` and, where an NVIDIA GPU is present, NVIDIA's three CUDA 12 runtime DLLs into `<ToolHome>/whisper/cuda12/`, every file SHA-256 checked; the GPU needs a driver of 576 or newer.
Check its JSON: each `models[].result` is `downloaded` or `kept`, and `cuda` says `installed for <GPU>` or why it was skipped.
Then the review page shows a `Chrome` / `Local` badge beside CZ/EN, and ⚙ holds the engine and the model and says whether Local runs on the GPU.
Uninstall: delete `<ToolHome>/whisper/`; the badge disappears.

## Prebuilt binaries (none yet)
Today the binary is built on the user's PC (step 2), which needs the .NET 10 SDK.
No binary is published to any repo or registry yet.
Build-time configuration stays deliberately nil: the page is tailored at run time (`serve --client`), paths come from install options.

## Make the session see it
- Claude Code picks up a new personal skill live, in the running session.
- If the output says `"needsReloadSkills": true` (the `skills/` folder did not exist before), the user runs `/reload-skills`.
- If `/edit-md` still does not show up, tell the user to reload (in VS Code: reload the window, or start a new session).
- A personal skill wins over a project-level skill of the same name.

## Smoke test
Ask the user to run `/edit-md samples/demo.md` from this repo (or any `.md`): the page opens in the browser, a selected sentence + **Send now** wakes the agent, and the reply appears under the annotation.

## Update and uninstall
- Update: `git pull`, then `pwsh onboarding/install.ps1` again.
  It overwrites `~/.claude/bin/edit-md/` — including `client/` — so a user's tailored page belongs in its own folder, used via `serve --client <dir>` or `EDIT_MD_CLIENT_DIR`.
- Uninstall: `"$HOME/.claude/bin/edit-md/edit-md" stop`, then delete `~/.claude/bin/edit-md/` and `~/.claude/skills/edit-md/`.
