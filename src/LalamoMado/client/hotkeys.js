// One table binds every key the page reacts to (plan 17). Each action has a stable id, its key is the setting hotkeys.<id>,
// and every hint reads this table, so a rebound key shows everywhere at once. Actions are found by id, never by where their code sits.

import { allLabels } from "./labels.js";
import { onPreferenceChange, preference, preferenceScope, settingsRegistry } from "./prefs.js";

// The more specific level wins a key two actions want; a default is the least specific.
const LEVELS = ["document", "session", "repo", "pc", null];
const PREFIX = "hotkeys.";
const listeners = new Set();
let table = new Map();

/** Every action with its wanted key and, when another action took that key, the one that did. */
function build() {
  const actions = settingsRegistry()
    .filter((setting) => setting.type === "hotkey")
    .map((setting) => ({ id: setting.key.slice(PREFIX.length), name: setting.name, settingKey: setting.key }));
  // A label added after the page loaded has no registry entry yet: its list's digit binds it.
  for (const label of allLabels())
    if (!label.hidden && !label.point && !actions.some((action) => action.id === `label.${label.id}`))
      actions.push({ id: `label.${label.id}`, name: `Label ${label.icon} ${label.name}`, settingKey: `${PREFIX}label.${label.id}`, fallback: label.hotkey ? `Alt+${label.hotkey}` : "" });
  const wanted = actions.map((action) => ({ ...action, key: preference(action.settingKey, action.fallback ?? "") || null, level: LEVELS.indexOf(preferenceScope(action.settingKey)) }));
  const next = new Map();
  for (const action of wanted) {
    const winner = action.key && wanted.filter((other) => other.key === action.key).sort((a, b) => a.level - b.level)[0];
    next.set(action.id, { ...action, key: winner === action ? action.key : null, wantedKey: action.key, takenBy: winner && winner !== action ? winner : null });
  }
  table = next;
  for (const listener of listeners) listener();
}

/** Call once the preferences are loaded. */
export function bindHotkeys() {
  for (const setting of settingsRegistry()) if (setting.type === "hotkey") onPreferenceChange(setting.key, build);
  build();
}

/** Call when the labels change: a label's key comes with it. */
export const rebuildHotkeys = build;

/** `listener()` runs whenever a key changes, so hints already shown can follow. */
export const onHotkeysChange = (listener) => listeners.add(listener);

/** The key bound to an action, as the hints name it, or null when it has none. */
export const keyOf = (id) => table.get(id)?.key ?? null;

/** For ⚙: the key an action wants and the action that took it, when one did. */
export const bindingOf = (id) => table.get(id) ?? null;

export const withKey = (text, id, joiner = " — ") => (keyOf(id) ? `${text}${joiner}${keyOf(id)}` : text);

/** The digit that picks a label: Alt with it, and alone while stamping. */
export const digitOfLabel = (labelId) => keyOf(`label.${labelId}`)?.slice("Alt+".length) ?? null;

export const labelOnDigit = (digit) => allLabels().find((label) => digitOfLabel(label.id) === String(digit)) ?? null;

/**
 * Whether a keydown is the action's key. A letter goes by what the key prints (Z and Y swap on the Czech layout), by its place only where it prints no Latin letter;
 * a digit by its place, since the Czech digit row prints accented letters.
 */
export function pressed(event, id) {
  const shortcut = parse(keyOf(id));
  if (!shortcut || shortcut.tapped) return false;
  if ((event.ctrlKey || event.metaKey) !== shortcut.ctrl || event.altKey !== shortcut.alt || event.shiftKey !== shortcut.shift) return false;
  if (/^[A-Z]$/.test(shortcut.key)) return /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() === shortcut.key : event.code === `Key${shortcut.key}`;
  if (/^[0-9]$/.test(shortcut.key)) return event.code === `Digit${shortcut.key}`;
  return event.key === (shortcut.key === "Space" ? " " : shortcut.key) || event.code === shortcut.key;
}

/** For a tap: the modifier keys, as `KeyboardEvent.key` names them, that pressed and released alone do the action. */
export function tapOf(id) {
  const shortcut = parse(keyOf(id));
  return shortcut?.tapped ? [shortcut.ctrl && "Control", shortcut.alt && "Alt", shortcut.shift && "Shift"].filter(Boolean) : null;
}

function parse(binding) {
  if (!binding) return null;
  const tapped = binding.endsWith(" tapped");
  const parts = binding.replace(/ tapped$/, "").split("+");
  return { tapped, key: tapped ? null : parts.pop(), ctrl: parts.includes("Ctrl"), alt: parts.includes("Alt"), shift: parts.includes("Shift") };
}
