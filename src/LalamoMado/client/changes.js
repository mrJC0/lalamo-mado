// What changed since the reviewer last saw the doc, from the server's block diff.
// The document only shows where — a bar beside an added or changed block, a tick where blocks were removed; the left pane shows what each said before.

import { setSectionItems } from "./outline.js";

const layer = document.querySelector("#change-marks");
const page = document.querySelector("#page");
const doc = document.querySelector("#doc");
const toggle = document.querySelector("#changes-toggle");
const KINDS = { added: ["+", "Added"], changed: ["~", "Changed"], removed: ["−", "Removed"] };
let located = [];
let marksShown = true;

/** Call with the freshly rendered document, before the outline is rebuilt. */
export function setChanges(changes) {
  const blocks = [...doc.querySelectorAll("[data-src-start]")].map((element) => ({
    element,
    start: Number(element.dataset.srcStart),
    end: Number(element.dataset.srcEnd),
  }));
  located = changes.map((change) => ({ change, target: blockOf(blocks, change) }));
  setSectionItems(
    "changes",
    located.map(({ change, target }) => ({
      target,
      node: card(change, target),
      beforeTarget: change.kind === "removed",
      tone: change.kind,
      sign: KINDS[change.kind][0],
      toneName: KINDS[change.kind][1].toLowerCase(),
    })),
  );
  toggle.hidden = located.length === 0;
  toggle.textContent = `Changes (${located.length})`;
}

export function paintChangeMarks() {
  layer.replaceChildren();
  if (!marksShown || located.length === 0) return;
  const origin = page.getBoundingClientRect();
  const gutter = doc.getBoundingClientRect().left - origin.left - 16;
  for (const { change, target } of located) {
    const mark = Object.assign(document.createElement("div"), { className: `chg-mark ${change.kind}`, title: KINDS[change.kind][1] });
    if (change.kind === "removed") {
      const top = target ? boxOf(target).getBoundingClientRect().top : doc.getBoundingClientRect().bottom + 8;
      Object.assign(mark.style, { left: `${gutter - 4}px`, top: `${top - origin.top - 6}px` });
    } else {
      const rect = boxOf(target).getBoundingClientRect();
      Object.assign(mark.style, { left: `${gutter}px`, top: `${rect.top - origin.top}px`, height: `${rect.height}px` });
    }
    layer.append(mark);
  }
}

// The smallest rendered block holding the change: a tight list item has no <p>, so its <li> stands in.
function blockOf(blocks, { kind, srcStart, srcEnd }) {
  const holds = kind === "removed" ? (b) => b.start <= srcStart && srcStart < b.end : (b) => b.start <= srcStart && srcEnd <= b.end;
  return blocks.filter(holds).sort((a, b) => a.end - a.start - (b.end - b.start))[0]?.element ?? null;
}

// Fenced code carries its offsets on <code>; the bar spans the whole <pre>.
const boxOf = (element) => element.closest("pre") ?? element;

function card(change, target) {
  const [sign, name] = KINDS[change.kind];
  const node = Object.assign(document.createElement("div"), { className: `change ${change.kind}` });
  const head = Object.assign(document.createElement("div"), { className: "head" });
  head.append(Object.assign(document.createElement("span"), { className: "sign", textContent: sign }), name);
  node.append(head);
  if (change.kind !== "removed" && target) {
    const now = boxOf(target).textContent.replace(/\s+/g, " ").trim();
    node.append(Object.assign(document.createElement("div"), { className: "now", textContent: now }));
  }
  if (change.before) {
    node.append(Object.assign(document.createElement("div"), { className: "before", textContent: change.before, title: change.before }));
  }
  node.addEventListener("click", () => reveal(target));
  return node;
}

function reveal(target) {
  if (!target) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    return;
  }
  const box = boxOf(target);
  box.scrollIntoView({ block: "center", behavior: "smooth" });
  restartFlash(box);
}

function restartFlash(element) {
  element.classList.remove("chg-flash");
  void element.offsetWidth;
  element.classList.add("chg-flash");
}

toggle.addEventListener("click", () => {
  marksShown = !marksShown;
  toggle.setAttribute("aria-pressed", String(marksShown));
  paintChangeMarks();
});
