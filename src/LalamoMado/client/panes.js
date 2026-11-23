// Both panes resize by dragging their inner edge; a double-click hands the width back (the left pane then fits its content again).

import { preference, savePreference } from "./prefs.js";

const layout = document.querySelector("#layout");
const rootStyle = document.documentElement.style;
const widthKey = (pane) => `pane.${pane}.width`;
const clampWidth = (width) => Math.round(Math.min(Math.max(width, 160), window.innerWidth * 0.45));

/** Call once the preferences are loaded. */
export function restorePaneWidths() {
  for (const edge of document.querySelectorAll(".pane-edge")) {
    const remembered = preference(widthKey(edge.dataset.pane), null);
    if (remembered) rootStyle.setProperty(`--${edge.dataset.pane}-width`, remembered);
  }
}

for (const edge of document.querySelectorAll(".pane-edge")) {
  const pane = edge.dataset.pane;
  const widthProperty = `--${pane}-width`;

  edge.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    edge.setPointerCapture(event.pointerId);
    edge.classList.add("dragging");
  });
  edge.addEventListener("pointermove", (event) => {
    if (!edge.hasPointerCapture(event.pointerId)) return;
    const box = layout.getBoundingClientRect();
    const width = pane === "left" ? event.clientX - box.left : box.right - event.clientX;
    rootStyle.setProperty(widthProperty, `${clampWidth(width)}px`);
  });
  edge.addEventListener("lostpointercapture", () => {
    edge.classList.remove("dragging");
    const width = rootStyle.getPropertyValue(widthProperty);
    if (width) savePreference("pc", widthKey(pane), width);
  });
  edge.addEventListener("dblclick", () => {
    rootStyle.removeProperty(widthProperty);
    savePreference("pc", widthKey(pane), null);
  });
}
