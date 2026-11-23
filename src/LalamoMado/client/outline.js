// A section runs from its heading to the next heading of any level.
// Other categories (changes, the agent's mark sets) nest their items under the section they fall in; a checkbox per category filters the pane.

const list = document.querySelector("#outline");
const preamble = document.querySelector("#outline-preamble");
const filters = document.querySelector("#outline-filters");
const empty = document.querySelector("#outline-empty");
const pane = document.querySelector("#left");
const scroller = pane.querySelector(".pane-body");
const categoryNames = new Map([
  ["outline", "Outline"],
  ["changes", "Changes"],
]);
const hiddenCategories = new Set();
const hiddenTones = new Set();
const itemsByCategory = new Map();
let sections = [];
let textIndex = null;

export function rebuildOutline(doc, index) {
  textIndex = index;
  const headings = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const topLevel = Math.min(...headings.map(levelOf));
  sections = headings.map((heading) => {
    const entry = document.createElement("a");
    entry.href = "#";
    const title = Object.assign(document.createElement("span"), { className: "title", textContent: heading.textContent });
    const badge = Object.assign(document.createElement("span"), { className: "badge" });
    const hiddenCounts = Object.assign(document.createElement("span"), { className: "hidden-counts" });
    const dots = Object.assign(document.createElement("span"), { className: "dots" });
    entry.append(title, dots, hiddenCounts, badge);
    entry.addEventListener("click", (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const item = document.createElement("li");
    item.style.setProperty("--depth", levelOf(heading) - topLevel);
    const nested = Object.assign(document.createElement("ol"), { className: "section-items" });
    item.append(entry, nested);
    return { heading, item, entry, badge, hiddenCounts, dots, nested, start: index.offsetOf(heading, 0) };
  });
  list.replaceChildren(...sections.map(({ item }) => item));
  placeSectionItems();
  markCurrentSection();
}

/**
 * Items are placed when the outline is (re)built, against the text index of that render.
 * @param items [{ target, node, beforeTarget, tone, sign, toneName }] — target is the element the item belongs to (null: the end of the document);
 *              beforeTarget places it in the section that ends where target starts (a removal sits before the block that now follows it);
 *              tone and sign summarize it on its heading while it is filtered out; a category with several tones gets a checkbox per tone (toneName);
 *              an item with a dot colour lights its heading up with a dot per tone instead, shown or filtered out.
 * @param name the category's checkbox label; an empty list drops the category.
 */
export function setSectionItems(category, items, name = categoryNames.get(category)) {
  if (items.length === 0) {
    itemsByCategory.delete(category);
    if (category !== "changes") categoryNames.delete(category);
    return;
  }
  itemsByCategory.set(category, items);
  categoryNames.set(category, name);
}

/** Re-places the items after a category changed, without rebuilding the outline. */
export const refreshSectionItems = () => placeSectionItems();

/** @param offsets text-index offsets of the located annotations */
export function renderOutlineBadges(offsets) {
  for (const [i, section] of sections.entries()) {
    const end = sections[i + 1]?.start ?? Infinity;
    const count = offsets.filter((offset) => offset >= section.start && offset < end).length;
    section.badge.textContent = count || "";
    section.badge.title = count ? `${count} annotation${count > 1 ? "s" : ""} in this section` : "";
  }
}

export function markCurrentSection() {
  if (!pane.isConnected) return;
  const readingLine = document.querySelector("#bar").getBoundingClientRect().bottom + 16;
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  const current = atBottom ? sections.at(-1) : sections.findLast(({ heading }) => heading.getBoundingClientRect().top <= readingLine);
  for (const section of sections) section.entry.classList.toggle("current", section === current);
  if (current) keepVisible(current.entry);
}

function placeSectionItems() {
  for (const section of sections) section.nested.replaceChildren();
  preamble.replaceChildren();
  for (const [category, items] of itemsByCategory) {
    for (const { target, node, beforeTarget, tone, sign, toneName, dot } of items) {
      const offset = target ? textIndex.offsetOf(target, 0) - (beforeTarget ? 1 : 0) : Infinity;
      const section = sections.findLast(({ start }) => start <= offset);
      const holder = Object.assign(document.createElement("li"), { className: "section-item" });
      Object.assign(holder.dataset, { category, tone, sign, toneName }, dot ? { dot } : {});
      holder.append(node);
      (section?.nested ?? preamble).append(holder);
    }
  }
  renderFilters();
  applyFilters();
}

function renderFilters() {
  const present = [...categoryNames.keys()].filter((category) =>
    category === "outline" ? sections.length > 0 : itemsByCategory.get(category)?.length > 0,
  );
  filters.hidden = present.length < 2;
  filters.replaceChildren(
    ...present.flatMap((category) => {
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !hiddenCategories.has(category) });
      box.dataset.category = category;
      box.addEventListener("change", () => {
        if (box.checked) hiddenCategories.delete(category);
        else hiddenCategories.add(category);
        applyFilters();
      });
      const count = category === "outline" ? "" : ` (${itemsByCategory.get(category).length})`;
      const label = document.createElement("label");
      const signs = colouredSigns(category);
      label.append(box, ...signs, `${signs.length ? " " : ""}${categoryNames.get(category)}${count}`);
      return [label, ...toneFilters(category)];
    }),
  );
}

// A category of coloured items shows a sign per colour it holds, the colours of its ticks in the margin.
function colouredSigns(category) {
  const items = itemsByCategory.get(category) ?? [];
  const firstByColour = new Map();
  for (const item of items) if (item.dot && !firstByColour.has(item.dot)) firstByColour.set(item.dot, item);
  return [...firstByColour.values()].map(({ dot, sign }) => {
    const signNode = Object.assign(document.createElement("span"), { textContent: sign });
    signNode.style.color = dot;
    return signNode;
  });
}

// The category stays one switch; its tones (added / changed / removed) narrow it further.
function toneFilters(category) {
  const tones = new Map();
  for (const { tone, sign, toneName, dot } of itemsByCategory.get(category) ?? []) {
    const tally = tones.get(tone) ?? { sign, toneName, dot, count: 0 };
    tally.count++;
    tones.set(tone, tally);
  }
  if (tones.size < 2) return [];
  const row = Object.assign(document.createElement("div"), { className: "tone-filters" });
  for (const [tone, { sign, toneName, dot, count }] of tones) {
    const key = `${category}|${tone}`;
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: !hiddenTones.has(key) });
    Object.assign(box.dataset, { category, tone });
    box.addEventListener("change", () => {
      if (box.checked) hiddenTones.delete(key);
      else hiddenTones.add(key);
      applyFilters();
    });
    const label = Object.assign(document.createElement("label"), { className: `tone-${tone}` });
    if (dot) label.style.color = dot;
    label.append(box, `${sign} ${toneName} (${count})`);
    row.append(label);
  }
  return [row];
}

// With the outline unticked, a heading still shows — as a plain group label — when it holds items of a ticked category.
// Filtered-out items, by category or by tone, leave a coloured count per tone on their heading, so the pane still says where they are.
function applyFilters() {
  const outlineShown = !hiddenCategories.has("outline");
  for (const holder of pane.querySelectorAll(".section-item")) {
    const { category, tone } = holder.dataset;
    holder.hidden = hiddenCategories.has(category) || hiddenTones.has(`${category}|${tone}`);
  }
  for (const box of filters.querySelectorAll("input[data-tone]")) box.disabled = hiddenCategories.has(box.dataset.category);
  for (const section of sections) {
    const holders = [...section.nested.children];
    section.item.hidden = !outlineShown && !holders.some((holder) => !holder.hidden);
    section.entry.classList.toggle("group-only", !outlineShown);
    section.hiddenCounts.replaceChildren(...toneCounts(holders.filter((holder) => holder.hidden && !holder.dataset.dot)));
    section.dots.replaceChildren(...dotsOf(holders.filter((holder) => holder.dataset.dot)));
  }
  empty.hidden = sections.length > 0 || preamble.children.length > 0;
}

function toneCounts(holders) {
  const counts = new Map();
  for (const { dataset } of holders) {
    const key = `${dataset.tone}|${dataset.sign}`;
    const counted = counts.get(key) ?? { tone: dataset.tone, sign: dataset.sign, toneName: dataset.toneName ?? dataset.tone, count: 0 };
    counted.count++;
    counts.set(key, counted);
  }
  return [...counts.values()].map(({ tone, sign, toneName, count }) =>
    Object.assign(document.createElement("span"), { className: `tone-${tone}`, textContent: `${sign}${count}`, title: `${count} filtered out in this section: ${toneName}` }),
  );
}

// One dot per tone, in its colour; clicking it acts as a click on the first such item of the section.
function dotsOf(holders) {
  const firstByTone = new Map();
  for (const holder of holders) if (!firstByTone.has(holder.dataset.tone)) firstByTone.set(holder.dataset.tone, holder);
  return [...firstByTone.values()].map((holder) => {
    const dot = Object.assign(document.createElement("span"), { className: "dot", title: holder.dataset.toneName });
    dot.style.background = holder.dataset.dot;
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      holder.firstElementChild?.click();
    });
    return dot;
  });
}

function keepVisible(entry) {
  const box = entry.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (box.top < view.top || box.bottom > view.bottom) scroller.scrollTop += box.top - view.top - view.height / 3;
}

const levelOf = (heading) => Number(heading.tagName[1]);

let frameQueued = false;
window.addEventListener(
  "scroll",
  () => {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      markCurrentSection();
    });
  },
  { passive: true },
);
