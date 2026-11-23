// The agent's marks: spans it highlights with a label and a note, in named sets — its decisions, one seek's findings.
// One mark at a time is focused and shows strongly; the others are a faint tint plus a tick in the right margin.

import { labelFor } from "./labels.js";
import { setSectionItems, refreshSectionItems } from "./outline.js";

const PAINTED_PER_SPAN = 5;
const PALETTE = ["#d97706", "#db2777", "#4f46e5", "#65a30d", "#0891b2"];
const layer = document.querySelector("#mark-ticks");
const page = document.querySelector("#page");
const doc = document.querySelector("#doc");
const focusStyle = document.head.appendChild(document.createElement("style"));

const sets = new Map();
const paletteColours = new Map();
let located = [];
let publishedCategories = [];
let focusedId = null;
let reviewerPicked = false;
let callbacks = { resolve: () => {}, focusChanged: () => {} };

/** `resolve(entry)` drafts an annotation on a mark; `focusChanged()` repaints. */
export function bindMarks(handlers) {
  callbacks = handlers;
}

/** Inbox messages in order: `marks` adds a set or replaces one of that name, `unmark` drops one or all. */
export function applyMarkMessage(message) {
  if (message.kind === "marks") sets.set(message.set, message.marks ?? []);
  else if (message.set == null) sets.clear();
  else sets.delete(message.set);
}

export const markCount = () => [...sets.values()].reduce((sum, marks) => sum + marks.length, 0);

/** Call with every new text index, before the outline is rebuilt; `refresh` re-places the pane items when the outline stays. */
export function locateMarks(index, { refresh = false } = {}) {
  located = [];
  for (const [set, marks] of sets) {
    for (const mark of marks) {
      const hit = findNear(index, mark);
      located.push({ mark, set, hit, range: hit && index.range(hit.start, hit.end) });
    }
  }
  for (const [i, entry] of located.entries()) {
    const paintedOverlaps = located.slice(0, i).filter((other) => other.painted && overlaps(other.hit, entry.hit)).length;
    entry.painted = !!entry.hit && paintedOverlaps < PAINTED_PER_SPAN;
  }
  if (!located.some((entry) => entry.mark.id === focusedId && entry.hit)) focusedId = null;
  if (!reviewerPicked && !focusedId) focusedId = located.find((entry) => entry.mark.focus && entry.hit)?.mark.id ?? null;
  publishToOutline();
  styleFocus();
  if (refresh) refreshSectionItems();
}

/** The mark an annotation over [start, end) answers: the focused one when it overlaps, else the first that does. */
export function markAt(start, end) {
  const overlapping = located.filter((entry) => entry.hit && overlaps(entry.hit, { start, end }));
  const entry = overlapping.find((candidate) => candidate.mark.id === focusedId) ?? overlapping[0];
  return entry && { id: entry.mark.id, set: entry.set };
}

export function markHighlights() {
  const painted = located.filter((entry) => entry.painted);
  return [
    { name: "mark-quiet", priority: -1, ranges: painted.filter((entry) => entry.mark.id !== focusedId).map((entry) => entry.range) },
    { name: "mark-focus", priority: 1, ranges: painted.filter((entry) => entry.mark.id === focusedId).map((entry) => entry.range) },
  ];
}

export function paintMarkTicks() {
  layer.replaceChildren();
  const origin = page.getBoundingClientRect();
  const right = doc.getBoundingClientRect().right - origin.left + 8;
  const perLine = new Map();
  for (const entry of located.filter((candidate) => candidate.painted)) {
    const rect = entry.range.getClientRects()[0];
    if (!rect) continue;
    const line = Math.round(rect.top);
    const slot = perLine.get(line) ?? 0;
    perLine.set(line, slot + 1);
    const tick = Object.assign(document.createElement("button"), { type: "button", className: "mark-tick", title: titleOf(entry) });
    tick.classList.toggle("focused", entry.mark.id === focusedId);
    tick.dataset.mark = entry.mark.id;
    Object.assign(tick.style, { left: `${right + slot * 7}px`, top: `${rect.top - origin.top}px`, height: `${rect.height || 18}px`, background: colourOf(entry.mark.label) });
    tick.addEventListener("click", () => toggleMarkFocus(entry.mark.id, { reveal: false }));
    layer.append(tick);
  }
}

function toggleMarkFocus(id, { reveal }) {
  reviewerPicked = true;
  focusedId = focusedId === id ? null : id;
  for (const card of document.querySelectorAll(".mark-card")) card.classList.toggle("focused", card.dataset.mark === focusedId);
  styleFocus();
  const entry = located.find((candidate) => candidate.mark.id === focusedId);
  if (reveal && entry?.range) {
    const rect = entry.range.getBoundingClientRect();
    window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: "smooth" });
  }
  callbacks.focusChanged();
}

/** A label's own colour, else one from a fixed palette — a mark must always be visible. */
function colourOf(labelId) {
  const label = labelFor(labelId);
  if (label.color && CSS.supports("color", label.color)) return label.color;
  if (!paletteColours.has(labelId)) paletteColours.set(labelId, PALETTE[paletteColours.size % PALETTE.length]);
  return paletteColours.get(labelId);
}

// The server placed each quote in the source: the rendered blocks over that span narrow the search,
// and the text before it picks the occurrence when the quote repeats there.
function findNear(index, mark) {
  const blocks = [...doc.querySelectorAll("[data-src-start]")].filter(
    (block) => Number(block.dataset.srcStart) < mark.sourceEnd && mark.sourceStart < Number(block.dataset.srcEnd),
  );
  const from = blocks.length ? index.offsetOf(blocks[0], 0) : 0;
  const to = blocks.length ? Math.max(...blocks.map((block) => index.offsetOf(block, 0) + block.textContent.length)) : index.text.length;
  const candidates = occurrencesOf(index.text, mark.quote, from, to);
  if (candidates.length === 0 && blocks.length) candidates.push(...occurrencesOf(index.text, mark.quote, 0, index.text.length));
  if (candidates.length === 0) return null;
  const prefix = squashed(mark.prefix ?? "");
  const start = candidates.reduce((best, at) => (sharedEnding(squashed(index.text.slice(Math.max(0, at - 80), at)), prefix) > sharedEnding(squashed(index.text.slice(Math.max(0, best - 80), best)), prefix) ? at : best));
  return { start, end: start + mark.quote.length };
}

function occurrencesOf(text, quote, from, to) {
  const found = [];
  for (let at = text.indexOf(quote, from); at >= 0 && at + quote.length <= to; at = text.indexOf(quote, at + 1)) found.push(at);
  return found;
}

const squashed = (text) => text.replace(/\s+/g, " ").trimEnd();

function sharedEnding(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function publishToOutline() {
  const categories = [...sets.keys()].map((set) => `marks:${set}`);
  for (const stale of publishedCategories.filter((category) => !categories.includes(category))) setSectionItems(stale, []);
  publishedCategories = categories;
  for (const [set] of sets) {
    const items = located
      .filter((entry) => entry.set === set)
      .map((entry) => {
        const label = labelFor(entry.mark.label);
        return {
          target: entry.range ? closestBlock(entry.range.startContainer) : null,
          node: card(entry),
          tone: entry.mark.label,
          sign: "◆",
          toneName: label.name,
          dot: colourOf(entry.mark.label),
        };
      });
    setSectionItems(`marks:${set}`, items, set);
  }
}

function card(entry) {
  const label = labelFor(entry.mark.label);
  const node = Object.assign(document.createElement("div"), { className: "mark-card" });
  node.dataset.mark = entry.mark.id;
  node.style.setProperty("--mark-colour", colourOf(entry.mark.label));
  node.classList.toggle("focused", entry.mark.id === focusedId);
  const head = Object.assign(document.createElement("div"), { className: "head" });
  head.append(`${label.icon} `, Object.assign(document.createElement("strong"), { textContent: label.name }));
  if (!entry.hit) head.append(Object.assign(document.createElement("span"), { className: "state orphan", textContent: "not found in text" }));
  node.append(head);
  if (entry.mark.note) node.append(Object.assign(document.createElement("div"), { className: "note", textContent: entry.mark.note }));
  node.append(Object.assign(document.createElement("div"), { className: "excerpt", textContent: entry.mark.quote }));
  if (entry.hit) {
    const resolve = Object.assign(document.createElement("button"), { type: "button", className: "resolve", textContent: "Resolve" });
    resolve.title = "Answer this mark: drafts an annotation linked to it";
    resolve.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.resolve(entry);
    });
    node.append(resolve);
    node.addEventListener("click", () => toggleMarkFocus(entry.mark.id, { reveal: true }));
  }
  return node;
}

function styleFocus() {
  const entry = located.find((candidate) => candidate.mark.id === focusedId);
  if (!entry) {
    focusStyle.textContent = "";
    return;
  }
  const colour = colourOf(entry.mark.label);
  const textColour = readableOn(colour);
  focusStyle.textContent = `::highlight(mark-focus) { background-color: ${colour}; color: ${textColour}; text-decoration: underline 2px ${textColour}; text-underline-offset: 3px; }`;
}

const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

export function readableOn(colour) {
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = colour;
  pixel.fillRect(0, 0, 1, 1);
  const [red, green, blue] = pixel.getImageData(0, 0, 1, 1).data;
  return 0.299 * red + 0.587 * green + 0.114 * blue > 150 ? "#000" : "#fff";
}

const titleOf = (entry) => [labelFor(entry.mark.label).name, entry.mark.note].filter(Boolean).join(": ");
const overlaps = (a, b) => !!a && !!b && a.start < b.end && b.start < a.end;

function closestBlock(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest("#doc [data-src-start]") ?? null;
}
