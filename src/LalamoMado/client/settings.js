// The settings panel behind the gear in the bar, built from the server's registry (plan 17): the agent finds and changes the same settings.

import { onPreferenceChange, preference, preferenceScope, savePreference, settingsRegistry } from "./prefs.js";
import { resetAllFloatingBoxes } from "./floating.js";
import { allLabels } from "./labels.js";
import { bindingOf, onHotkeysChange } from "./hotkeys.js";
import { canDictate } from "./mic.js";
import { localAvailable, localNote, onLocalStatus } from "./whisper.js";

const toggle = document.querySelector("#settings-toggle");
const panel = document.querySelector("#settings");
const search = document.querySelector("#settings-search");
const sections = document.querySelector("#settings-sections");
const noMatch = document.querySelector("#settings-none");
const REQUIREMENTS = { dictation: canDictate, local: localAvailable };
const SCOPE_NAMES = { repo: "this repo", session: "this session", document: "this document" };
const rows = [];
const localNoteLine = Object.assign(document.createElement("p"), { className: "setting-note" });

/** Call once the preferences are loaded. `onAsk(labelId)` opens a general comment of that hidden kind, a way into edit-md's own configuration. */
export function bindSettings({ onPopupReset, onAsk }) {
  for (const button of panel.querySelectorAll("[data-ask]"))
    button.addEventListener("click", () => {
      setOpen(false);
      onAsk(button.dataset.ask);
    });
  for (const [section, settings] of Map.groupBy(settingsRegistry(), (setting) => setting.section)) sections.append(sectionNode(section, settings));
  const dictation = sections.querySelector('[data-section="Dictation"]');
  dictation?.append(document.querySelector("#setting-glossary"), localNoteLine);
  sections.querySelector('[data-section="Hotkeys"]')?.append(Object.assign(document.createElement("p"), { className: "setting-note", textContent: "To change a key, ask the agent: say which action and which key." }));
  search.addEventListener("input", applySearch);
  onLocalStatus(refresh);
  refresh();
  document.querySelector("#setting-reset-popup").addEventListener("click", () => {
    resetAllFloatingBoxes();
    onPopupReset();
  });
}

function sectionNode(name, settings) {
  const section = Object.assign(document.createElement("fieldset"), { className: "setting-section" });
  section.dataset.section = name;
  section.append(Object.assign(document.createElement("legend"), { textContent: name }), ...settings.map(rowFor));
  return section;
}

function rowFor(setting) {
  if (setting.type === "hotkey") return hotkeyRowFor(setting);
  const control = controlFor(setting);
  control.dataset.setting = setting.key;
  const scope = Object.assign(document.createElement("span"), { className: "setting-scope" });
  const row = Object.assign(document.createElement("label"), { title: setting.description });
  row.dataset.key = setting.key;
  const name = document.createTextNode(` ${setting.name} `);
  if (setting.type === "toggle") row.append(control, name, scope);
  else row.append(name, control, scope);
  const show = () => {
    const value = preference(setting.key);
    if (setting.type === "toggle") control.checked = !!value;
    else control.value = value;
    // A value kept for a repo, a session or a document wins over this PC, where ⚙ keeps it: only the agent changes it there.
    const keptElsewhere = SCOPE_NAMES[preferenceScope(setting.key)];
    control.disabled = !!keptElsewhere;
    scope.hidden = !keptElsewhere;
    scope.textContent = keptElsewhere ? `· ${keptElsewhere}` : "";
    scope.title = keptElsewhere ? `Kept for ${keptElsewhere}, which wins over this PC: ask the agent to change it.` : "";
  };
  control.addEventListener("change", () => {
    if (setting.type === "number" && (!control.validity.valid || control.value === "")) return;
    savePreference(setting.scopes[0], setting.key, setting.type === "toggle" ? control.checked : setting.type === "number" ? Number(control.value) : control.value);
  });
  onPreferenceChange(setting.key, show);
  rows.push({ setting, row, show, searched: `${setting.section} ${setting.name} ${setting.description} ${setting.key}`.toLowerCase() });
  return row;
}

/** Read-only: the key the action wants, struck through when an action kept for a more specific level took it. */
function hotkeyRowFor(setting) {
  const action = setting.key.slice("hotkeys.".length);
  const key = document.createElement("kbd");
  key.dataset.setting = setting.key;
  const note = Object.assign(document.createElement("span"), { className: "setting-scope" });
  const row = Object.assign(document.createElement("label"), { title: `${setting.description} To change it, ask the agent.` });
  row.dataset.key = setting.key;
  row.append(` ${setting.name} `, key, note);
  const show = () => {
    const binding = bindingOf(action);
    key.textContent = binding?.wantedKey ?? "none";
    key.classList.toggle("shadowed", !!binding?.takenBy);
    const keptFor = SCOPE_NAMES[preferenceScope(setting.key)];
    note.textContent = binding?.takenBy ? `shadowed: ${binding.takenBy.name} has it` : keptFor ? `· ${keptFor}` : "";
    note.hidden = !note.textContent;
  };
  onHotkeysChange(show);
  rows.push({ setting, row, show, searched: `${setting.section} ${setting.name} ${setting.description} ${setting.key}`.toLowerCase() });
  return row;
}

function controlFor(setting) {
  if (setting.type === "toggle") return Object.assign(document.createElement("input"), { type: "checkbox" });
  if (setting.type === "number") return Object.assign(document.createElement("input"), { type: "number", min: setting.min, max: setting.max, step: setting.step });
  const select = document.createElement("select");
  select.append(...setting.choices.map((choice) => new Option(choice.name, choice.value)));
  return select;
}

function refresh() {
  for (const { show } of rows) show();
  // A label list that replaces the shipped one may leave a kind out: its button goes with it.
  for (const button of panel.querySelectorAll("[data-ask]")) button.hidden = !allLabels().some((label) => label.id === button.dataset.ask);
  localNoteLine.textContent = localNote();
  applySearch();
}

const available = (setting) => !setting.requires || !!REQUIREMENTS[setting.requires]?.();

function applySearch() {
  const query = search.value.trim().toLowerCase();
  for (const { setting, row, searched } of rows) row.hidden = !available(setting) || (!!query && !searched.includes(query));
  for (const section of sections.children) section.hidden = ![...section.querySelectorAll("label[data-key]")].some((row) => !row.hidden);
  noMatch.hidden = [...sections.children].some((section) => !section.hidden);
}

/** The agent changed a setting: its line flashes, or the gear while ⚙ is closed. @returns the status message, or null for a key ⚙ does not show. */
export function showChangedByAgent(key) {
  const known = rows.find(({ setting }) => setting.key === key);
  if (!known) return null;
  flash(panel.hidden ? toggle : known.row);
  return `Changed by the agent: ${known.setting.name} — ${valueText(known.setting, preference(key))}`;
}

function valueText(setting, value) {
  if (setting.type === "toggle") return value ? "on" : "off";
  if (setting.type === "choice") return setting.choices.find((choice) => choice.value === value)?.name ?? String(value);
  if (setting.type === "hotkey") return value || "no key";
  return String(value);
}

function flash(element) {
  element.classList.remove("flash");
  void element.offsetWidth;
  element.classList.add("flash");
}

function setOpen(open) {
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  if (open) refresh();
}

toggle.addEventListener("click", () => setOpen(panel.hidden));
document.addEventListener("pointerdown", (event) => {
  if (!panel.hidden && !panel.contains(event.target) && event.target !== toggle) setOpen(false);
});
