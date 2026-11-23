// Text-quote anchors (W3C / Hypothesis style): the exact quote plus a little context on each side,
// with the character offset only as a fast-path hint. They re-resolve after any re-render.

const CONTEXT = 32;

// Only text a reader sees: the <style> a rendered diagram carries must not leak into quotes or offsets.
const invisible = (node) => node.parentElement?.closest("style, script") !== null;

export class TextIndex {
  constructor(root) {
    this.root = root;
    this.nodes = [];
    this.starts = [];
    let text = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (invisible(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      this.nodes.push(node);
      this.starts.push(text.length);
      text += node.data;
    }
    this.text = text;
  }

  offsetOf(container, offset) {
    const at = this.nodes.indexOf(container);
    if (at >= 0) return this.starts[at] + Math.min(offset, container.length);
    const boundary = document.createRange();
    boundary.setStart(container, offset);
    const next = this.nodes.findIndex((node) => boundary.comparePoint(node, 0) >= 0);
    return next < 0 ? this.text.length : this.starts[next];
  }

  range(start, end) {
    const from = this.#position(start, true);
    const to = this.#position(end, false);
    if (!from || !to) return null;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  // At a boundary between two text nodes a range start belongs to the next node, a range end to the previous one.
  #position(offset, preferNext) {
    const count = this.nodes.length;
    if (count === 0) return null;
    let i = 0;
    while (i + 1 < count && (preferNext ? this.starts[i + 1] <= offset : this.starts[i + 1] < offset)) i++;
    while (preferNext && i + 1 < count && offset >= this.starts[i] + this.nodes[i].length) i++;
    const node = this.nodes[i];
    return { node, offset: Math.max(0, Math.min(offset - this.starts[i], node.length)) };
  }
}

export function describe(index, start, end) {
  const { text } = index;
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    startHint: start,
  };
}

export function resolve(index, anchor) {
  const { text } = index;
  const { quote, prefix = "", suffix = "", startHint = 0 } = anchor;

  if (quote === "") {
    const needle = prefix + suffix;
    const at = nearestToHint(occurrences(text, needle), (i) => i + prefix.length, startHint);
    return at === null ? null : { start: at + prefix.length, end: at + prefix.length };
  }

  if (text.startsWith(quote, startHint) && text.slice(startHint - prefix.length, startHint) === prefix) {
    return { start: startHint, end: startHint + quote.length };
  }

  const candidates = occurrences(text, quote);
  if (candidates.length === 0) return null;
  const scored = candidates.map((i) => ({
    i,
    score:
      commonSuffixLength(text.slice(Math.max(0, i - prefix.length), i), prefix) +
      commonPrefixLength(text.slice(i + quote.length, i + quote.length + suffix.length), suffix) -
      Math.abs(i - startHint) / 1e6,
  }));
  scored.sort((a, b) => b.score - a.score);
  return { start: scored[0].i, end: scored[0].i + quote.length };
}

export function findQuote(index, quote) {
  const at = index.text.indexOf(quote);
  return at < 0 ? null : { start: at, end: at + quote.length };
}

function nearestToHint(indexes, positionOf, hint) {
  if (indexes.length === 0) return null;
  return indexes.reduce((best, i) => (Math.abs(positionOf(i) - hint) < Math.abs(positionOf(best) - hint) ? i : best));
}

function occurrences(text, needle) {
  const found = [];
  if (needle === "") return found;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) found.push(i);
  return found;
}

function commonSuffixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
