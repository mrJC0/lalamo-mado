// The reviewer's glossary (plan 09): known mishearings are corrected as the words land, from either engine, before the reviewer sees them.
// The files are the user's and the repo's glossary.json; the server merges them, and ⚙ says what it found.

import { fetchGlossary, rememberMishearing } from "./api.js";

const note = document.querySelector("#setting-glossary");
let mishearings = null;
let inRepo = false;

/** Re-read before each dictation, so an edited file counts from the next one. */
export async function loadGlossary() {
  try {
    use(await fetchGlossary());
  } catch {}
}

/** A correction the reviewer chose to keep: it counts from the next words dictated. */
export async function remember(heard, meant, layer) {
  use(await rememberMishearing(heard, meant, layer));
}

export const alreadyCorrects = (heard, meant) => mishearings?.meant.get(comparable(heard)) === meant;

/** The document is in a git repository, so a correction can be kept for the repo. */
export const canRememberForRepo = () => inRepo;

function use(glossary) {
  mishearings = matcherFor(glossary.mishearings);
  inRepo = !!glossary.repoFile;
  const found = glossary.terms.length || Object.keys(glossary.mishearings).length;
  note.hidden = !found && !glossary.problems;
  note.textContent = [found && `Glossary: ${count(glossary.terms.length, "term")}, ${count(Object.keys(glossary.mishearings).length, "known mishearing")}.`, ...(glossary.problems ?? [])].filter(Boolean).join("\n");
}

/** The text with every known mishearing replaced by the term meant: whole words only, any case. */
export const corrected = (text) => (mishearings ? text.replace(mishearings.pattern, (heard) => mishearings.meant.get(comparable(heard)) ?? heard) : text);

function matcherFor(meantByHeard) {
  const heard = Object.keys(meantByHeard).sort((a, b) => b.length - a.length);
  if (!heard.length) return null;
  const alternatives = heard.map((phrase) => phrase.trim().split(/\s+/).map(escaped).join("\\s+"));
  return {
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "giu"),
    meant: new Map(Object.entries(meantByHeard).map(([phrase, term]) => [comparable(phrase), term])),
  };
}

const comparable = (phrase) => phrase.trim().split(/\s+/).join(" ").toLowerCase();
const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
