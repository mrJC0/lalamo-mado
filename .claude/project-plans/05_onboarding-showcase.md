---
feature: onboarding-showcase
status: draft
created: 2026-10-29
---
# 05 Onboarding showcase — learn edit-md by doing

## Goal
A first-time user gets on board fast.
The help is not a manual but a real `.md` under review, so every capability is seen working, not described.

## Ideas from review (2026-10-29, lorem round 3, a1)
- **A real document in process.** A showcase `.md` edited across rounds with the diff showing; explanatory sentences can live in the diff itself — the old and new text explain what just happened. Possibly several pages, one per feature group.
- **A guided AI session.** The user is asked to do certain things through annotations; the agent approves when it sees what happened, or hints after.
- **A toggleable help overlay**, part of the regular page under a small help button: it points at the elements — toggles, draggable edges, panes, buttons — and says what each is for.
- **EN and CZ** variants of the page's buttons and texts.

## The shape (review 2026-11-18)
- **The tutorial is a review, run the way we work now** — "that's just the best possible tutorial": a skill opens `.md` pages in edit-md and the agent instructs the user to do what the system can, answering through the page as in any review.
- **Several pages, one per group of capabilities**, each saying what can be tried there; the user tries it, or skips a page that is not for them.
- **One brief page first, a table of contents**, perhaps opened from the chat only, so the user picks what to try.

## Tasks
- [ ] Work it out with `/planup` once plans 09, 15 and 16 have landed (decided 2026-11-19: their features are still moving): which pages and which capabilities each covers; the skill that opens them and the table-of-contents page; how the agent checks the user's actions from the events it receives.
- [ ] Help overlay: where the help button sits; how pointers anchor to elements; dismiss and remember.
- [ ] Localization: a string table for the page (EN default, CZ); how the language is chosen.

## Decisions / notes
- Overlaps labels-as-contract (01b): the shipped doc explaining each default label is part of what the showcase teaches.
