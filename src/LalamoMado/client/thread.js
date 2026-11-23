// A thread: the reviewer's annotation, the agent's replies and the reviewer's follow-ups, in order.
// The large panel floats over the upper two thirds of the document column and is the thread's chat; the small card opens from a highlight in the document.

import { placedBox, documentColumn, underTheBar, lowerThirdTop, COLUMN_MARGIN } from "./floating.js";
import { keyOf, onHotkeysChange, pressed } from "./hotkeys.js";
import { onBoxOpened, stopDictation } from "./mic.js";
import { preference } from "./prefs.js";
import { bindRemembering } from "./remember.js";
import { trackSources } from "./spoken.js";

const panel = document.querySelector("#thread-panel");
const panelTitle = panel.querySelector(".thread-title");
const panelTurns = panel.querySelector(".thread-turns");
const replyForm = panel.querySelector(".thread-reply");
const replyText = replyForm.querySelector("textarea");
const replySend = replyForm.querySelector('button[type="submit"]');
const card = document.querySelector("#thread-card");
const cardTurns = card.querySelector(".thread-turns");
const GAP_ABOVE_POPUP = 8;
const CARD_WIDTH = 380;
const CARD_HEIGHT = 320;
const CARD_MARGIN = 12;

const box = placedBox(panel, {
  keys: ["panel.thread.box"],
  notDragFrom: ".thread-turns",
  dockedBox: () => {
    const column = documentColumn();
    const top = underTheBar();
    return { left: column.left + COLUMN_MARGIN, top, width: column.width - 2 * COLUMN_MARGIN, height: lowerThirdTop() - GAP_ABOVE_POPUP - top };
  },
});

export const replyBox = {
  textarea: replyText,
  mic: replyForm.querySelector(".mic"),
  language: replyForm.querySelector(".mic-language"),
  skillsButton: replyForm.querySelector(".skills-toggle"),
  isOpen: () => !panel.hidden,
  sources: trackSources(replyText),
};

const remembering = bindRemembering({
  field: replyText,
  sources: replyBox.sources,
  list: replyForm.querySelector(".remember"),
  onRemembered: (message) => callbacks.toast(message),
  onProblem: (message) => callbacks.toast(message, true),
});

function nameReplyKeys() {
  const keys = [[keyOf("comment.add"), "sends"], [keyOf("skills.open"), "skills"]].filter(([key]) => key);
  replyText.placeholder = ["Follow-up", keys.map(([key, does]) => `${key} ${does}`).join(", ")].filter(Boolean).join(" — ");
}
onHotkeysChange(nameReplyKeys);

const unsentByThread = new Map();
let panelThreadId = null;
let cardThreadId = null;
let shownTurnCount = 0;
let renderedPanel = "";
let renderedCard = "";
let callbacks = { threadFor: () => null, sendFollowUp: async () => false, replyExtras: () => [], cancelRun: () => {}, onPlaceKept: () => {}, onPlaceReset: () => {}, toast: () => {} };

/** `threadFor(id)` builds { id, title, quote, comment, turns, run, mayEdit, awaitingSince }; `sendFollowUp(id, reading)` says whether it went; `replyExtras(turn)` adds what a reply offers. */
export function bindThreads(handlers) {
  callbacks = handlers;
}

export const threadPanelOpen = () => !panel.hidden;

/** @param reply puts the cursor in the reply box, as the Reply button does. */
export function openThreadPanel(id, { reply = false } = {}) {
  closeCard();
  if (panelThreadId && panelThreadId !== id) unsentByThread.set(panelThreadId, replyBox.sources.read());
  if (panelThreadId !== id) {
    replyBox.sources.load(unsentByThread.get(id));
    remembering.clear();
  }
  const wasClosed = panel.hidden;
  panelThreadId = id;
  panel.hidden = false;
  if (wasClosed) box.place("panel.thread.box");
  shownTurnCount = 0;
  renderedPanel = "";
  renderPanel();
  // With ⚙ "dictate as soon as a comment opens", any way of opening the chat is a way of answering in it.
  const answering = reply || preference("dictation.always", false);
  // Opened before the focus moves in, as in the comment popup.
  onBoxOpened(replyBox, { listen: answering });
  if (answering) replyText.focus();
}

export function openThreadCard(id, { x, y }) {
  cardThreadId = id;
  card.hidden = false;
  renderedCard = "";
  renderCard();
  Object.assign(card.style, {
    left: `${Math.max(CARD_MARGIN, Math.min(x, window.innerWidth - CARD_WIDTH - CARD_MARGIN))}px`,
    top: `${Math.max(CARD_MARGIN, Math.min(y + CARD_MARGIN, window.innerHeight - CARD_HEIGHT - CARD_MARGIN))}px`,
  });
}

/** New turns arrived, or a follow-up's status changed. */
export function refreshThreadViews() {
  if (!panel.hidden) renderPanel();
  if (!card.hidden) renderCard();
}

/** Esc: the place menu, then the small card, then the panel. @returns whether something closed. */
export function closeThreadView() {
  if (box.closeMenu()) return true;
  if (!card.hidden) {
    closeCard();
    return true;
  }
  if (panel.hidden) return false;
  closePanel();
  return true;
}

/** One turn of a thread: the agent's replies render as markdown, the reviewer's words as typed. */
export function turnNode(turn) {
  if (turn.by === "agent") {
    const node = Object.assign(document.createElement("div"), { className: "reply" });
    node.dataset.by = turn.who ?? "session";
    node.innerHTML = turn.html;
    if (turn.changed) node.append(Object.assign(document.createElement("div"), { className: "reply-changed", textContent: `Changed: ${turn.changed.join(", ")}` }));
    if (turn.note) node.append(Object.assign(document.createElement("div"), { className: "reply-note", textContent: turn.note }));
    node.append(...callbacks.replyExtras(turn));
    return node;
  }
  const node = Object.assign(document.createElement("div"), { className: "follow-up", textContent: turn.text });
  if (turn.statusText) node.append(Object.assign(document.createElement("span"), { className: "turn-status", textContent: turn.statusText }));
  return node;
}

/** Where the answer stands, for the card and the panel: a separate run's state, or the session's answer still to come. */
export const progressNode = (thread) => runNode(thread.run) ?? awaitingNode(thread.awaitingSince);

/** What a separate run is doing; nothing once it has answered. */
function runNode(run) {
  if (!run || run.state === "done") return null;
  const node = Object.assign(document.createElement("div"), { className: `run-state ${run.state}` });
  if (run.state === "failed") node.textContent = run.error ?? "The run failed.";
  else if (run.state === "cancelled") node.textContent = "Cancelled.";
  else {
    const elapsed = Object.assign(document.createElement("span"), { className: "run-elapsed" });
    elapsed.dataset.since = run.since;
    elapsed.textContent = elapsedSince(run.since);
    const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
    cancel.addEventListener("click", () => callbacks.cancelRun(run.thread));
    node.append(run.state === "waiting" ? "waiting for another run… " : "answering… ", elapsed, " ", cancel);
  }
  return node;
}

/** A question the session has not answered yet. */
function awaitingNode(since) {
  if (!since) return null;
  const node = Object.assign(document.createElement("div"), { className: "run-state awaiting", title: "Sent — the agent's answer appears here when it comes" });
  const dots = Object.assign(document.createElement("span"), { className: "awaiting-dots" });
  dots.append(...[0, 1, 2].map(() => Object.assign(document.createElement("span"), { textContent: "●" })));
  const elapsed = Object.assign(document.createElement("span"), { className: "run-elapsed" });
  elapsed.dataset.since = since;
  elapsed.textContent = elapsedSince(since);
  node.append(dots, " waiting for the answer ", elapsed);
  return node;
}

function elapsedSince(since) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(since)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

setInterval(() => {
  for (const elapsed of document.querySelectorAll(".run-elapsed")) elapsed.textContent = elapsedSince(elapsed.dataset.since);
}, 1000);

function closePanel() {
  stopDictation(replyBox);
  unsentByThread.set(panelThreadId, replyBox.sources.read());
  remembering.clear();
  panelThreadId = null;
  panel.hidden = true;
}

function closeCard() {
  cardThreadId = null;
  card.hidden = true;
}

function renderPanel() {
  const thread = callbacks.threadFor(panelThreadId);
  if (!thread) return closePanel();
  // Most renders of the page change nothing here, and re-rendering would drop a selection in the turns.
  const content = JSON.stringify(thread);
  if (content === renderedPanel) return;
  renderedPanel = content;
  panelTitle.textContent = thread.title;
  panel.classList.toggle("may-edit", !!thread.mayEdit);
  const atBottom = panelTurns.scrollHeight - panelTurns.scrollTop - panelTurns.clientHeight < 40;
  panelTurns.replaceChildren(...turnsOf(thread));
  if (thread.turns.length > shownTurnCount && (atBottom || shownTurnCount === 0)) panelTurns.scrollTop = panelTurns.scrollHeight;
  shownTurnCount = thread.turns.length;
}

function renderCard() {
  const thread = callbacks.threadFor(cardThreadId);
  if (!thread) return closeCard();
  const content = JSON.stringify(thread);
  if (content === renderedCard) return;
  renderedCard = content;
  cardTurns.replaceChildren(...turnsOf(thread));
}

const turnsOf = (thread) => [...openingOf(thread), ...thread.turns.map(turnNode), progressNode(thread)].filter(Boolean);

function openingOf(thread) {
  const opening = [];
  if (thread.quote) opening.push(Object.assign(document.createElement("div"), { className: "excerpt", textContent: thread.quote }));
  if (thread.comment) opening.push(Object.assign(document.createElement("div"), { className: "follow-up", textContent: thread.comment }));
  return opening;
}

// A second press while a follow-up is on its way would send it again.
let replyInFlight = false;

function showReplyInFlight(inFlight) {
  replyInFlight = inFlight;
  replyText.readOnly = inFlight;
  replySend.disabled = inFlight;
  replySend.textContent = inFlight ? "Sending…" : "Send";
}

async function sendReply() {
  const reading = replyBox.sources.read();
  if (!reading.text || replyInFlight) return;
  const id = panelThreadId;
  showReplyInFlight(true);
  try {
    if (!(await callbacks.sendFollowUp(id, reading))) return;
  } finally {
    showReplyInFlight(false);
  }
  stopDictation(replyBox);
  unsentByThread.delete(id);
  if (panelThreadId === id) {
    replyBox.sources.load();
    remembering.clear();
  }
  refreshThreadViews();
}

replyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendReply();
});
// A follow-up has no draft to keep: adding it and sending it now are the same, so either key sends.
replyText.addEventListener("keydown", (event) => {
  if (pressed(event, "comment.add") || pressed(event, "comment.sendNow")) {
    event.preventDefault();
    sendReply();
  }
});
panel.addEventListener("click", (event) => {
  const actor = event.target.closest("[data-act]");
  const act = actor?.dataset.act;
  if (act === "close") closePanel();
  if (act === "keep") {
    box.keep(actor.dataset.scope);
    callbacks.onPlaceKept(actor.dataset.scope);
  }
  if (act === "reset") {
    box.reset();
    callbacks.onPlaceReset();
  }
});
card.addEventListener("click", (event) => {
  const act = event.target.closest("[data-act]")?.dataset.act;
  if (act === "close") closeCard();
  if (act === "expand") openThreadPanel(cardThreadId);
  if (act === "reply") openThreadPanel(cardThreadId, { reply: true });
});
document.addEventListener("pointerdown", (event) => {
  if (!card.hidden && !card.contains(event.target)) closeCard();
});
