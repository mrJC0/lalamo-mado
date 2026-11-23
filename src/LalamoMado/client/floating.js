// A box floating over the page: it moves by any empty spot, resizes from any edge, and keeps its place for this PC, session or document.
// Its Place button lights up once it was actually moved or resized, and opens the menu that keeps or resets the place.

import { preference, savePreference } from "./prefs.js";

const page = document.querySelector("#page");
const bar = document.querySelector("#bar");
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const MARGIN = 12;
const SCOPES = ["pc", "session", "document"];
const everyKey = new Set();

export const documentColumn = () => page.getBoundingClientRect();
export const underTheBar = () => bar.getBoundingClientRect().bottom + MARGIN;
export const lowerThirdHeight = () => Math.max(MIN_HEIGHT, Math.round(window.innerHeight / 3) - MARGIN);
export const lowerThirdTop = () => window.innerHeight - lowerThirdHeight() - MARGIN;
export const COLUMN_MARGIN = MARGIN;

export function resetAllFloatingBoxes() {
  for (const key of everyKey) for (const scope of SCOPES) savePreference(scope, key, null);
}

/**
 * @param keys the preference keys this box may keep its place under
 * @param dockedBox where it sits until a place is kept
 * @param notDragFrom selector of what a press on must not move the box, beyond the controls every box has
 */
export function placedBox(element, { keys, dockedBox, notDragFrom = "" }) {
  const placeToggle = element.querySelector(".place-toggle");
  const placeMenu = element.querySelector(".place-menu");
  const undraggable = ["button, textarea, input, select, .place-menu, .pop-edge", notDragFrom].filter(Boolean).join(", ");
  let shownKey = keys[0];
  let settledBox = null;
  for (const key of keys) everyKey.add(key);

  function closeMenu() {
    const wasOpen = !placeMenu.hidden;
    placeMenu.hidden = true;
    placeToggle.setAttribute("aria-expanded", "false");
    return wasOpen;
  }

  function currentBox() {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
  }

  function applyBox({ left, top, width, height }) {
    Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  function settle(box) {
    applyBox(box);
    settledBox = currentBox();
    placeToggle.classList.remove("changed");
  }

  function markIfMoved() {
    const now = currentBox();
    placeToggle.classList.toggle("changed", Object.keys(now).some((side) => Math.abs(now[side] - settledBox[side]) > 1));
  }

  function followPointer(event, reshape) {
    event.preventDefault();
    const handle = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY, box: currentBox() };
    handle.setPointerCapture(event.pointerId);
    const move = (moved) => applyBox(clampToViewport(reshape(origin.box, moved.clientX - origin.x, moved.clientY - origin.y)));
    handle.addEventListener("pointermove", move);
    handle.addEventListener(
      "lostpointercapture",
      () => {
        handle.removeEventListener("pointermove", move);
        markIfMoved();
      },
      { once: true },
    );
  }

  element.addEventListener("pointerdown", (event) => {
    if (!placeMenu.hidden && !event.target.closest(".place-menu, .place-toggle")) closeMenu();
    if (event.target.closest(undraggable)) return;
    followPointer(event, (start, dx, dy) => ({ ...start, left: start.left + dx, top: start.top + dy }));
  });
  placeToggle.addEventListener("click", () => {
    if (closeMenu()) return;
    placeMenu.hidden = false;
    placeToggle.setAttribute("aria-expanded", "true");
  });
  for (const edge of element.querySelectorAll(".pop-edge")) {
    edge.addEventListener("pointerdown", (event) => followPointer(event, (start, dx, dy) => resizedBox(start, edge.dataset.edge, dx, dy)));
  }
  window.addEventListener("resize", () => {
    if (!element.hidden) applyBox(clampToViewport(currentBox()));
  });

  return {
    place(key) {
      shownKey = key;
      closeMenu();
      settle(clampToViewport(preference(key, null) ?? dockedBox()));
    },
    keep(scope) {
      closeMenu();
      settle(currentBox());
      savePreference(scope, shownKey, settledBox);
    },
    reset() {
      closeMenu();
      for (const scope of SCOPES) savePreference(scope, shownKey, null);
      settle(dockedBox());
    },
    closeMenu,
  };
}

function clampToViewport({ left, top, width, height }) {
  const ceiling = underTheBar();
  const fittedWidth = Math.min(Math.max(width, MIN_WIDTH), window.innerWidth - 2 * MARGIN);
  const fittedHeight = Math.min(Math.max(height, MIN_HEIGHT), window.innerHeight - ceiling - MARGIN);
  return {
    left: Math.round(Math.min(Math.max(left, MARGIN), window.innerWidth - fittedWidth - MARGIN)),
    top: Math.round(Math.min(Math.max(top, ceiling), window.innerHeight - fittedHeight - MARGIN)),
    width: Math.round(fittedWidth),
    height: Math.round(fittedHeight),
  };
}

// A west or north edge moves the box's near side while its far side stays put.
function resizedBox(start, edges, dx, dy) {
  const box = { ...start };
  if (edges.includes("e")) box.width = start.width + dx;
  if (edges.includes("s")) box.height = start.height + dy;
  if (edges.includes("w")) {
    box.left = Math.min(start.left + dx, start.left + start.width - MIN_WIDTH);
    box.width = start.left + start.width - box.left;
  }
  if (edges.includes("n")) {
    box.top = Math.min(start.top + dy, start.top + start.height - MIN_HEIGHT);
    box.height = start.top + start.height - box.top;
  }
  return box;
}
