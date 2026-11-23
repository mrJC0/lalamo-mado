---
name: show-case-recently-build-features
description: Showcase what was just built — a try-it page with each new feature, what it does and how to use it, opened in edit-md so the reviewer validates each by using it in the very page. Use when the user runs /show-case-recently-build-features [plan number | commit range].
argument-hint: "[plan number | commit range]"
disable-model-invocation: true
---

# show-case-recently-build-features — validate the build by using it

after-action-md shows the diff; this shows the behaviour.
Write one page that says what was built and how to try it, open it in edit-md, and read the reviewer's labels as verdicts.

## 1. Find what was built
- An argument (`$ARGUMENTS`) naming a plan → the tasks it has landed; a commit or range → what those commits built.
- Else: what this conversation built, the uncommitted diff, and plans in `.claude/project-plans/` with `status: landed` — landed is built but not yet validated.
- Else: what the last showcase left failed or untried.
- List features as the reviewer meets them — in the page, the CLI or the agent loop.
A refactor with nothing to try stays out.

## 2. Run the new build
The page must run the code just built, or the round validates the old one.
- Client-only change: copy the changed files from `src/LalamoMado/client/` to `~/.claude/bin/edit-md/client/`; a reload picks them up and the server keeps running.
- Server or CLI change: `pwsh onboarding/install.ps1` builds and installs, and stops the server, so `serve` again.

## 3. Write the page
Write it to the scratchpad as `showcase-<YYYY-MM-DD>[-N].md`, a throwaway that stays out of the repo.
Keep the shape of the rounds that worked:
- Front matter: `round`, `date`, and `built: [<feature> (plan NN), …]`.
- `# edit-md — showcase <date>`, then `## What to test`, as the project rule asks: what this round covers, which build the page runs, and how to give a verdict.
The verdict: stamp each feature's heading `good` when it works as written, `reject` or a comment when it does not.
- One numbered `###` per feature naming its plan, then:
  - one line on what it does and why;
  - numbered steps with the exact keys, clicks and ⚙ settings, each with its default;
  - **Expected:** what the reviewer should see.
- Make the page its own testbed: put the sentence to select, the block to stamp or the line to double-click right there in the step that needs it.
- A feature outside the page — CLI, server, agent side — gets the command to run, or what to do in the page and what the agent answers.
- Lead with what the last round left failed or untried.

## 4. Open it
edit-md is user-only, so the Skill tool can't run it: Read `~/.claude/skills/edit-md/SKILL.md` by its absolute path and follow it with the page's path as its argument.
Run the review loop it describes until the reviewer submits.

## 5. Read the verdicts
- `good` → validated; nothing to do.
- `reject` or a comment → a punch-list item: fix it, run the new build again, and answer in the thread or open the next round with only what is left.
- A plan whose every feature passed is ready for project-planner's `validate`: offer it, and delete the plan only on the reviewer's yes.
- Commit nothing; say what passed, what failed and what was never tried.
