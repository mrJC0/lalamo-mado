// The label stamp: arm a label from the palette, with Alt+digit or a double tap, and every click on a block tags it with no text.
// Stamping lasts until an Alt tap, Esc or 🏷; the comment popup pauses it. A double tap re-arms the last label.

import { digitOfLabel, keyOf, labelOnDigit, onHotkeysChange, pressed, tapOf } from "./hotkeys.js";
import { altOnly, bindBlocks, pointerPosition, repaintOutline } from "./blocks.js";
import { readableOn } from "./marks.js";

const ICON_OFFSET = 14;
const DOUBLE_TAP_MS = 500;
const palette = document.querySelector("#label-palette");
const grid = palette.querySelector(".palette-grid");
const description = palette.querySelector(".palette-description");
const icon = document.querySelector("#armed-icon");
const toggle = document.querySelector("#stamp-toggle");

let armed = null;
let lastArmedId = null;
let callbacks = { labels: () => [], popupOpen: () => false, inReplyBox: () => false, pickInPopup: () => {}, onBlocked: () => {} };

/** `labels()` lists the labels; `pickInPopup(label)` marks a chip; `onBlocked()` says why the palette stayed shut. */
export function bindStamps(handlers) {
  callbacks = handlers;
  bindBlocks({ outlineColour: () => armed?.color ?? null, stamping, altTapped: dropPick });
  nameToggleKey();
  onHotkeysChange(nameToggleKey);
}

function nameToggleKey() {
  const key = keyOf("stamp.palette");
  toggle.title = `Label stamp: pick a label, then click blocks until you tap Alt or press Esc${key ? ` — ${key} opens it; twice repeats the last label` : ""}`;
}

export const armedLabel = () => armed;

/** A label is armed and no popup pauses it: a click on a block stamps. */
export const stamping = () => !!armed && !callbacks.popupOpen();

/** Call when the comment popup opens or closes: it pauses stamping, and closing it resumes. */
export function syncStamping() {
  const active = stamping();
  icon.hidden = !active;
  document.body.classList.toggle("stamping", active);
  toggle.setAttribute("aria-pressed", String(!!armed));
  repaintOutline();
}

/** @returns whether a label was armed. */
export function dropPick() {
  if (!armed) return false;
  armed = null;
  syncStamping();
  return true;
}

/** @returns whether the palette was open. */
export function closePalette() {
  if (palette.hidden) return false;
  palette.hidden = true;
  return true;
}

function arm(label) {
  armed = label;
  lastArmedId = label.id;
  icon.textContent = label.icon;
  icon.dataset.name = label.name;
  icon.style.setProperty("--label-color", label.color ?? "");
  icon.style.setProperty("--label-text", label.color ? readableOn(label.color) : "");
  placeIcon(pointerPosition());
  syncStamping();
}

function placeIcon({ x, y }) {
  Object.assign(icon.style, { left: `${x + ICON_OFFSET}px`, top: `${y + ICON_OFFSET}px` });
}

function openPalette() {
  description.textContent = "";
  grid.replaceChildren(...callbacks.labels().map(tile));
  palette.hidden = false;
  grid.querySelector(".tile:not(.greyed)")?.focus();
}

function tile(label) {
  const node = Object.assign(document.createElement("button"), { type: "button", className: `tile${label.point ? " greyed" : ""}` });
  node.dataset.label = label.id;
  if (label.color) node.style.setProperty("--label-color", label.color);
  node.append(
    Object.assign(document.createElement("span"), { className: "tile-icon", textContent: label.icon }),
    Object.assign(document.createElement("span"), { className: "tile-name", textContent: label.name }),
  );
  const digit = digitOfLabel(label.id);
  if (digit) node.append(Object.assign(document.createElement("span"), { className: "tile-digit", textContent: digit }));
  const showDescription = () => {
    description.textContent = label.point ? `${label.description ?? label.name} An insertion says nothing without text, so it cannot be stamped.` : label.description ?? label.name;
  };
  node.addEventListener("pointerenter", showDescription);
  node.addEventListener("focus", showDescription);
  node.addEventListener("click", () => {
    if (label.point) return;
    closePalette();
    arm(label);
  });
  return node;
}

const typing = () => document.activeElement?.matches?.("textarea, input, select") ?? false;

function togglePalette() {
  if (closePalette()) return;
  if (!callbacks.popupOpen() && !typing()) openPalette();
}

// Digits go by the key's position, so the Czech layout's digit row works.
const digitOf = (event) => {
  const match = /^Digit([1-9])$/.exec(event.code);
  return match ? Number(match[1]) : null;
};

const labelOnKey = (digit) => callbacks.labels().find((candidate) => candidate.id === labelOnDigit(digit)?.id);

// The digit of the label already armed takes it back, as a second press on a picked chip does.
function armOrDrop(label) {
  if (armed?.id === label.id) dropPick();
  else arm(label);
}

function onAltDigit(digit) {
  const label = labelOnKey(digit);
  if (!label || callbacks.inReplyBox()) return;
  if (callbacks.popupOpen()) callbacks.pickInPopup(label);
  else if (!typing()) armOrDrop(label);
}

const plainKey = (event) => !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

// A tap is its modifiers, Ctrl and Shift unless ⚙ rebinds it, pressed and released with nothing else in between: Ctrl+Shift+Enter is not one.
const held = new Set();
let tapSpoiled = false;
let lastTapAt = -Infinity;

function spoilTap() {
  tapSpoiled = true;
  lastTapAt = -Infinity;
}

// The palette opens on the first tap, so a plain tap stays instant and a double tap shows it for a moment.
function onTap(at) {
  const isDouble = at - lastTapAt < DOUBLE_TAP_MS;
  lastTapAt = isDouble ? -Infinity : at;
  const label = isDouble ? callbacks.labels().find((candidate) => candidate.id === lastArmedId && !candidate.point) : null;
  if (label && !callbacks.popupOpen() && !typing()) {
    closePalette();
    arm(label);
  } else togglePalette();
}

function trackTap(event) {
  const tapKeys = tapOf("stamp.palette");
  if (!tapKeys) return;
  const isTapKey = tapKeys.includes(event.key);
  if (event.type === "keydown") {
    if (!isTapKey) spoilTap();
    else {
      if (held.size === 0) tapSpoiled = false;
      held.add(event.key);
    }
    return;
  }
  if (!isTapKey) return;
  if (held.size === tapKeys.length && !tapSpoiled) {
    tapSpoiled = true;
    onTap(event.timeStamp);
  }
  held.delete(event.key);
}

document.addEventListener("keydown", (event) => {
  trackTap(event);
  if (pressed(event, "stamp.palette")) {
    event.preventDefault();
    onTap(event.timeStamp);
    return;
  }
  const digit = digitOf(event);
  if (digit === null) return;
  if (!palette.hidden) {
    event.preventDefault();
    [...grid.querySelectorAll(".tile:not(.greyed)")].find((node) => node.querySelector(".tile-digit")?.textContent === String(digit))?.click();
  } else if (altOnly(event)) {
    event.preventDefault();
    onAltDigit(digit);
  } else if (plainKey(event) && stamping() && !typing() && labelOnKey(digit)) {
    // While stamping no box takes the digits, so a plain one switches the label.
    event.preventDefault();
    armOrDrop(labelOnKey(digit));
  }
});
document.addEventListener("keyup", trackTap);
document.addEventListener("mousedown", spoilTap);
window.addEventListener("blur", () => held.clear());
document.addEventListener(
  "mousemove",
  (event) => {
    if (armed) placeIcon({ x: event.clientX, y: event.clientY });
  },
  { passive: true },
);
palette.addEventListener("click", (event) => {
  if (event.target === palette) closePalette();
});
toggle.addEventListener("click", () => {
  if (callbacks.popupOpen()) callbacks.onBlocked();
  else if (!dropPick()) togglePalette();
});
