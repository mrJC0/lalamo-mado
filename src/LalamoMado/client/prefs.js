// Preferences the server keeps, so they outlive this browser profile (one per Claude session).
// The settings among them (plan 17) come from the server's registry, which also gives their defaults.

import { docId } from "./api.js";

const SCOPE_PRECEDENCE = ["document", "session", "repo", "pc"];
let stored = { pc: {}, repo: {}, session: {}, document: {} };
let registry = [];
const listeners = new Map();

export async function loadPreferences() {
  stored = (await fetchJson(`/api/prefs?docId=${encodeURIComponent(docId)}`)) ?? stored;
  registry = (await fetchJson(`/api/settings?docId=${encodeURIComponent(docId)}`))?.settings ?? registry;
}

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export const settingsRegistry = () => registry;

/** A registered setting's default wins over the caller's fallback, so the registry is the one place a default is written. */
export function preference(key, fallback) {
  for (const scope of SCOPE_PRECEDENCE) if (stored[scope]?.[key] !== undefined) return stored[scope][key];
  const setting = registry.find((known) => known.key === key);
  return setting ? setting.default : fallback;
}

/** Where the value in effect comes from: a scope, or null for the default. */
export const preferenceScope = (key) => SCOPE_PRECEDENCE.find((scope) => stored[scope]?.[key] !== undefined) ?? null;

/** `listener(value)` runs whenever the value in effect changes: here, from ⚙, or from the agent. */
export function onPreferenceChange(key, listener) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
}

/** @param value null removes the key from that scope. */
export function savePreference(scope, key, value) {
  const before = preference(key);
  stored[scope] ??= {};
  if (value === null) delete stored[scope][key];
  else stored[scope][key] = value;
  fetch("/api/prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, key, value, docId }),
  }).catch(() => {});
  if (!sameValue(before, preference(key))) notify(key);
}

/** After a change made elsewhere, the agent's: re-reads every scope. @returns the keys whose value in effect changed. */
export async function reloadPreferences() {
  const fresh = await fetchJson(`/api/prefs?docId=${encodeURIComponent(docId)}`);
  if (!fresh) return [];
  const keys = new Set(SCOPE_PRECEDENCE.flatMap((scope) => [...Object.keys(stored[scope] ?? {}), ...Object.keys(fresh[scope] ?? {})]));
  const before = new Map([...keys].map((key) => [key, preference(key)]));
  stored = fresh;
  const changed = [...keys].filter((key) => !sameValue(before.get(key), preference(key)));
  for (const key of changed) notify(key);
  return changed;
}

function notify(key) {
  for (const listener of listeners.get(key) ?? []) listener(preference(key));
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
