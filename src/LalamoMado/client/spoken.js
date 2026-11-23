// Where each character of a text box came from: the microphone, or the keyboard and everything else.
// Nothing shows in the page; the server turns the spoken ranges into the parts the agent should read with care.

const MIC = "mic";
const KEY = "key";
// A correction of more words than this is a rewrite, not a mishearing.
const MAX_CORRECTION_WORDS = 4;
const WORD = /\S+/g;
// Sentence punctuation around a phrase, never what belongs to a term: C#, .NET, edit-md.
const EDGES = /^["'(\[„“‚‘]+|[.,;:!?…"')\]“”‘’/]+$/gu;

export function trackSources(field) {
  let known = field.value;
  let sources = Array.from(known, () => KEY);
  let guesses = [];
  // The box as the dictation last left it: what typing replaced since then is a correction of spoken words.
  let asDictated = null;
  // Corrections made before the dictation wrote again.
  let earlierCorrections = [];

  function sync(source) {
    const now = field.value;
    let start = 0;
    while (start < known.length && start < now.length && known[start] === now[start]) start++;
    let end = 0;
    while (end < known.length - start && end < now.length - start && known[known.length - 1 - end] === now[now.length - 1 - end]) end++;
    sources = [...sources.slice(0, start), ...Array.from({ length: now.length - start - end }, () => source), ...sources.slice(sources.length - end)];
    known = now;
  }

  return {
    /** The dictation just wrote into the box. */
    spoke() {
      if (asDictated && asDictated.text !== known) earlierCorrections = [...earlierCorrections, ...replacedSpoken(asDictated, known)];
      sync(MIC);
      asDictated = { text: known, sources: [...sources] };
    },
    /** Spoken words the reviewer has since replaced by hand: [{ heard, meant }]. */
    corrections() {
      sync(KEY);
      const stillThere = earlierCorrections.filter(({ meant }) => holdsPhrase(known, meant));
      return distinct([...stillThere, ...(asDictated ? replacedSpoken(asDictated, known) : [])]);
    },
    /** What the spoken words in the box would become if `text` replaced it, as an accepted fix does. */
    replacedBy(text) {
      sync(KEY);
      return replacedSpoken({ text: known, sources }, text);
    },
    /** The recognizer's other guesses for a phrase it settled on. */
    heard(phrase, others) {
      if (others.length) guesses.push({ phrase, others });
    },
    /** Anything else changed the box. A diff cannot tell what undo brings back: a wrong "spoken" costs a little care, a wrong "typed" lets a misheard word through. */
    typed(event) {
      const restored = event?.inputType === "historyUndo" || event?.inputType === "historyRedo";
      sync(restored && sources.includes(MIC) ? MIC : KEY);
    },
    load({ text = "", spokenRanges = [], alternatives = [] } = {}) {
      field.value = text;
      known = text;
      sources = Array.from(text, () => KEY);
      for (const [from, to] of spokenRanges) sources.fill(MIC, from, to);
      guesses = [...alternatives];
      asDictated = { text: known, sources: [...sources] };
      earlierCorrections = [];
    },
    /** The box's trimmed text, with the spoken ranges counted in it. */
    read() {
      sync(KEY);
      const lead = known.length - known.trimStart().length;
      const text = known.trim();
      const spokenRanges = [];
      for (let at = 0; at < text.length; at++) {
        if (sources[lead + at] !== MIC) continue;
        if (spokenRanges.at(-1)?.[1] === at) spokenRanges.at(-1)[1] = at + 1;
        else spokenRanges.push([at, at + 1]);
      }
      return { text, spokenRanges, alternatives: guesses };
    },
  };
}

/** The smallest runs of spoken words that `after` replaced, word by word along the longest common sequence; insertions and deletions are not corrections. */
function replacedSpoken(before, after) {
  const was = wordsOf(before.text, before.sources);
  const now = wordsOf(after);
  const same = (i, j) => was[i].plain === now[j].plain;
  const common = Array.from({ length: was.length + 1 }, () => new Uint16Array(now.length + 1));
  for (let i = was.length - 1; i >= 0; i--)
    for (let j = now.length - 1; j >= 0; j--) common[i][j] = same(i, j) ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < was.length || j < now.length) {
    if (i < was.length && j < now.length && same(i, j)) {
      i++;
      j++;
      continue;
    }
    const [fromI, fromJ] = [i, j];
    while ((i < was.length || j < now.length) && !(i < was.length && j < now.length && same(i, j))) {
      if (j >= now.length || (i < was.length && common[i + 1][j] >= common[i][j + 1])) i++;
      else j++;
    }
    const pair = correctionOf(was.slice(fromI, i), now.slice(fromJ, j));
    if (pair) pairs.push(pair);
  }
  return pairs;
}

function correctionOf(heardWords, meantWords) {
  if (!heardWords.length || !meantWords.length || heardWords.length > MAX_CORRECTION_WORDS || meantWords.length > MAX_CORRECTION_WORDS) return null;
  if (!heardWords.every((word) => word.spoken)) return null;
  const heard = phrase(heardWords);
  const meant = phrase(meantWords);
  if (!heard || !/[\p{L}\p{N}]/u.test(meant) || heard.toLowerCase() === meant.toLowerCase()) return null;
  return { heard, meant };
}

function wordsOf(text, sources = null) {
  return Array.from(text.matchAll(WORD), (match) => ({
    text: match[0],
    plain: match[0].replace(EDGES, "").toLowerCase(),
    spoken: !!sources?.slice(match.index, match.index + match[0].length).includes(MIC),
  }));
}

const phrase = (words) => words.map((word) => word.text).join(" ").replace(EDGES, "");

const holdsPhrase = (text, words) => ` ${wordsOf(text).map((word) => word.plain).join(" ")} `.includes(` ${wordsOf(words).map((word) => word.plain).join(" ")} `);

function distinct(pairs) {
  const seen = new Set();
  return pairs.filter(({ heard, meant }) => {
    const key = `${heard.toLowerCase()}\n${meant}`;
    return !seen.has(key) && seen.add(key);
  });
}
