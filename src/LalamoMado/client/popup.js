// Where the comment popup sits. By default it docks over the lower third of the document column, never over the panes;
// the reviewer can move and resize it and keep that place per variant (general / in-text).

import { placedBox, documentColumn, lowerThirdTop, lowerThirdHeight, COLUMN_MARGIN } from "./floating.js";
import { preference } from "./prefs.js";

const popup = document.querySelector("#popover");
const bar = document.querySelector("#bar");
const variantName = popup.querySelector(".variant-name");
const VARIANT_NAMES = { inText: "in-text comments", general: "general comments" };
const boxKey = (variant) => `popup.${variant}.box`;

const box = placedBox(popup, {
  keys: Object.keys(VARIANT_NAMES).map(boxKey),
  notDragFrom: ".fix-suggestion, .remember, .send-row",
  dockedBox: () => {
    const column = documentColumn();
    return { left: column.left + COLUMN_MARGIN, top: lowerThirdTop(), width: column.width - 2 * COLUMN_MARGIN, height: lowerThirdHeight() };
  },
});

export function placePopup(variant) {
  variantName.textContent = VARIANT_NAMES[variant];
  box.place(boxKey(variant));
}

export const keepPopupBox = (scope) => box.keep(scope);
export const resetPopupBox = () => box.reset();
/** @returns whether the menu was open. */
export const closePlaceMenu = () => box.closeMenu();

/**
 * With adaptive scroll on, a selection whose start lies under the popup scrolls up into the free space above it.
 * @param start the client rect of the selection's first line (or the caret of an insert point)
 */
export function keepSelectionInView(start) {
  if (!start || !preference("scroll.adaptive", true)) return;
  const popupRect = popup.getBoundingClientRect();
  const covered = start.bottom > popupRect.top && start.top < popupRect.bottom && start.right >= popupRect.left && start.left <= popupRect.right;
  if (!covered) return;
  const freeTop = bar.getBoundingClientRect().bottom;
  window.scrollBy({ top: start.top - (freeTop + (popupRect.top - freeTop) / 2), behavior: "smooth" });
}
