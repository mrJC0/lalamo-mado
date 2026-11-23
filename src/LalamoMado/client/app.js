import { TextIndex, describe, resolve, findQuote } from "./anchor.js";
import * as api from "./api.js";
import { renderDiagrams } from "./diagrams.js";
import { rebuildOutline, renderOutlineBadges, markCurrentSection } from "./outline.js";
import { setChanges, paintChangeMarks } from "./changes.js";
import { restorePaneWidths } from "./panes.js";
import { loadPreferences, onPreferenceChange, preference, reloadPreferences, savePreference } from "./prefs.js";
import { placePopup, keepPopupBox, resetPopupBox, keepSelectionInView, closePlaceMenu } from "./popup.js";
import { bindSettings, showChangedByAgent } from "./settings.js";
import { altOnly, blockAt, enclosingBlock } from "./blocks.js";
import { bindMic, canDictate, keptForLocal, localTranscriptOf, onBoxOpened, stopDictation, noteInserted } from "./mic.js";
import { bindHotkeys, keyOf, onHotkeysChange, pressed, rebuildHotkeys } from "./hotkeys.js";
import { armedLabel, bindStamps, closePalette, dropPick, syncStamping, stamping } from "./stamp.js";
import { createSendRow, setSendButtons } from "./sendrow.js";
import { bindSkillPicker, closeSkillPicker, loadSkills, skillsNamedIn } from "./skills.js";
import { bindRemembering } from "./remember.js";
import { trackSources } from "./spoken.js";
import { bindThreads, closeThreadView, openThreadCard, openThreadPanel, progressNode, refreshThreadViews, replyBox, threadPanelOpen, turnNode } from "./thread.js";
import { bindMarks, applyMarkMessage, locateMarks, markAt, markHighlights, paintMarkTicks, markCount } from "./marks.js";
import { setLabels, allLabels, labelFor, labelIdsOf, highlightOf, highlightNames, renderChips, markChips, insertTag } from "./labels.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  doc: $("#doc"),
  page: $("#page"),
  savedAt: $("#saved-at"),
  marks: $("#marks"),
  annotationList: $("#annotations"),
  empty: $("#empty"),
  agent: $("#agent"),
  agentList: $("#agent-messages"),
  popover: $("#popover"),
  popLabels: $("#popover .labels"),
  popText: $("#popover textarea"),
  mic: $("#popover .mic"),
  micLanguage: $("#popover .mic-language"),
  fix: $("#popover .fix"),
  fixSuggestion: $("#popover .fix-suggestion"),
  fixText: $("#popover .fix-text"),
  submit: $("#submit"),
  applySilent: $("#apply-silent"),
  sendDrafts: $("#send-drafts"),
  general: $("#general"),
  seek: $("#seek"),
  file: $("#file"),
  link: $("#link"),
  banner: $("#banner"),
  outlineToggle: $("#outline-toggle"),
  order: $("#order"),
  repliesOnly: $("#replies-only"),
  compact: $("#compact"),
  sendSlot: $("#popover .send-slot"),
  popupSend: $('#popover [data-act="send"]'),
  runsWarning: $("#runs-warning"),
};
const popupBox = { textarea: ui.popText, mic: ui.mic, language: ui.micLanguage, skillsButton: $("#popover .skills-toggle"), isOpen: () => !ui.popover.hidden, sources: trackSources(ui.popText) };
const remembering = bindRemembering({ field: ui.popText, sources: popupBox.sources, list: $("#popover .remember"), onRemembered: (message) => toast(message), onProblem: (message) => toast(message, true) });

const state = {
  view: null,
  index: null,
  annotations: [],
  located: new Map(),
  replies: [],
  // The reviewer's follow-ups in a thread: not annotations of their own, so no card, no badge, nothing for Submit.
  followUps: [],
  // Separate runs by thread, as the inbox reports them.
  runs: new Map(),
  // Suggestions the reviewer used or dismissed, by their reply's place in the inbox.
  settledSuggestions: new Set(),
  // The inbox's place of the last re-render from disk: edits before it have been seen.
  reloadedAtSeq: 0,
  sending: false,
  nextId: 1,
  nextFix: 1,
  activeId: null,
  draft: null,
  lastLabels: [],
};

await loadPreferences();
bindHotkeys();
onHotkeysChange(() => {
  namePopupKeys();
  if (state.draft) renderDraftChips();
});
restorePaneWidths();

// Per server instance + doc; a restarted server starts clean.
const storageKey = () => `edit-md:${state.view.instance}:${api.docId}`;

function save() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ annotations: state.annotations, followUps: state.followUps, settledSuggestions: [...state.settledSuggestions], nextId: state.nextId }));
  } catch {}
}

function forget() {
  try {
    localStorage.removeItem(storageKey());
  } catch {}
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()) ?? "null");
    if (!saved) return;
    state.annotations = saved.annotations ?? [];
    state.followUps = saved.followUps ?? [];
    state.settledSuggestions = new Set(saved.settledSuggestions ?? []);
    state.nextId = saved.nextId ?? state.annotations.length + 1;
  } catch {}
}

function showSavedAt(savedAt) {
  const time = savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const savedToday = savedAt.toDateString() === new Date().toDateString();
  ui.savedAt.textContent = savedToday ?`saved ${time}` : `saved ${savedAt.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
  ui.savedAt.title = `This tab shows the file as saved at ${savedAt.toLocaleString()}. A tab showing a later time holds a newer version.`;
  ui.savedAt.hidden = false;
}

async function loadDocument({ first }) {
  const view = await api.fetchDocument();
  if (!first && view.hash === state.view.hash) return;
  state.view = view;
  ui.file.textContent = view.fileName;
  ui.file.title = view.path;
  showSavedAt(new Date(view.savedAt));
  document.title = `${view.fileName} — edit-md`;
  ui.doc.innerHTML = view.html;
  for (const link of ui.doc.querySelectorAll("a[href]")) {
    if (!link.getAttribute("href").startsWith("#")) Object.assign(link, { target: "_blank", rel: "noopener" });
  }
  if (first) restore();
  setChanges(view.changes ?? []);
  reindex();
  // Diagrams arrive later and change the text; re-anchoring is just another harmless re-render.
  renderDiagrams(ui.doc).then(() => ui.doc.querySelector("pre.mermaid") && reindex());
}

function reindex() {
  state.index = new TextIndex(ui.doc);
  locateMarks(state.index);
  rebuildOutline(ui.doc, state.index);
  relocate();
  render();
}

// Re-resolve every anchor against the current render; this is what makes any re-render harmless.
function relocate() {
  state.located.clear();
  for (const annotation of state.annotations) {
    if (!annotation.anchor) continue;
    const hit = resolve(state.index, annotation.anchor);
    if (hit) state.located.set(annotation.id, { ...hit, range: state.index.range(hit.start, hit.end) });
  }
  for (const reply of state.replies) {
    const hit = reply.quote ? findQuote(state.index, reply.quote) : null;
    reply.located = hit && { ...hit, range: state.index.range(hit.start, hit.end) };
  }
}

function sourceBlock(range) {
  const blocks = [closestBlock(range.startContainer), closestBlock(range.endContainer)].filter(Boolean);
  if (blocks.length === 0) {
    blocks.push(...[...ui.doc.querySelectorAll("[data-src-start]")].filter((block) => range.intersectsNode(block)));
  }
  if (blocks.length === 0) return {};
  return {
    srcStart: Math.min(...blocks.map((block) => Number(block.dataset.srcStart))),
    srcEnd: Math.max(...blocks.map((block) => Number(block.dataset.srcEnd))),
  };
}

function closestBlock(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest("#doc [data-src-start]") ?? null;
}

// A picked block's range starts and ends in its own text, so the block is what holds both ends.
function sourceOfBlockRange(range) {
  const { commonAncestorContainer: holder } = range;
  const block = blockAt(holder.nodeType === Node.ELEMENT_NODE ? holder : holder.parentElement);
  return block ? sourceOf(block) : {};
}

const sourceOf = (block) => ({ srcStart: Number(block.dataset.srcStart), srcEnd: Number(block.dataset.srcEnd) });

function blockSpan(block) {
  const { text } = state.index;
  let start = state.index.offsetOf(block, 0);
  let end = state.index.offsetOf(block, block.childNodes.length);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

const blockAnchor = (block, { start, end }) => ({ ...describe(state.index, start, end), ...sourceOf(block) });

// CSS Custom Highlight API, no DOM surgery.
let paintedNames = [];
function paint() {
  if (!window.CSS?.highlights) return;
  const rangesByHighlight = { anno: [], "anno-remove": [], "anno-good": [], agent: [], pending: [], "anno-active": [] };
  for (const name of highlightNames()) rangesByHighlight[name] = [];
  for (const annotation of state.annotations) {
    const at = state.located.get(annotation.id);
    if (!at || at.start === at.end) continue;
    const name = annotation.id === state.activeId ? "anno-active" : highlightOf(labelIdsOf(annotation));
    (rangesByHighlight[name] ??= []).push(at.range);
  }
  for (const reply of state.replies) if (reply.located) rangesByHighlight.agent.push(reply.located.range);
  if (state.draft?.range && !state.draft.range.collapsed) rangesByHighlight.pending.push(state.draft.range);
  // The agent's marks sit under the reviewer's annotations; only the focused one rises above them.
  const priorities = { "anno-active": 2, pending: 2 };
  for (const { name, priority, ranges } of markHighlights()) {
    rangesByHighlight[name] = ranges;
    priorities[name] = priority;
  }
  // A changed label list renames the label highlights; drop the ones this page painted before.
  for (const name of paintedNames) if (!(name in rangesByHighlight)) CSS.highlights.delete(name);
  paintedNames = Object.keys(rangesByHighlight);
  for (const [name, ranges] of Object.entries(rangesByHighlight)) {
    const highlight = new Highlight(...ranges);
    if (priorities[name]) highlight.priority = priorities[name];
    CSS.highlights.set(name, highlight);
  }
  paintPoints();
}

function paintPoints() {
  ui.marks.replaceChildren();
  const origin = ui.page.getBoundingClientRect();
  const points = state.annotations
    .map((annotation) => state.located.get(annotation.id))
    .filter((at) => at && at.start === at.end)
    .map((at) => at.range);
  if (state.draft?.range?.collapsed) points.push(state.draft.range);
  for (const range of points) {
    const rect = caretRect(range);
    if (!rect) continue;
    const mark = el("div", { className: "mark-point" });
    Object.assign(mark.style, { left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, height: `${rect.height || 18}px` });
    ui.marks.append(mark);
  }
  paintChangeMarks();
  paintMarkTicks();
}

function caretRect(range) {
  const rects = range.getClientRects();
  if (rects.length) return rects[0];
  if (range.startOffset > 0 && range.startContainer.nodeType === Node.TEXT_NODE) {
    const before = range.cloneRange();
    before.setStart(range.startContainer, range.startOffset - 1);
    const last = [...before.getClientRects()].pop();
    if (last) return new DOMRect(last.right, last.top, 0, last.height);
  }
  return null;
}

// A point label (insert) means nothing for a comment on the whole document; a hidden gateway shows only once ⚙ has picked it.
const usableLabels = (scope, picked = []) => allLabels().filter((label) => (scope !== "general" || !label.point) && (!label.hidden || picked.includes(label.id)));
// Spans keep the last labels (labelling a run of spans alike); a general comment starts from the first one.
const defaultLabels = (scope) => {
  const usable = usableLabels(scope).map((label) => label.id);
  return scope !== "general" && state.lastLabels.length && state.lastLabels.every((id) => usable.includes(id)) ? [...state.lastLabels] : [usable[0]];
};

function render() {
  paint();
  renderAnnotations();
  renderAgentMessages();
  renderSubmit();
  renderOutlineBadges([...state.located.values()].map((at) => at.start));
  refreshThreadViews();
}

// Annotations restored from before timestamps existed fall back to their id order.
const createdOf = (annotation) => annotation.createdAt ?? Number(annotation.id.slice(1));
const ORDERINGS = {
  document: (annotation) => (annotation.scope === "general" ? -1 : state.located.get(annotation.id)?.start ?? Number.MAX_SAFE_INTEGER),
  created: (annotation) => -createdOf(annotation),
  edited: (annotation) => -(annotation.editedAt ?? createdOf(annotation)),
};

function renderAnnotations() {
  const sortKey = ORDERINGS[ui.order.value] ?? ORDERINGS.document;
  const shown = ui.repliesOnly.checked ? state.annotations.filter((annotation) => state.replies.some((reply) => threadIdOf(reply) === annotation.id)) : state.annotations;
  const ordered = [...shown].sort((a, b) => sortKey(a) - sortKey(b));
  ui.annotationList.replaceChildren(...ordered.map(annotationItem));
  ui.empty.hidden = ordered.length > 0;
  ui.empty.textContent = ui.repliesOnly.checked ? "No replies yet." : "Select text in the document to annotate it.";
}

// queued: no `wait` was armed, the agent is busy. seen: a `wait` has handed it to the agent.
const STATUS = {
  draft: ["draft", ""],
  queued: ["queued · agent busy", "queued"],
  sent: ["sent", "sent"],
  delegated: ["with a new agent", "sent"],
  seen: ["with agent ✓", "sent"],
  submitted: ["submitted ✓", "sent"],
};

function annotationItem(annotation) {
  const labels = labelIdsOf(annotation).map(labelFor);
  const orphan = annotation.anchor && !state.located.has(annotation.id);
  const [statusText, statusClass] = orphan ? ["not found in text", "orphan"] : STATUS[annotation.status] ?? [annotation.status, ""];
  const where = annotation.scope === "general" ? "general" : annotation.lines ? `L${annotation.lines}` : "";

  const item = el("li", { className: `item${annotation.id === state.activeId ? " active" : ""}${annotation.scope === "general" ? " general" : ""}` });
  item.dataset.id = annotation.id;
  item.append(
    el("div", { className: "head" }, [
      el("span", { textContent: labels.map((label) => label.icon).join(""), title: labels.map((label) => label.description ?? label.name).join("\n") }),
      el("strong", { textContent: labels.map((label) => label.name).join(" · ") }),
      el("span", { className: "tag", textContent: [annotation.id, where, annotation.markSet && `◆ ${annotation.markSet}`].filter(Boolean).join(" · ") }),
      el("span", { className: `state ${statusClass}`, textContent: statusText }),
    ]),
  );
  if (annotation.anchor) {
    const excerpt = annotation.anchor.quote || `insert after “…${annotation.anchor.prefix.slice(-24)}”`;
    item.append(el("div", { className: "excerpt", textContent: excerpt }));
  }
  if (annotation.text) item.append(el("div", { className: "text", textContent: annotation.text }));
  const thread = threadFor(annotation.id);
  item.append(...thread.turns.map((turn) => turnBlock(annotation.id, turn)));
  const progress = progressNode(thread);
  if (progress) item.append(progress);

  if (annotation.status === "draft") {
    item.append(
      el("div", { className: "actions" }, [
        button("Edit", () => editAnnotation(annotation)),
        button(cardRows.get(annotation.id)?.sendNowText() ?? "Send now", () => send(annotation, { ticks: cardRows.get(annotation.id)?.ticks() })),
        Object.assign(button("▾", () => toggleCardRow(annotation)), { className: "send-more", title: "Who answers: send buttons and checkboxes" }),
        button("Delete", () => removeAnnotation(annotation)),
      ]),
    );
    if (cardRows.get(annotation.id)?.open) item.append(cardRows.get(annotation.id).node);
  }
  item.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    activate(annotation.id, { revealInDoc: true });
  });
  return item;
}

// On a draft card the send row stays folded, so a page of stamps stays short.
const cardRows = new Map();

function toggleCardRow(annotation) {
  if (!cardRows.has(annotation.id)) {
    cardRows.set(annotation.id, createSendRow({
      onButton: (sendButton, model, effort) => send(annotation, { button: sendButton, model, effort }),
      onChange: () => renderAnnotations(),
      onSaved: announceTicksKept,
    }));
  }
  const row = cardRows.get(annotation.id);
  row.open = !row.open;
  renderAnnotations();
}

const announceTicksKept = () => toast("These ticks are now this PC's default. May edit never sticks.");

function renderAgentMessages() {
  const known = new Set(state.annotations.map((annotation) => annotation.id));
  const looseThreads = [...new Set(state.replies.map(threadIdOf))].filter((id) => !known.has(id));
  ui.agent.hidden = looseThreads.length === 0;
  ui.agentList.replaceChildren(
    ...looseThreads.map((id) => {
      const thread = threadFor(id);
      const item = el("li", { className: "item" }, [...thread.turns.map((turn) => turnBlock(id, turn)), progressNode(thread)].filter(Boolean));
      item.dataset.thread = id;
      const located = state.replies.find((reply) => threadIdOf(reply) === id && reply.located)?.located;
      if (located) {
        item.addEventListener("click", (event) => {
          if (!event.target.closest("button")) reveal(located.range);
        });
      }
      return item;
    }),
  );
}

// A reply to no annotation starts a thread of its own, named after its place in the inbox; the server knows it by the same name.
const threadIdOf = (reply) => reply.annotationId ?? `r${reply.seq}`;

function threadFor(id) {
  const annotation = state.annotations.find((candidate) => candidate.id === id);
  const replies = state.replies.filter((reply) => threadIdOf(reply) === id);
  if (!annotation && replies.length === 0) return null;
  const turns = [
    ...replies.map((reply) => ({
      by: "agent",
      thread: id,
      seq: reply.seq,
      html: reply.html,
      at: Date.parse(reply.at),
      who: reply.by,
      changed: reply.changed,
      note: reply.note,
      suggestion: state.settledSuggestions.has(reply.seq) ? undefined : reply.suggestion,
      documentChanged: reply.documentChanged && reply.seq > state.reloadedAtSeq,
    })),
    ...state.followUps.filter((followUp) => followUp.replyTo === id).map((followUp) => ({ by: "reviewer", text: followUp.text, at: followUp.at, statusText: STATUS[followUp.status]?.[0] })),
  ].sort((a, b) => a.at - b.at);
  const run = state.runs.get(id);
  const askedAt = Math.max(annotation?.askedAt ?? 0, ...turns.filter((turn) => turn.by === "reviewer").map((turn) => turn.at));
  const answeredAt = Math.max(0, ...turns.filter((turn) => turn.by === "agent").map((turn) => turn.at));
  return {
    id,
    title: annotation ? [id, annotation.lines && `L${annotation.lines}`].filter(Boolean).join(" · ") : "From the agent",
    quote: annotation?.anchor?.quote ?? replies[0]?.quote,
    comment: annotation?.text,
    turns,
    run,
    mayEdit: run?.mayEdit,
    // A run shows its own progress, and one that failed will not answer.
    awaitingSince: askedAt > answeredAt && (!run || run.state === "done") ? askedAt : null,
  };
}

// What a reply offers wherever it shows: a run's suggested rewrite, and a way to see what it did to the document.
function replyExtras(turn) {
  const extras = [];
  if (turn.suggestion) {
    extras.push(
      el("div", { className: "reply-suggestion" }, [
        el("p", { textContent: turn.suggestion }),
        el("div", { className: "reply-actions" }, [button("Use", () => useSuggestion(turn)), button("Dismiss", () => settleSuggestion(turn))]),
      ]),
    );
  }
  if (turn.documentChanged) {
    extras.push(
      el("div", { className: "reply-actions" }, [
        Object.assign(button("↻ Show the edit", () => api.reloadDocument()), { className: "reply-reload", title: "Re-read the file and re-render it in place; your drafts stay" }),
      ]),
    );
  }
  return extras;
}

function settleSuggestion(turn) {
  state.settledSuggestions.add(turn.seq);
  save();
  render();
}

function useSuggestion(turn) {
  const annotation = state.annotations.find((candidate) => candidate.id === turn.thread);
  const now = Date.now();
  state.annotations.push({ id: `a${state.nextId++}`, label: "change", labels: ["change"], text: turn.suggestion, scope: annotation?.scope ?? "general", anchor: annotation?.anchor ?? null, status: "draft", createdAt: now, editedAt: now });
  relocate();
  settleSuggestion(turn);
}

function turnBlock(threadId, turn) {
  const block = turnNode(turn);
  if (turn.by === "agent") {
    block.append(
      el("div", { className: "reply-actions" }, [
        button("Reply", () => openThreadPanel(threadId, { reply: true })),
        Object.assign(button("⤢", () => openThreadPanel(threadId)), { className: "expand", title: "Open the whole thread in the large panel · or double-click the card" }),
      ]),
    );
  }
  return block;
}

async function sendFollowUp(replyTo, { text, spokenRanges, alternatives }) {
  const followUp = { id: `a${state.nextId++}`, replyTo, text, spokenRanges, alternatives, at: Date.now() };
  const scope = state.annotations.find((annotation) => annotation.id === replyTo)?.scope ?? "general";
  try {
    const accepted = await api.postEvent({ kind: "send", mode: "reply", annotations: [{ id: followUp.id, replyTo, text, scope, skills: skillsNamedIn(text).length ? skillsNamedIn(text) : undefined, ...spokenOnWire(followUp) }] });
    followUp.status = accepted.delegated ? "delegated" : accepted.agentListening ? "sent" : "queued";
    state.followUps.push(followUp);
    save();
    render();
    toast(`Sent — the answer will appear in the thread.${busyNote(accepted)}`);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

const spokenOnWire = ({ spokenRanges, alternatives }) => ({
  spokenRanges: spokenRanges?.length ? spokenRanges : undefined,
  alternatives: alternatives?.length ? alternatives : undefined,
});

function renderSubmit() {
  const draftCount = state.annotations.filter((annotation) => annotation.status === "draft").length;
  ui.sendDrafts.disabled = draftCount === 0 || state.sending;
  ui.sendDrafts.textContent = `Send drafts (${draftCount})`;
  const hasNotes = state.annotations.length > 0;
  const runningCount = [...state.runs.values()].filter((run) => run.state === "waiting" || run.state === "answering").length;
  ui.runsWarning.hidden = runningCount === 0;
  ui.runsWarning.textContent = `${runningCount} run${runningCount === 1 ? "" : "s"} still answering — Submit cancels them`;
  ui.submit.disabled = ui.applySilent.disabled = state.sending;
  ui.submit.textContent = hasNotes ? "Apply & review" : "Approve";
  ui.submit.title = hasNotes ? DECISIONS["apply-review"].title : DECISIONS.approve.title;
  ui.applySilent.hidden = !hasNotes;
}

function activate(id, { revealInDoc = false, scrollList = false } = {}) {
  // Re-rendering an already active card would drop the word a double-click just selected in it.
  if (state.activeId !== id) {
    state.activeId = id;
    render();
  }
  const item = ui.annotationList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (scrollList) item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const at = state.located.get(id);
  if (revealInDoc && at) reveal(at.range);
}

function reveal(range) {
  const rect = range.getBoundingClientRect();
  window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: "smooth" });
}

const SCOPE_NAMES = { pc: "this PC", session: "this session", document: "this document" };

function openPopover(draft) {
  state.draft = draft;
  const general = draft.scope === "general";
  ui.popover.classList.toggle("general", general);
  namePopupKeys();
  renderDraftChips();
  popupBox.sources.load(draft);
  remembering.clear();
  popupRow.reset();
  ui.popover.hidden = false;
  syncStamping();
  placePopup(general ? "general" : "inText");
  paint();
  // Opened before the focus moves in: the focus may carry dictation here, and opening stops whatever is listening.
  onBoxOpened(popupBox);
  ui.popText.focus();
  // With the thread panel over the upper two thirds there is no free space above the popup to scroll into.
  if (draft.range && !threadPanelOpen()) keepSelectionInView(caretRect(draft.range));
}

function namePopupKeys() {
  if (!state.draft) return;
  const keys = [[keyOf("comment.add"), "adds"], [keyOf("comment.sendNow"), "sends now"], [keyOf("skills.open"), "skills"], [canDictate() && keyOf("dictation.toggle"), "dictates"]].filter(([key]) => key);
  ui.popText.placeholder = [state.draft.scope === "general" ? "Comment on the whole document" : "Comment", keys.map(([key, does]) => `${key} ${does}`).join(", ")].filter(Boolean).join(" — ");
}

function renderDraftChips() {
  renderChips(ui.popLabels, usableLabels(state.draft.scope, state.draft.labels), {
    onPick: (id) => selectLabels([id]),
    onToggle: (id) => {
      const picked = state.draft.labels;
      if (!picked.includes(id)) selectLabels([...picked, id]);
      else if (picked.length > 1) selectLabels(picked.filter((existing) => existing !== id));
    },
    onTag: (label) => {
      insertTag(ui.popText, label);
      noteInserted(popupBox);
    },
    onCommit: () => commitDraft({ sendNow: false }),
  });
  selectLabels(state.draft.labels.filter((id) => usableLabels(state.draft.scope, state.draft.labels).some((label) => label.id === id)));
}

function selectLabels(ids) {
  if (!state.draft) return;
  state.draft.labels = ids.length ? ids : defaultLabels(state.draft.scope);
  markChips(ui.popLabels, state.draft.labels);
}

function closePopover() {
  stopDictation(popupBox);
  ui.fixSuggestion.hidden = true;
  remembering.clear();
  state.draft = null;
  ui.popover.hidden = true;
  syncStamping();
  paint();
}

async function commitDraft({ sendNow, button: sendButton = null, model = null, effort = null }) {
  const draft = state.draft;
  if (!draft) return;
  const { text, spokenRanges, alternatives } = popupBox.sources.read();
  let anchor = draft.anchor;
  if (anchor && draft.labels.some((id) => labelFor(id).point) && anchor.quote !== "") {
    const point = state.index.range(draft.end, draft.end);
    anchor = { ...describe(state.index, draft.end, draft.end), ...sourceBlock(point) };
  }

  const mark = draft.mark ?? (draft.scope !== "general" && draft.start != null ? markAt(draft.start, draft.end) : null);
  // An insertion is a point, whatever it was picked on.
  const scope = draft.scope === "block" && draft.labels.some((id) => labelFor(id).point) ? "span" : draft.scope;
  let annotation = state.annotations.find((existing) => existing.id === draft.editingId);
  if (annotation) {
    Object.assign(annotation, { label: draft.labels[0], labels: draft.labels, text, anchor, markId: mark?.id, markSet: mark?.set, spokenRanges, alternatives, skills: skillsNamedIn(text), editedAt: Date.now() });
  } else {
    const now = Date.now();
    annotation = { id: `a${state.nextId++}`, label: draft.labels[0], labels: draft.labels, text, scope, anchor, markId: mark?.id, markSet: mark?.set, spokenRanges, alternatives, skills: skillsNamedIn(text), status: "draft", createdAt: now, editedAt: now };
    state.annotations.push(annotation);
  }
  state.lastLabels = draft.labels;
  closePopover();
  relocate();
  state.activeId = annotation.id;
  save();
  render();
  if (sendNow) await send(annotation, sendButton ? { button: sendButton, model, effort } : { ticks: popupRow.ticks() });
}

function editAnnotation(annotation) {
  const at = state.located.get(annotation.id);
  openPopover({
    editingId: annotation.id,
    scope: annotation.scope,
    anchor: annotation.anchor,
    range: at?.range,
    start: at?.start,
    end: at?.end,
    labels: labelIdsOf(annotation),
    text: annotation.text,
    spokenRanges: annotation.spokenRanges,
    alternatives: annotation.alternatives,
    mark: annotation.markId ? { id: annotation.markId, set: annotation.markSet } : null,
  });
}

function removeAnnotation(annotation) {
  state.annotations = state.annotations.filter((existing) => existing !== annotation);
  relocate();
  save();
  render();
}

function toWire(annotation) {
  const at = state.located.get(annotation.id);
  const anchor = annotation.anchor && { ...annotation.anchor, ...(at ? (annotation.scope === "block" ? sourceOfBlockRange(at.range) : sourceBlock(at.range)) : {}) };
  const labels = labelIdsOf(annotation);
  return { id: annotation.id, label: labels[0], labels, text: annotation.text, scope: annotation.scope, anchor, markId: annotation.markId, markSet: annotation.markSet, skills: annotation.skills?.length ? annotation.skills : undefined, ...spokenOnWire(annotation) };
}

function applyLocated(located) {
  for (const { id, lines } of located ?? []) {
    const annotation = state.annotations.find((existing) => existing.id === id);
    if (annotation && lines) annotation.lines = lines;
  }
}

// A second press while an annotation is on its way would send it twice.
const inFlight = new Set();

// "reply": one annotation, answered in the page. "silent": a coherent group for the agent to work, no answer expected.
async function sendMidRead(annotations, mode, agent) {
  if (annotations.some((annotation) => inFlight.has(annotation.id))) return false;
  for (const annotation of annotations) inFlight.add(annotation.id);
  state.sending = true;
  renderSubmit();
  try {
    const accepted = await api.postEvent({ kind: "send", mode, annotations: annotations.map(toWire), agent });
    for (const annotation of annotations) {
      annotation.status = accepted.delegated ? "delegated" : accepted.agentListening ? "sent" : "queued";
      if (mode === "reply") annotation.askedAt = Date.now();
    }
    applyLocated(accepted.located);
    save();
    render();
    return accepted;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    for (const annotation of annotations) inFlight.delete(annotation.id);
    state.sending = inFlight.size > 0;
    renderSubmit();
  }
}

const busyNote = (accepted) => (accepted.agentListening ? "" : " The agent is busy — it's queued and will be picked up next.");

/** @param how { button, model, effort } for a send button, { ticks } for the checkboxes; neither is the session. */
async function send(annotation, { button: sendButton, model, effort, ticks } = {}) {
  const agent = sendButton ? { button: sendButton.id, model, effort } : ticks ?? undefined;
  const accepted = await sendMidRead([annotation], "reply", agent);
  if (accepted) toast(accepted.delegated ? `Sent ${annotation.id} — a separate run answers under it.` : `Sent ${annotation.id} — the reply will appear under it.${busyNote(accepted)}`);
}

async function sendDrafts() {
  const drafts = state.annotations.filter((annotation) => annotation.status === "draft");
  const accepted = drafts.length && (await sendMidRead(drafts, "silent"));
  if (accepted) toast(`Sent ${drafts.length} annotation(s) as one group.${busyNote(accepted)}`);
}

const DECISIONS = {
  approve: { title: "Nothing to change — finish the review", outcome: "Approved." },
  "apply-review": {
    title: "Finish: the agent applies your notes and opens the revised version for another round",
    outcome: "The agent applies your notes, then opens the revised version in a new tab.",
  },
  "apply-silent": {
    title: "Finish: the agent applies your notes, no further review",
    outcome: "The agent applies your notes and reports in the chat — no further review round.",
  },
};

async function submit(decision) {
  const batch = state.annotations.filter((annotation) => annotation.status === "draft");
  ui.submit.disabled = ui.applySilent.disabled = true;
  try {
    await api.postEvent({ kind: "submit", decision, annotations: batch.map(toWire) });
    endReview(DECISIONS[decision].outcome);
  } catch (error) {
    toast(error.message, true);
    renderSubmit();
  }
}

// Submit is the deliberate end of a review: the page closes itself. Closing the tab without it is an abort.
function endReview(outcome) {
  api.stopInbox();
  forget();
  window.close();
  document.body.replaceChildren(
    el("main", { className: "ended" }, [
      el("h1", { textContent: "Review submitted" }),
      el("p", { textContent: outcome }),
      el("p", { className: "muted", textContent: "The agent takes it from here in the chat. You can close this tab." }),
    ]),
  );
  document.title = `Submitted — ${state.view.fileName}`;
}

async function onInbox(messages, isReplay) {
  let shouldReload = false;
  let settingsChanged = false;
  let labelsChanged = false;
  let marksChanged = false;
  for (const message of messages) {
    if (message.kind === "reload") {
      shouldReload = true;
      state.reloadedAtSeq = message.seq;
    }
    else if (message.kind === "run") noteRun(message);
    else if (message.kind === "buttons") await refreshButtons();
    else if (message.kind === "delivered") markSeen(message.annotationIds);
    else if (message.kind === "labels") labelsChanged = true;
    else if (message.kind === "setting") settingsChanged = true;
    else if (message.kind === "fix" && !isReplay) offerFix(message);
    else if (message.kind === "marks" || message.kind === "unmark") {
      applyMarkMessage(message);
      marksChanged = true;
    }
    else if (message.kind === "reply" && !state.replies.some((reply) => reply.seq === message.seq)) state.replies.push(message);
  }
  if (shouldReload) await loadDocument({ first: false });
  if (labelsChanged) await refreshLabels();
  // A replay after a reconnect may hold changes made meanwhile: they apply quietly.
  for (const key of settingsChanged ? await reloadPreferences() : []) {
    const message = showChangedByAgent(key);
    if (message && !isReplay) toast(message);
  }
  if (marksChanged && state.index) locateMarks(state.index, { refresh: true });
  relocate();
  render();
  if (isReplay) return;
  if (messages.some((m) => m.kind === "marks")) toast(`The agent marked the document: ${markCount()} mark${markCount() === 1 ? "" : "s"} in the left pane.`);
  for (const message of messages.filter((m) => m.kind === "reply")) {
    const id = CSS.escape(threadIdOf(message));
    const item = ui.annotationList.querySelector(`[data-id="${id}"]`) ?? ui.agentList.querySelector(`[data-thread="${id}"]`);
    item?.classList.add("flash");
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (messages.some((m) => m.kind === "reply")) toast("The agent replied.");
  if (shouldReload) toast("The document changed on disk and was re-rendered.");
}

function noteRun({ annotationId: thread, runState, by, error, at, mayEdit }) {
  const known = state.runs.get(thread);
  state.runs.set(thread, { thread, state: runState, by, error, since: runState === "answering" ? Date.parse(at) : known?.since ?? Date.parse(at), mayEdit: mayEdit ?? known?.mayEdit });
}

async function refreshButtons() {
  try {
    setSendButtons(await api.fetchButtons());
  } catch {
    setSendButtons([]);
  }
}

async function refreshLabels() {
  try {
    setLabels(await api.fetchLabels());
  } catch {
    setLabels(null);
  }
  rebuildHotkeys();
  if (state.draft) renderDraftChips();
}

function markSeen(ids) {
  for (const annotation of [...state.annotations, ...state.followUps]) if (ids?.includes(annotation.id) && annotation.status !== "draft") annotation.status = "seen";
  save();
}

function onLink(up, why) {
  ui.link.className = `link ${up ? "up" : "down"}`;
  ui.link.title = up ? "connected to edit-md" : why;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(text, onClick) {
  return el("button", { type: "button", textContent: text, onclick: onClick });
}

let toastTimer;
function toast(text, isError = false) {
  ui.banner.textContent = text;
  ui.banner.title = text;
  ui.banner.style.background = isError ? "var(--bad)" : "";
  ui.banner.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.banner.hidden = true), isError ? 6000 : 3500);
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    return position && { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range && { node: range.startContainer, offset: range.startOffset };
}

function onSelectionEnd() {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!ui.doc.contains(range.commonAncestorContainer)) return;
  const { text } = state.index;
  let start = state.index.offsetOf(range.startContainer, range.startOffset);
  let end = state.index.offsetOf(range.endContainer, range.endOffset);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start === end) return;

  const live = state.index.range(start, end);
  selection.removeAllRanges();
  openPopover({ scope: "span", anchor: { ...describe(state.index, start, end), ...sourceBlock(live) }, range: live, start, end, labels: defaultLabels("span"), text: "" });
}

// The spot and block of the last pick: Alt+clicking the same spot again widens to the enclosing block.
let lastPick = null;

function widerThan(block) {
  const { start, end } = blockSpan(block);
  for (let wider = enclosingBlock(block); wider; wider = enclosingBlock(wider)) {
    const span = blockSpan(wider);
    if (span.start !== start || span.end !== end) return wider;
  }
  return block;
}

function pickBlock(spot) {
  const widening = lastPick?.spot === spot && !ui.popover.hidden && state.draft?.scope === "block";
  const block = widening ? widerThan(lastPick.block) : spot;
  lastPick = { spot, block };
  const span = blockSpan(block);
  const carried = widening ? { ...popupBox.sources.read(), labels: state.draft.labels } : { text: "", labels: defaultLabels("block") };
  openPopover({ scope: "block", anchor: blockAnchor(block, span), range: state.index.range(span.start, span.end), ...span, ...carried });
}

// Again on a text-less stamp removes it, or switches it to the armed label; an annotation with text is never touched.
function stampBlock(block, label) {
  const span = blockSpan(block);
  const stamped = state.annotations.find((annotation) => {
    const at = state.located.get(annotation.id);
    return annotation.scope === "block" && !annotation.text && annotation.status === "draft" && at?.start === span.start && at?.end === span.end;
  });
  if (stamped && labelIdsOf(stamped)[0] === label.id) return removeAnnotation(stamped);
  if (stamped) Object.assign(stamped, { label: label.id, labels: [label.id], editedAt: Date.now() });
  else {
    const now = Date.now();
    const mark = markAt(span.start, span.end);
    state.annotations.push({ id: `a${state.nextId++}`, label: label.id, labels: [label.id], text: "", scope: "block", anchor: blockAnchor(block, span), markId: mark?.id, markSet: mark?.set, status: "draft", createdAt: now, editedAt: now });
  }
  relocate();
  save();
  render();
}

ui.doc.addEventListener("mouseup", (event) => {
  if (!altOnly(event)) setTimeout(onSelectionEnd, 0);
});

ui.doc.addEventListener("click", (event) => {
  // A drag that selected text is not a stamp: it opens the popup, which pauses stamping.
  const stamps = stamping() && (altOnly(event) || getSelection().isCollapsed);
  if (altOnly(event) || stamps) {
    // On a link, Alt+click would download it, and a stamp must not follow it.
    event.preventDefault();
    const block = state.index && blockAt(event.target);
    if (!block) return;
    getSelection().removeAllRanges();
    if (stamps) stampBlock(block, armedLabel());
    else pickBlock(block);
    return;
  }
  if (!getSelection().isCollapsed || !state.index) return;
  const caret = caretAt(event.clientX, event.clientY);
  if (!caret || !ui.doc.contains(caret.node)) return;
  const offset = state.index.offsetOf(caret.node, caret.offset);
  const hits = [...state.located.entries()]
    .filter(([, at]) => at.end > at.start && at.start <= offset && offset <= at.end)
    .sort(([, a], [, b]) => a.end - a.start - (b.end - b.start));
  if (hits.length) activate(hits[0][0], { scrollList: true });
  // A highlight in the text acts as the card's own button in the right pane: Edit on a draft, the chat on an answered one.
  const innermost = state.annotations.find((annotation) => annotation.id === hits[0]?.[0]);
  if (innermost?.status === "draft") {
    editAnnotation(innermost);
    return;
  }
  const answeredThreadId = hits.find(([id]) => threadFor(id).turns.length)?.[0]
    ?? state.replies.filter((reply) => reply.located && reply.located.start <= offset && offset <= reply.located.end).map(threadIdOf)[0];
  if (!answeredThreadId) return;
  if (preference("threads.highlightOpensCard", false)) openThreadCard(answeredThreadId, { x: event.clientX, y: event.clientY });
  else openThreadPanel(answeredThreadId);
});

ui.popover.addEventListener("submit", (event) => {
  event.preventDefault();
  commitDraft({ sendNow: false });
});
// ✨ Fix: the agent corrects misheard words against the document and suggests the text back; it never overwrites what is typed.
async function askForFix() {
  const draft = state.draft;
  const { text, spokenRanges, alternatives } = popupBox.sources.read();
  if (!draft || !text) return;
  const fixId = (draft.fixId = `f${state.nextFix++}`);
  const anchor = draft.anchor && { ...draft.anchor, ...(draft.range && draft.scope !== "block" ? sourceBlock(draft.range) : {}) };
  const labels = draft.labels;
  ui.fixSuggestion.hidden = false;
  ui.fixSuggestion.classList.add("waiting");
  const localTranscript = await heardByLocal();
  if (state.draft !== draft || draft.fixId !== fixId) return;
  // Local's words where they differ from the text reach the agent as `maybe`, like Chrome's own other guesses.
  const guesses = localTranscript ? [...alternatives, { phrase: text, others: [localTranscript] }] : alternatives;
  const request = { id: fixId, label: labels[0], labels, text, scope: draft.scope, anchor, ...spokenOnWire({ spokenRanges, alternatives: guesses }), localTranscript: localTranscript ?? undefined };
  try {
    const accepted = await api.postEvent({ kind: "fix", fixId, annotations: [request] });
    ui.fixText.textContent = accepted.agentListening ? "Asking the agent…" : "The agent is busy; its suggestion comes when it is free.";
  } catch (error) {
    ui.fixSuggestion.hidden = true;
    toast(error.message, true);
  }
}

/** With ⚙ "Fix with Local's transcript too", Local transcribes the comment's kept sound only now; a failure leaves the fix to Chrome's text alone. */
async function heardByLocal() {
  if (!keptForLocal(popupBox)) return null;
  ui.fixText.textContent = "Local is transcribing what you said…";
  try {
    return (await localTranscriptOf(popupBox)) || null;
  } catch (error) {
    toast(error.message, true);
    return null;
  }
}

function offerFix(message) {
  if (state.draft?.fixId !== message.fixId) return;
  ui.fixSuggestion.classList.remove("waiting");
  ui.fixSuggestion.hidden = false;
  ui.fixText.textContent = message.text;
}

ui.fix.addEventListener("click", askForFix);

ui.popover.addEventListener("click", (event) => {
  const actor = event.target.closest("[data-act]");
  const act = actor?.dataset.act;
  if (act === "fix-use") {
    // The agent checked it and the reviewer accepted it: nothing misheard is left, and what it corrected may be worth remembering.
    const corrected = popupBox.sources.replacedBy(ui.fixText.textContent);
    popupBox.sources.load({ text: ui.fixText.textContent });
    remembering.offer(corrected);
    ui.fixSuggestion.hidden = true;
    ui.popText.focus();
  }
  if (act === "fix-dismiss") ui.fixSuggestion.hidden = true;
  if (act === "cancel") closePopover();
  if (act === "send") commitDraft({ sendNow: true });
  if (act === "keep") {
    keepPopupBox(actor.dataset.scope);
    toast(`This kind of comment opens here for ${SCOPE_NAMES[actor.dataset.scope]}.`);
  }
  if (act === "reset") {
    resetPopupBox();
    toast("Back to the default place.");
  }
});
// The comment box takes focus as soon as a selection ends; Ctrl+C must still copy the selected text, not the empty box.
document.addEventListener("copy", (event) => {
  const quote = state.draft?.anchor?.quote;
  const field = ui.popText;
  if (!quote || (document.activeElement === field && field.selectionStart !== field.selectionEnd)) return;
  event.clipboardData.setData("text/plain", quote);
  event.preventDefault();
});

ui.popover.addEventListener("keydown", (event) => {
  const sendNow = pressed(event, "comment.sendNow");
  if (sendNow || pressed(event, "comment.add")) {
    event.preventDefault();
    commitDraft({ sendNow });
  }
});

// Esc closes the topmost thing, one at a time.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || closeSkillPicker() || closePalette()) return;
  if (!ui.popover.hidden) {
    if (!closePlaceMenu()) closePopover();
  } else if (!closeThreadView()) dropPick();
});

ui.seek.addEventListener("click", () => openPopover({ scope: "general", anchor: null, range: null, labels: ["seek"], text: "" }));
ui.general.addEventListener("click", () =>
  openPopover({ scope: "general", anchor: null, range: null, labels: defaultLabels("general"), text: "" }),
);
ui.submit.addEventListener("click", () => submit(state.annotations.length ? "apply-review" : "approve"));
ui.applySilent.addEventListener("click", () => submit("apply-silent"));
ui.sendDrafts.addEventListener("click", sendDrafts);

// The pane's own controls, ⚙ and the agent change the same settings; each change shows here.
ui.order.value = preference("annotations.order", "document");
ui.order.addEventListener("change", () => savePreference("pc", "annotations.order", ui.order.value));
onPreferenceChange("annotations.order", (order) => {
  ui.order.value = order;
  renderAnnotations();
});
const popupRow = createSendRow({
  onButton: (sendButton, model, effort) => commitDraft({ sendNow: true, button: sendButton, model, effort }),
  onChange: (row) => {
    ui.popupSend.textContent = row.sendNowText();
  },
  onSaved: announceTicksKept,
});
ui.sendSlot.append(popupRow.node);
// A double-click on a card's background opens its chat, as ⤢ does; on a word it only selects the word.
// Chrome selects the nearest word even from a padding or the empty end of a line, so the background is told by where the
// point lies — on a line's run of text or not — never by the selection.
function isOnRunOfText(element, x, y) {
  const run = document.createRange();
  return [...element.childNodes].some((node) => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) return false;
    run.selectNodeContents(node);
    return [...run.getClientRects()].some((line) => x >= line.left && x <= line.right && y >= line.top && y <= line.bottom);
  });
}
for (const [list, threadIdOfItem] of [[ui.annotationList, (item) => item.dataset.id], [ui.agentList, (item) => item.dataset.thread]]) {
  list.addEventListener("dblclick", (event) => {
    const item = event.target.closest("li.item");
    if (!item || event.target.closest("button, input, textarea, select, a")) return;
    const hitText = isOnRunOfText(event.target, event.clientX, event.clientY);
    const threadId = threadIdOfItem(item);
    if ((hitText && !getSelection().isCollapsed) || !state.replies.some((reply) => threadIdOf(reply) === threadId)) return;
    getSelection().removeAllRanges();
    openThreadPanel(threadId);
  });
}
function showCompact(compact) {
  ui.compact.checked = compact;
  ui.annotationList.classList.toggle("compact", compact);
}
showCompact(preference("annotations.compact", false));
ui.compact.addEventListener("change", () => savePreference("pc", "annotations.compact", ui.compact.checked));
onPreferenceChange("annotations.compact", showCompact);
ui.repliesOnly.checked = preference("annotations.repliesOnly", false);
ui.repliesOnly.addEventListener("change", () => savePreference("pc", "annotations.repliesOnly", ui.repliesOnly.checked));
onPreferenceChange("annotations.repliesOnly", (repliesOnly) => {
  ui.repliesOnly.checked = repliesOnly;
  renderAnnotations();
});
bindSettings({
  onPopupReset: () => toast("Kept popup positions are reset."),
  onAsk: (labelId) => openPopover({ scope: "general", anchor: null, range: null, labels: [labelId], text: "" }),
});
bindThreads({
  threadFor,
  sendFollowUp,
  replyExtras,
  cancelRun: (thread) => api.cancelRun(thread),
  onPlaceKept: (scope) => toast(`The thread panel opens here for ${SCOPE_NAMES[scope]}.`),
  onPlaceReset: () => toast("Back to the default place."),
  toast,
});
bindMarks({
  resolve: ({ hit, range, set, mark }) =>
    openPopover({ scope: "span", anchor: { ...describe(state.index, hit.start, hit.end), ...sourceBlock(range) }, range, start: hit.start, end: hit.end, labels: defaultLabels("span"), text: "", mark: { id: mark.id, set } }),
  focusChanged: () => paint(),
});
bindMic({ boxes: [popupBox, replyBox], onProblem: (text) => toast(text, true) });
bindSkillPicker({
  boxes: [popupBox, replyBox],
  fetchSkills: api.fetchSkills,
  runIsBlank: () => {
    const ticks = popupBox.isOpen() ? popupRow.ticks() : null;
    return !!ticks && !ticks.repo;
  },
  onInserted: (box) => noteInserted(box),
});
bindStamps({
  labels: () => allLabels().filter((label) => !label.hidden),
  popupOpen: () => !ui.popover.hidden,
  inReplyBox: () => document.activeElement === replyBox.textarea,
  pickInPopup: (label) => {
    if (!usableLabels(state.draft.scope).includes(label)) return;
    const picked = state.draft.labels;
    selectLabels(picked.includes(label.id) ? picked.filter((id) => id !== label.id) : [label.id]);
  },
  onBlocked: () => toast("Finish the open comment first."),
});
window.addEventListener("resize", () => paintPoints());
// Late layout shifts (images, diagrams, fonts) move the gutter marks without a resize.
new ResizeObserver(() => paintPoints()).observe(ui.doc);

// On a narrow screen the pane stacks above the document, so it starts collapsed there; on a wide one it keeps the reviewer's choice.
const narrow = matchMedia("(max-width: 860px)");
let outlineWanted = preference("outline.shown", true);

function showOutline(open) {
  document.body.classList.toggle("outline-hidden", !open);
  ui.outlineToggle.setAttribute("aria-expanded", String(open));
  paintPoints();
  markCurrentSection();
}

ui.outlineToggle.addEventListener("click", () => {
  const opening = document.body.classList.contains("outline-hidden");
  if (!narrow.matches) savePreference("pc", "outline.shown", opening);
  showOutline(opening);
});
onPreferenceChange("outline.shown", (shown) => {
  outlineWanted = shown;
  if (!narrow.matches) showOutline(shown);
});
narrow.addEventListener("change", () => showOutline(!narrow.matches && outlineWanted));
showOutline(!narrow.matches && outlineWanted);

await refreshLabels();
await refreshButtons();
await loadSkills();
try {
  await loadDocument({ first: true });
  if (state.view.submitted) endReview("This review was already submitted.");
  else api.pollInbox(onInbox, onLink);
} catch (error) {
  ui.doc.textContent = error.message;
  onLink(false, error.message);
}
