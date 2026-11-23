// Labels are the reviewer's contract with the agent: the server layers the lists, this module paints and picks them.
// A chip shows only its icon; hovering names it at once and rolls out the description after the ⚙ delay.

import { digitOfLabel, keyOf } from "./hotkeys.js";
import { preference } from "./prefs.js";

const DEFAULT_DESCRIPTION_DELAY_SECONDS = 1;
const FALLBACK = [{ id: "comment", icon: "💬", name: "Comment" }];

const colours = document.head.appendChild(document.createElement("style"));
const tip = Object.assign(document.createElement("div"), { className: "chip-tip", hidden: true, role: "tooltip" });
let labels = FALLBACK;
let tipTimer;

export function setLabels(list) {
  labels = list?.length ? list : FALLBACK;
  const rules = [];
  labels.forEach((label, index) => {
    label.paint = null;
    if (!label.color || !CSS.supports("color", label.color)) return;
    label.paint = `label-${index}`;
    const strike = label.highlight === "remove" ? ` text-decoration: line-through; text-decoration-color: ${label.color};` : "";
    rules.push(`::highlight(${label.paint}) { background-color: color-mix(in srgb, ${label.color} 30%, transparent);${strike} }`);
  });
  colours.textContent = rules.join("\n");
}

export const allLabels = () => labels;
export const labelFor = (id) => labels.find((label) => label.id === id) ?? { id, icon: "•", name: id };
export const labelIdsOf = (annotation) => (annotation.labels?.length ? annotation.labels : [annotation.label]);
export const highlightNames = () => labels.filter((label) => label.paint).map((label) => label.paint);

export function highlightOf(ids) {
  const picked = ids.map(labelFor);
  const coloured = picked.find((label) => label.paint);
  if (coloured) return coloured.paint;
  const special = picked.find((label) => label.highlight);
  return special ? `anno-${special.highlight}` : "anno";
}

export const tagOf = (label) => `[${label.icon} ${label.id}]`;

/**
 * Click picks one label; Shift+click adds or drops one; Ctrl+click puts its tag into the comment; Alt+click adds at once.
 * Chips never take focus on a click, so the comment box keeps its caret for the tag.
 */
export function renderChips(container, usable, { onPick, onToggle, onTag, onCommit }) {
  container.replaceChildren(
    ...usable.map((label) => {
      const chip = Object.assign(document.createElement("button"), { type: "button", textContent: label.icon });
      chip.dataset.label = label.id;
      const digit = digitOfLabel(label.id);
      if (digit) chip.append(Object.assign(document.createElement("sup"), { className: "chip-digit", textContent: digit }));
      chip.setAttribute("aria-label", label.name);
      if (label.paint) chip.style.setProperty("--label-color", label.color);
      chip.addEventListener("mousedown", (event) => event.preventDefault());
      chip.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey) return onTag(label);
        if (event.shiftKey) onToggle(label.id);
        else onPick(label.id);
        if (event.altKey) onCommit();
      });
      chip.addEventListener("pointerenter", () => showTip(chip, label));
      chip.addEventListener("focus", () => showTip(chip, label));
      chip.addEventListener("pointerleave", hideTip);
      chip.addEventListener("blur", hideTip);
      return chip;
    }),
    tip,
  );
}

export function markChips(container, selected) {
  for (const chip of container.querySelectorAll("button[data-label]")) chip.setAttribute("aria-pressed", String(selected.includes(chip.dataset.label)));
}

export function insertTag(field, label) {
  const { value, selectionStart: start, selectionEnd: end } = field;
  const before = start > 0 && !/\s/.test(value[start - 1]) ? " " : "";
  const after = end < value.length && !/\s/.test(value[end]) ? " " : "";
  field.setRangeText(`${before}${tagOf(label)}${after}`, start, end, "end");
  field.focus();
}

function showTip(chip, label) {
  clearTimeout(tipTimer);
  tip.replaceChildren(
    Object.assign(document.createElement("strong"), { textContent: label.name }),
    Object.assign(document.createElement("div"), { className: "more", textContent: label.description ?? "" }),
    Object.assign(document.createElement("div"), {
      className: "more keys",
      textContent: `Shift+click adds it to the others · Ctrl+click puts it in the text · Alt+click adds at once${keyOf(`label.${label.id}`) ? ` · ${keyOf(`label.${label.id}`)} picks it, again drops it` : ""}`,
    }),
  );
  tip.classList.remove("expanded");
  tip.style.left = `${chip.offsetLeft}px`;
  tip.style.top = `${chip.offsetTop + chip.offsetHeight + 4}px`;
  tip.hidden = false;
  tipTimer = setTimeout(() => tip.classList.add("expanded"), preference("labels.descriptionDelaySeconds", DEFAULT_DESCRIPTION_DELAY_SECONDS) * 1000);
}

function hideTip() {
  clearTimeout(tipTimer);
  tip.hidden = true;
}
