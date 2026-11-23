// Learning from corrections (plan 09 step 4): spoken words the reviewer replaced by hand, or an accepted ✨ Fix changed, are offered to the glossary.
// Never remembered silently; the rows live only while the comment is open, and adding it drops what was not taken.

import { alreadyCorrects, canRememberForRepo, remember } from "./glossary.js";
import { preference } from "./prefs.js";

// Long enough to let a word be typed out before it is offered.
const SETTLE_MS = 800;
const LAYERS = [
  { id: "repo", name: "This repo", whom: "this repo" },
  { id: "user", name: "Me", whom: "you" },
];

/** `list` holds the rows under the comment box; `sources` is the box's spoken-or-typed tracker. */
export function bindRemembering({ field, sources, list, onRemembered, onProblem }) {
  const rows = new Map();
  const settled = new Set();
  let fromFix = [];
  let timer = 0;

  field.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, SETTLE_MS);
  });
  list.addEventListener("keydown", (event) => {
    // Enter in a row's field would submit the comment form; only Ctrl+Enter adds the comment.
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) event.preventDefault();
  });

  function refresh() {
    const wanted = preference("dictation.offerCorrections", true);
    const offered = !wanted ? [] : [...fromFix, ...sources.corrections()].filter((pair) => !settled.has(keyOf(pair)) && !alreadyCorrects(pair.heard, pair.meant));
    const keys = new Set(offered.map(keyOf));
    for (const [key, row] of rows) if (!keys.has(key)) dropRow(key, row);
    for (const pair of offered) if (!rows.has(keyOf(pair))) addRow(pair);
    list.hidden = !rows.size;
  }

  function addRow(pair) {
    const key = keyOf(pair);
    const heard = phraseField(pair.heard, "What the dictation wrote — widen it to more words when it is an everyday word");
    const meant = phraseField(pair.meant, "What you meant");
    const row = el("div", { className: "remember-row" }, [
      "Remember “", heard, "” → ", meant, ":",
      ...LAYERS.filter((layer) => layer.id !== "repo" || canRememberForRepo()).map((layer) =>
        el("button", { type: "button", textContent: layer.name, onclick: () => keep(key, row, heard.value.trim(), meant.value.trim(), layer) })),
      el("button", { type: "button", className: "remember-drop", textContent: "×", title: "Not a mishearing — do not offer it again for this comment", onclick: () => settle(key, row) }),
    ]);
    rows.set(key, row);
    list.append(row);
  }

  async function keep(key, row, heard, meant, layer) {
    if (!heard || !meant) return;
    try {
      await remember(heard, meant, layer.id);
    } catch (error) {
      onProblem(error.message);
      return;
    }
    settle(key, row);
    onRemembered(`Remembered “${heard}” → ${meant} for ${layer.whom}: the next dictation corrects it.`);
    refresh();
  }

  function settle(key, row) {
    settled.add(key);
    dropRow(key, row);
    list.hidden = !rows.size;
  }

  function dropRow(key, row) {
    rows.delete(key);
    row.remove();
  }

  return {
    /** Corrections an accepted fix made, offered at once beside the typed ones. */
    offer(pairs) {
      fromFix = [...fromFix, ...pairs];
      refresh();
    },
    /** A comment opens or closes: nothing carries over. */
    clear() {
      clearTimeout(timer);
      fromFix = [];
      settled.clear();
      for (const [key, row] of rows) dropRow(key, row);
      list.hidden = true;
    },
  };
}

const keyOf = ({ heard, meant }) => `${heard.toLowerCase()}\n${meant}`;

function phraseField(value, title) {
  const field = el("input", { type: "text", value, title, size: Math.max(4, value.length) });
  field.addEventListener("input", () => (field.size = Math.max(4, field.value.length)));
  return field;
}

function el(tag, props, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
