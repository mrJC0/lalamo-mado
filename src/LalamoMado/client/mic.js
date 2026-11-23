// Dictation into a text box: Chrome's Web Speech recognition, started and stopped only by the reviewer, text at the caret.
// Chrome sends the audio to its speech service; the page keeps it only for ⚙ "Fix with Local's transcript too". Local (whisper.js) is the other engine, where installed.

import { corrected, loadGlossary } from "./glossary.js";
import { keyOf, onHotkeysChange, pressed } from "./hotkeys.js";
import { onPreferenceChange, preference, savePreference } from "./prefs.js";
import { chooseEngine, engine, fixWithLocal, keepTake, listenLocally, loadLocalStatus, localAvailable, transcribeTake } from "./whisper.js";

const LANGUAGES = [
  { code: "cs-CZ", short: "CZ" },
  { code: "en-US", short: "EN" },
];

const MICROPHONE_BLOCKED = "Dictation needs the microphone: allow it for this page (the icon at the right of the address bar).";
const PROBLEMS = {
  "not-allowed": MICROPHONE_BLOCKED,
  "service-not-allowed": MICROPHONE_BLOCKED,
  "audio-capture": "No microphone found.",
  network: "Dictation needs the internet: Chrome transcribes the audio on its speech service.",
};
const MAX_ALTERNATIVES = 5;
const ENGINES = { chrome: "Chrome", local: "Local" };
const ENGINE_TITLE = "Dictation engine — click to switch: Chrome (its speech service) or Local (Whisper on this PC)";
const TRANSCRIBING = "…";

const Recognition = () => window.SpeechRecognition ?? window.webkitSpeechRecognition;

let boxes = [];
let dictatedBox = null;
let reportProblem;
let recognition = null;
let dictationWanted = false;
// Dictation writes into a region: final words settle at `at`, and the words still being recognized follow them, `interim` characters long.
// Chrome moves words between its results while it settles them, so a region is the unit, never a single result.
// Typing while words are still being recognized leaves the region where it stands, to settle there, and opens the live one where the reviewer typed.
let live = null;
let regions = new Set();
let knownValue = "";
// Ends the engine's current run, so what it heard before the typing settles in the old region; the next run writes into the live one.
let endRun = () => {};
// While Chrome dictates, the recording that keeps the sound for Local in the dictated box's take.
let tapping = null;

/**
 * Call once with every box that takes dictation: { textarea, mic, language, isOpen, sources }.
 * `isOpen` says whether it is showing, the only time Ctrl+D dictates into it; with several open the focused one takes it.
 * `sources` is its spoken-or-typed tracker.
 */
export function bindMic({ boxes: dictationBoxes, onProblem }) {
  boxes = dictationBoxes;
  reportProblem = onProblem;
  for (const box of boxes) {
    box.take = [];
    box.engine = Object.assign(document.createElement("button"), { type: "button", className: "mic-language mic-engine", title: ENGINE_TITLE, hidden: true });
    box.language.after(box.engine);
    box.engine.addEventListener("click", () => chooseEngine(engine() === "local" ? "chrome" : "local"));
    box.mic.addEventListener("click", () => toggleDictation(box));
    box.language.addEventListener("click", cycleLanguage);
    box.textarea.addEventListener("input", (event) => {
      box.sources.typed(event);
      if (recognition && dictatedBox === box && event.isTrusted) followTyping();
    });
    // The microphone follows the focus between open boxes: while dictating, or with ⚙ "dictate as soon as a comment opens", the box you move into listens.
    box.textarea.addEventListener("focus", () => {
      if (dictatedBox === box || !box.isOpen() || !canDictate()) return;
      if (dictationWanted || preference("dictation.always", false)) startDictation(box);
    });
  }
  document.addEventListener("keydown", (event) => {
    if (!pressed(event, "dictation.toggle")) return;
    const openBoxes = boxes.filter((box) => box.isOpen());
    if (!openBoxes.length) return;
    event.preventDefault();
    toggleDictation(openBoxes.find((box) => document.activeElement === box.textarea) ?? openBoxes[0]);
  });
  loadGlossary();
  // From the badge, from ⚙ or from the agent alike: the boxes show it and a running dictation restarts with it.
  onPreferenceChange("dictation.engine", () => {
    for (const box of boxes) box.engine.textContent = ENGINES[engine()];
    restartDictation();
  });
  onPreferenceChange("dictation.language", () => {
    for (const box of boxes) box.language.textContent = currentLanguage().short;
    restartDictation();
  });
  onHotkeysChange(() => {
    for (const box of boxes) box.mic.title = micTitle();
  });
  loadLocalStatus().then(() => {
    for (const box of boxes) if (box.isOpen()) showControls(box);
  });
}

export const canDictate = () => !!Recognition() || localAvailable();

/** Call whenever a box opens: its controls show only where the browser can dictate, and with ⚙ "dictate as soon as a comment opens" it starts listening when `listen`. */
export function onBoxOpened(box, { listen = true } = {}) {
  stopDictation();
  box.take = [];
  showControls(box);
  if (canDictate() && listen && preference("dictation.always", false)) startDictation(box);
}

const micTitle = () => (keyOf("dictation.toggle") ? `Dictate — ${keyOf("dictation.toggle")} starts and stops` : "Dictate");

function showControls(box) {
  const available = canDictate();
  box.mic.title = micTitle();
  box.mic.hidden = !available;
  box.language.hidden = !available;
  box.language.textContent = currentLanguage().short;
  box.engine.hidden = !localAvailable();
  box.engine.textContent = ENGINES[engine()];
}

/** A box is closing: drop whatever is still being recognized, so it never lands in the next comment. Without a box, whichever is listening. */
export function stopDictation(box) {
  if (box && dictatedBox !== box) return;
  dictationWanted = false;
  dictatedBox?.mic.setAttribute("aria-pressed", "false");
  recognition?.abort();
  recognition = null;
  dictatedBox = null;
  stopTapping();
}

/** ⚙ "Fix with Local's transcript too" kept sound said into the box since it opened. */
export const keptForLocal = (box) => fixWithLocal() && box.take.length > 0;

/** Local's transcript of the box's kept sound, known mishearings corrected. */
export const localTranscriptOf = async (box) => corrected(await transcribeTake(box.take));

/** Something other than the keyboard wrote into a box, which fires no `input`: the next words must follow it. */
export function noteInserted(box) {
  box.sources.typed();
  if (recognition && dictatedBox === box) followTyping();
}

function toggleDictation(box) {
  if (dictationWanted && dictatedBox === box) finishDictation();
  else startDictation(box);
}

/** The reviewer stopped: the last words still arrive and are kept. */
function finishDictation() {
  dictationWanted = false;
  dictatedBox?.mic.setAttribute("aria-pressed", "false");
  recognition?.stop();
  stopTapping();
}

function stopTapping() {
  tapping?.stop();
  tapping = null;
}

function startDictation(box) {
  loadGlossary();
  if (engine() === "local") return startLocally(box);
  const SpeechRecognition = Recognition();
  if (!SpeechRecognition) return;
  stopDictation();
  dictatedBox = box;
  dictationWanted = true;
  resetRegionsAtCaret();
  const session = new SpeechRecognition();
  recognition = session;
  let region = live;
  // Stopping makes Chrome return a final result for what it heard so far; the restart in onend writes into the live region.
  endRun = () => session.stop();
  Object.assign(session, { lang: currentLanguage().code, continuous: true, interimResults: true, maxAlternatives: MAX_ALTERNATIVES });
  session.onresult = (event) => {
    if (recognition === session) showResults(event, region);
  };
  session.onerror = (event) => {
    if (recognition !== session || !PROBLEMS[event.error]) return;
    stopDictation();
    reportProblem(PROBLEMS[event.error]);
  };
  // Chrome closes a continuous session on its own after a while; only the reviewer ends dictation.
  session.onend = () => {
    if (recognition !== session) return;
    if (dictationWanted) {
      if (region !== live) regions.delete(region);
      region = live;
      session.start();
    } else {
      recognition = null;
      dictatedBox = null;
    }
  };
  session.start();
  if (fixWithLocal()) tapping = keepTake(box.take, currentLanguage().code.slice(0, 2), reportProblem);
  box.mic.setAttribute("aria-pressed", "true");
  box.textarea.focus();
}

/** Whisper's pieces land like Chrome's results; a "…" stands in where each one goes while it is transcribed. */
function startLocally(box) {
  stopDictation();
  dictatedBox = box;
  dictationWanted = true;
  resetRegionsAtCaret();
  endRun = () => {};
  // Each piece writes into the region that was live when it was cut.
  const regionPerPiece = [];
  const session = listenLocally({
    language: currentLanguage().code.slice(0, 2),
    onPiece: () => {
      regionPerPiece.push(live);
      live.pieces++;
      place(live, "", TRANSCRIBING);
    },
    onText: (text) => {
      const region = regionPerPiece.shift();
      region.pieces--;
      const said = corrected(text);
      if (said !== text && !region.taken) box.sources.heard(said.trim(), [text.trim()]);
      place(region, said, region.pieces ? ` ${TRANSCRIBING}` : "");
      if (!region.pieces && region !== live) regions.delete(region);
    },
    onProblem: (message) => {
      stopDictation();
      reportProblem(message);
    },
    onEnd: () => {
      if (recognition !== session) return;
      recognition = null;
      dictatedBox = null;
    },
  });
  recognition = session;
  box.mic.setAttribute("aria-pressed", "true");
  box.textarea.focus();
}

/** Known mishearings are corrected in interim words too, so a word does not flip when it settles; what was heard joins the recognizer's other guesses. */
function showResults(event, region) {
  let final = "";
  let interim = "";
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i];
    if (result.isFinal) {
      const heard = result[0].transcript;
      const said = corrected(heard);
      final += said;
      const others = Array.from(result, (guess) => guess.transcript.trim()).slice(1);
      if (!region.taken) dictatedBox.sources.heard(said.trim(), said === heard ? others : [heard.trim(), ...others]);
    } else interim += result[0].transcript;
  }
  place(region, final, corrected(interim));
}

/** Final words settle at the region's start; interim ones follow them and are replaced by the next result. */
function place(region, final, interim) {
  if (region.taken) return;
  const field = dictatedBox.textarea;
  const { at } = region;
  const end = at + region.interim;
  const caret = field.selectionStart;
  const spoken = joinedTo(field.value[at - 1], final + interim);
  field.setRangeText(spoken, at, end, "preserve");
  dictatedBox.sources.spoke();
  knownValue = field.value;
  const growth = spoken.length - region.interim;
  for (const other of regions) if (other !== region && other.at >= end) other.at += growth;
  const settled = final ? spoken.length - interim.length : 0;
  region.at += settled;
  region.interim = spoken.length - settled;
  if (caret >= end) field.setSelectionRange(caret + growth, caret + growth);
}

function joinedTo(before, text) {
  const trimmed = text.trimStart();
  return before && !/\s/.test(before) && trimmed ? ` ${trimmed}` : trimmed;
}

/** The reviewer typed. Words still being recognized stay where they stand and settle there; the next ones go where the reviewer is. */
function followTyping() {
  const field = dictatedBox.textarea;
  const { start, removedEnd, growth } = editBetween(knownValue, field.value);
  knownValue = field.value;
  for (const region of regions) {
    if (region.at >= removedEnd) region.at += growth;
    // Typed into words still being recognized: they are the reviewer's now, and their later versions are dropped.
    else if (region.at + region.interim > start) region.taken = true;
  }
  if (!live.interim && !live.taken) {
    live.at = field.selectionStart;
    return;
  }
  live = openRegion(field.selectionStart);
  endRun();
}

function editBetween(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { start, removedEnd: before.length - tail, growth: after.length - before.length };
}

function resetRegionsAtCaret() {
  const field = dictatedBox.textarea;
  regions = new Set();
  live = openRegion(field.selectionStart ?? field.value.length);
  knownValue = field.value;
}

function openRegion(at) {
  const region = { at, interim: 0, taken: false, pieces: 0 };
  regions.add(region);
  return region;
}

function currentLanguage() {
  const code = preference("dictation.language", LANGUAGES[0].code);
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}

function cycleLanguage() {
  savePreference("pc", "dictation.language", LANGUAGES[(LANGUAGES.indexOf(currentLanguage()) + 1) % LANGUAGES.length].code);
}

function restartDictation() {
  if (!dictationWanted) return;
  const box = dictatedBox;
  stopDictation();
  startDictation(box);
}
