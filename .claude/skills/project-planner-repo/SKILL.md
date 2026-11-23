---
name: project-planner-repo
description: >-
  Per-repo feature planning as reviewable markdown at `.claude/project-plans/NN_<feature>.md` — hammer out
  the detail with /show-md-for-comment BEFORE writing code, track implementation state as it lands,
  graduate built-in plan-mode plans out of the global ~/.claude/plans into the repo, and delete a
  plan once its behaviour is validated. Invoke when the user says "plan this feature", "start a
  plan", "set up project-planner here", "graduate this plan into the repo", "reconcile the plan", or
  "the plan is done / validated". First run in a repo sets up .claude/project-plans/ and its CLAUDE.md.
argument-hint: "[setup | new <feature> | graduate | reconcile | validate <nn>]"
---

# project-planner — hammer features out as repo plans before coding

A plan is reviewable markdown you refine to detail before implementing, keep honest as code lands, then retire once proven.
The unit is `<plans>/NN_<feature>.md`, where `<plans>` is this repo's plans dir (resolved below) and `NN` is a zero-padded sequence for ordering.

## Resolve the plans dir — first thing, every run (dependable + fork-portable)
`root` = `git rev-parse --show-toplevel`; no repo → stop.
`<plans>` is the first of these that holds, so any clone or fork self-configures without edits:
1. `root/.claude/project-plans/` if it already exists;
2. else `root/project-plans/` if it already exists;
3. else, first-run default: `root/project-plans/` when `root` is itself a `.claude` tier (harness dirs — `skills/`, `rules/`, `settings.json` — sit at `root` with no nested `root/.claude/`), otherwise `root/.claude/project-plans/`.
Read `<plans>/CLAUDE.md` if present before acting — it overrides everything below for this repo.

## First run — set up the repo (once)
Resolve the repo root (`git rev-parse --show-toplevel`); no repo → stop.
Create `<plans>/` and seed `<plans>/CLAUDE.md` from three setup questions:
- **Commit each review iteration?** If yes, every `/show-md-for-comment` round becomes its own small commit of just the plan file, on a per-plan branch `plan/<feature>` — record the choice and branch pattern in CLAUDE.md.
- **Numbering or location overrides?** Anything non-default is recorded in CLAUDE.md.
Then install the routing rule: `/import-lib-rule use-project-planner` (or `/setup-project-planner` to land the rule and the skill together) — but skip this when `<plans>/CLAUDE.md` forbids it, as a `.claude`-tier repo must, since a user-scope rule loads in every project and leaks the routing globally.

## Author a plan — via /planup
Don't reimplement the planning pass: `/planup <feature>` researches under plan mode and reviews the draft with `/show-md-for-comment` before the normal approval.
With the project-planner rule active, `/planup` lands its plan in the canonical `<plans>/NN_<feature>.md` (this shape) instead of the ghostly global plan file:
```markdown
---
feature: <feature>
status: draft
created: <YYYY-MM-DD>
---
# NN <feature>

## Goal

## Tasks
- [ ] ...

## Decisions / notes
```
`status` moves draft → active → landed → validated; approve to implement only once it holds.
If commit-per-iteration is on, each applied `/planup` review round is a small commit of just the plan file on its `plan/<feature>` branch.
The granularity is deliberate: the per-iteration history is a record to mine later for how these plan files actually get worked.

## Graduate a plan made without /planup
A raw plan-mode plan (no `/planup`) lands in the global `plansDirectory` (default `~/.claude/plans/`), where project-scoping is unreliable — don't leave it there.
`graduate` → promote the latest global plan file into a canonical `<plans>/NN_<feature>.md` (assign `NN`, `status: active`), then offer to delete the global copy.
An auto-capture hook on `ExitPlanMode` is possible, but its firing is version-dependent and the plan's tool-input field name is unconfirmed — verify with a one-line echo hook before trusting it; guidance-graduation is the default.

## Keep state honest — auto-adjust as impl lands
As you implement against a plan, tick its `Tasks` and bump `status` in the same change; the plan tracks reality, not intention.
`reconcile` → re-scan the repo (files present, tests, commits naming the feature) and correct the checkboxes and `status` to match what actually landed.

## Fade once validated
`validate <nn>` → confirm the behaviour holds, set `status: validated`, then **delete** the plan file so it fades into git history (retrievable via `git log`), keeping `<plans>/` to live work only.
Deletion is approval-gated — never remove a plan without an explicit yes.

## House rules this obeys
harness-rules-are-super-brief · claude-harness-verify-online · no-comments · tone-brief-no-marketing · audience-senior-dotnet · git-friendly-harness-md.
