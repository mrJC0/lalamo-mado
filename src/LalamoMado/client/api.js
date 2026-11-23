// The only module that knows the server's routes.

export const docId = decodeURIComponent(location.pathname.split("/")[2] ?? "");

const jsonHeaders = { "content-type": "application/json" };

// Marks this page's polls as a real tab; stray pollers without it never count as one.
const tabId = crypto.randomUUID?.() ?? String(Math.random()).slice(2);

export async function fetchDocument() {
  const response = await fetch(`/api/docs/${docId}`);
  if (!response.ok) throw new Error(`Document ${docId} is not open on this edit-md server.`);
  return response.json();
}

export async function fetchLabels() {
  const response = await fetch(`/api/docs/${docId}/labels`);
  if (!response.ok) throw new Error("no labels for this document");
  return (await response.json()).labels;
}

export async function fetchSkills() {
  const response = await fetch(`/api/docs/${docId}/skills`);
  if (!response.ok) throw new Error("no skills for this document");
  return (await response.json()).skills;
}

export async function fetchButtons() {
  const response = await fetch(`/api/docs/${docId}/buttons`);
  if (!response.ok) throw new Error("no send buttons for this document");
  return (await response.json()).buttons;
}

export async function fetchGlossary() {
  const response = await fetch(`/api/docs/${docId}/glossary`);
  if (!response.ok) throw new Error("no glossary for this document");
  return response.json();
}

/** `layer` is "repo" or "user"; answers with the glossary as it now stands. */
export async function rememberMishearing(heard, meant, layer) {
  const response = await fetch(`/api/docs/${docId}/glossary`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ heard, meant, layer }) });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error ?? `The server did not remember it (${response.status}).`);
  return answer;
}

export const cancelRun = (threadId) => fetch(`/api/docs/${docId}/runs/${encodeURIComponent(threadId)}/cancel`, { method: "POST" });

export const reloadDocument = () => fetch(`/api/docs/${docId}/reload`, { method: "POST" });

export async function postEvent(event) {
  const response = await fetch(`/api/docs/${docId}/events`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(event) });
  if (!response.ok) throw new Error(`The server refused the event (${response.status}).`);
  return response.json();
}

const inbox = new AbortController();

// Closing (or reloading) fires pagehide: the server then decides within seconds instead of waiting out a long silence.
addEventListener("pagehide", () => {
  if (!inbox.signal.aborted) navigator.sendBeacon(`/api/docs/${docId}/leaving`);
});

// The open long-poll doubles as the tab's heartbeat: once it lapses before a submit, the server reports "aborted".
// The first, short poll replays what the agent pushed before this page load.
export async function pollInbox(onMessages, onLink) {
  let after = 0;
  let isReplay = true;
  while (!inbox.signal.aborted) {
    try {
      const response = await fetch(`/api/docs/${docId}/inbox?after=${after}&timeout=${isReplay ? 1 : 25}&tab=${tabId}`, { signal: inbox.signal });
      if (response.status === 404) {
        onLink(false, "This document is no longer open on the server.");
        await sleep(5000);
        continue;
      }
      onLink(true);
      if (response.status === 200) {
        const messages = await response.json();
        after = messages[messages.length - 1].seq;
        await onMessages(messages, isReplay);
      }
      isReplay = false;
    } catch {
      if (inbox.signal.aborted) return;
      onLink(false, "edit-md server unreachable");
      await sleep(2000);
    }
  }
}

export const stopInbox = () => inbox.abort();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
