// The skill picker: completion for skill names, opened where you write. It lists the repo's and your own skills, split, and inserts `/name ` at the cursor.
// Its key from ⚙'s Hotkeys, Ctrl+Space by default, or the button opens it; typing `/` is only text.

import { onHotkeysChange, pressed, withKey } from "./hotkeys.js";

const overlay = document.querySelector("#skill-picker");
const search = overlay.querySelector("input");
const note = overlay.querySelector(".skill-note");
const lists = { repo: overlay.querySelector('[data-source="repo"] .skill-list'), user: overlay.querySelector('[data-source="user"] .skill-list') };
const sections = { repo: overlay.querySelector('[data-source="repo"]'), user: overlay.querySelector('[data-source="user"]') };
const description = overlay.querySelector(".skill-description");

let skills = [];
let callbacks = { fetchSkills: async () => [], runIsBlank: () => false, onInserted: () => {} };
let targetBox = null;
let selected = null;

/**
 * @param boxes the text boxes it completes in: { textarea, skillsButton }
 * @param runIsBlank whether the current ticks start a blank run, where skills do not load
 * @param onInserted a name went into a box, around the keyboard
 */
export function bindSkillPicker({ boxes, fetchSkills, runIsBlank, onInserted }) {
  callbacks = { fetchSkills, runIsBlank, onInserted };
  const nameButtons = () => {
    for (const box of boxes) box.skillsButton.textContent = withKey("/ Skills", "skills.open", " · ");
  };
  onHotkeysChange(nameButtons);
  nameButtons();
  for (const box of boxes) {
    box.skillsButton.addEventListener("mousedown", (event) => event.preventDefault());
    box.skillsButton.addEventListener("click", () => openSkillPicker(box));
    box.textarea.addEventListener("keydown", (event) => {
      if (!pressed(event, "skills.open")) return;
      event.preventDefault();
      openSkillPicker(box);
    });
  }
}

/** The known skills a text names as `/name`; a bare word never counts. */
export function skillsNamedIn(text) {
  const named = new Set();
  for (const [, name] of text.matchAll(/(?:^|\s)\/([\w:-]+)/g)) {
    const known = skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
    if (known) named.add(known.name);
  }
  return [...named];
}

export async function loadSkills() {
  try {
    skills = await callbacks.fetchSkills();
  } catch {
    skills = [];
  }
}

async function openSkillPicker(box) {
  targetBox = box;
  await loadSkills();
  search.value = "";
  note.textContent = callbacks.runIsBlank() ? "Skills do not load in a blank run: the name travels as text." : "A name that starts the comment fires in a new agent's run; anywhere else it is text.";
  overlay.hidden = false;
  renderList();
  search.focus();
}

/** @returns whether the picker was open. */
export function closeSkillPicker() {
  if (overlay.hidden) return false;
  overlay.hidden = true;
  targetBox?.textarea.focus();
  return true;
}

/** Keeps the names holding the typed characters in order; word starts and runs rank higher. */
export function matchScore(name, query) {
  if (!query) return 0;
  const lower = name.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const character of query.toLowerCase()) {
    const at = lower.indexOf(character, from);
    if (at < 0) return null;
    if (at === 0 || /[-_:]/.test(lower[at - 1])) score += 3;
    if (at === previous + 1) score += 2;
    previous = at;
    from = at + 1;
  }
  return score - name.length / 100;
}

function renderList() {
  const query = search.value.trim();
  const shown = skills.map((skill) => ({ skill, score: matchScore(skill.name, query) })).filter(({ score }) => score !== null);
  const best = shown.filter(({ skill }) => !skill.shadowed).reduce((top, entry) => (top === null || entry.score > top.score ? entry : top), null);
  selected = null;
  for (const source of ["repo", "user"]) {
    const here = shown.filter(({ skill }) => skill.source === source);
    lists[source].replaceChildren(...here.map(({ skill }) => item(skill, skill === best?.skill)));
    sections[source].querySelector(".skill-count").textContent = here.length;
  }
  if (!best) description.textContent = query ? "No skill matches." : "No skills found.";
}

function item(skill, isBest) {
  const notYetRun = skill.userOnly && !skill.ran;
  const node = Object.assign(document.createElement("button"), { type: "button", className: `skill-item${skill.shadowed ? " shadowed" : ""}${notYetRun ? " user-only" : ""}`, textContent: skill.name });
  node.dataset.name = skill.name;
  if (skill.shadowed) node.title = "Shadowed: your own skill of this name wins";
  else if (notYetRun) node.title = `User-only: the agent cannot start it. Type /${skill.name} in the chat once; after that the agent can follow it from a comment.`;
  else if (skill.ran) node.title = "Run in this session: the agent can follow it from a comment.";
  node.addEventListener("pointerenter", () => select(node, skill));
  node.addEventListener("click", () => insert(skill));
  if (isBest) select(node, skill);
  return node;
}

function select(node, skill) {
  overlay.querySelector(".skill-item.selected")?.classList.remove("selected");
  node.classList.add("selected");
  selected = skill;
  const extras = [skill.shadowed && "Shadowed: your own skill of this name wins.", skill.userOnly && (skill.ran ? "Only you can start this one; it has run in this session, so the agent can follow it." : `Only you can start this one: type /${skill.name} in the chat once, then the agent can follow it.`)].filter(Boolean);
  description.replaceChildren(
    Object.assign(document.createElement("strong"), { textContent: `/${skill.name}` }),
    Object.assign(document.createElement("p"), { textContent: skill.description ?? "No description." }),
    ...extras.map((text) => Object.assign(document.createElement("p"), { className: "muted", textContent: text })),
  );
}

function step(by) {
  const items = [...overlay.querySelectorAll(".skill-item")];
  if (items.length === 0) return;
  const at = items.findIndex((node) => node.classList.contains("selected"));
  const next = items[(at + by + items.length) % items.length];
  select(next, skills.find((skill) => skill.name === next.dataset.name && next.classList.contains("shadowed") === !!skill.shadowed));
  next.scrollIntoView({ block: "nearest" });
}

function insert(skill) {
  const field = targetBox.textarea;
  const { selectionStart: start, selectionEnd: end, value } = field;
  const before = start > 0 && !/\s/.test(value[start - 1]) ? " " : "";
  field.setRangeText(`${before}/${skill.name} `, start, end, "end");
  callbacks.onInserted(targetBox);
  closeSkillPicker();
}

search.addEventListener("input", renderList);
search.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    event.preventDefault();
    step(1);
  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    event.preventDefault();
    step(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (selected) insert(selected);
  }
});
overlay.addEventListener("click", (event) => {
  if (event.target === overlay) closeSkillPicker();
});
