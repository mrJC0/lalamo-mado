// Hold Alt and point at the document: the block under the pointer gets an outline, and Alt+click acts on that whole block.
// While a stamp is armed the outline follows the pointer without Alt.
// A block is anything rendered with data-src-start: a paragraph, a heading, a list item, a table row, a code block, a diagram. A cell is not one: a row is the smallest part of a table.

const BLOCK = "#doc [data-src-start]:not(td, th)";
const OUTLINE_GAP = 3;
const outline = document.querySelector("#block-outline");
const page = document.querySelector("#page");

let pointer = { x: 0, y: 0 };
let altDown = false;
// Alt pressed and released with no key or click in between.
let altTapping = false;
let callbacks = { outlineColour: () => null, stamping: () => false, altTapped: () => {} };

/** `outlineColour()` tints the outline, null for the default; `stamping()` shows it without Alt; `altTapped()` fires on an Alt tap. */
export function bindBlocks(handlers) {
  callbacks = handlers;
}

const outlineWanted = () => altDown || callbacks.stamping();

// AltGr reports as Ctrl+Alt, and on the Czech layout it types characters.
export const altOnly = (event) => event.altKey && !event.ctrlKey;
export const blockAt = (element) => element?.closest?.(BLOCK) ?? null;
export const enclosingBlock = (block) => block.parentElement?.closest(BLOCK) ?? null;
export const pointerPosition = () => pointer;

export function repaintOutline() {
  const block = outlineWanted() ? blockAt(document.elementFromPoint(pointer.x, pointer.y)) : null;
  outline.hidden = !block;
  if (!block) return;
  const origin = page.getBoundingClientRect();
  const box = block.getBoundingClientRect();
  Object.assign(outline.style, {
    left: `${box.left - origin.left - OUTLINE_GAP}px`,
    top: `${box.top - origin.top - OUTLINE_GAP}px`,
    width: `${box.width + 2 * OUTLINE_GAP}px`,
    height: `${box.height + 2 * OUTLINE_GAP}px`,
    borderColor: callbacks.outlineColour() ?? "",
  });
}

function setAltDown(down, { tapped = false } = {}) {
  if (altDown === down) return;
  altDown = down;
  // Alt changes what a click does; the page says so while it is down.
  document.body.classList.toggle("alt-down", down);
  repaintOutline();
  if (tapped) callbacks.altTapped();
}

document.addEventListener(
  "mousemove",
  (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    // A key-up lost to another window shows here: the next move has no Alt.
    if (altDown !== altOnly(event)) setAltDown(altOnly(event));
    else if (outlineWanted()) repaintOutline();
  },
  { passive: true },
);
// Alt alone would put the focus on the browser's menu when it goes up.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Alt") {
    altTapping = false;
    return;
  }
  event.preventDefault();
  if (!altOnly(event)) return;
  if (!altDown) altTapping = true;
  setAltDown(true);
});
document.addEventListener("keyup", (event) => {
  if (event.key !== "Alt") return;
  event.preventDefault();
  setAltDown(false, { tapped: altTapping });
  altTapping = false;
});
document.addEventListener("mousedown", () => (altTapping = false), true);
window.addEventListener("blur", () => {
  altTapping = false;
  setAltDown(false);
});
window.addEventListener("scroll", () => outlineWanted() && repaintOutline(), { passive: true });
