// End-to-end: real edit-md server + headless Chrome (CDP) + the agent-side CLI.
// usage: node tests/e2e/roundtrip.mjs <edit-md executable> [chrome executable]
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const exe = resolve(process.argv[2] ?? "src/LalamoMado/bin/Debug/net10.0/edit-md");
const chrome = process.argv[3] ?? defaultChrome();
const workDir = mkdtempSync(join(tmpdir(), "edit-md-e2e-"));
const shots = join(workDir, "shots");
mkdirSync(shots, { recursive: true });
// The workspace is a repo of its own: the server starts there, and a fake claude's edits stay there.
mkdirSync(join(workDir, ".git"));
const fakeClaude = join(workDir, process.platform === "win32" ? "claude.cmd" : "claude");
writeFileSync(fakeClaude, process.platform === "win32" ? `@node "${resolve("tests/e2e/fake-claude.mjs")}" %*\r\n` : `#!/bin/sh\nexec node "${resolve("tests/e2e/fake-claude.mjs")}" "$@"\n`, { mode: 0o755 });
const skillFile = (home, name, description, moreFrontmatter = "") => {
  mkdirSync(join(home, "skills", name), { recursive: true });
  writeFileSync(join(home, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${moreFrontmatter}---\nBody.\n`);
};
const claudeHome = join(workDir, "claude-home");
skillFile(claudeHome, "show-md-for-comment", "Open a Markdown file for comment.");
skillFile(claudeHome, "same-name", "Your own one.", "disable-model-invocation: true\n");
skillFile(join(workDir, ".claude"), "repo-probe", "A skill of this repo.");
skillFile(join(workDir, ".claude"), "same-name", "The repo's one.");
const claudeLog = join(workDir, "fake-claude.log");
writeFileSync(claudeLog, "");
const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeHome, EDIT_MD_CLAUDE: fakeClaude, FAKE_CLAUDE_LOG: claudeLog, EDIT_MD_USER_BUTTONS: join(workDir, "send_buttons.json"), CLAUDE_CODE_SESSION_ID: "edit-md-e2e-roundtrip", EDIT_MD_HOME: join(workDir, "state"), EDIT_MD_PREFS: join(workDir, "prefs.json"), EDIT_MD_USER_LABELS: join(workDir, "comment_labels.json"), EDIT_MD_LOST_GRACE_SECONDS: "3" };
const md = join(workDir, "demo.md");
copyFileSync(resolve("samples/demo.md"), md);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastJsonLine = (out) => JSON.parse(out.trim().split("\n").pop());

function cli(args, input) {
  try {
    return lastJsonLine(execFileSync(exe, args, { env, input, encoding: "utf8" }));
  } catch (failure) {
    if (failure.stdout) return lastJsonLine(failure.stdout);
    throw failure;
  }
}

function lineOf(text) {
  const source = readFileSync(md, "utf8");
  const at = source.indexOf(text);
  assert.ok(at >= 0, `not in file: ${text}`);
  return String(source.slice(0, at).split("\n").length);
}

function waitForEvent(docId, timeout = 30) {
  return new Promise((resolveEvent, reject) => {
    const child = spawn(exe, ["wait", docId, "--timeout", String(timeout)], { env });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("exit", () => {
      try {
        resolveEvent(JSON.parse(out.trim()));
      } catch {
        reject(new Error(`wait printed: ${out}`));
      }
    });
  });
}

function defaultChrome() {
  if (process.platform === "win32") return "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return "google-chrome";
}

class Browser {
  static async launch() {
    const browser = new Browser();
    browser.port = 9300 + Math.floor(Math.random() * 500);
    browser.process = spawn(chrome, ["--headless=new", `--remote-debugging-port=${browser.port}`, `--user-data-dir=${join(workDir, "chrome")}`, "--no-first-run", "about:blank"]);
    for (let i = 0; ; i++) {
      try {
        await fetch(browser.endpoint("/json/version"));
        return browser;
      } catch {
        if (i > 50) throw new Error("Chrome did not start");
        await sleep(200);
      }
    }
  }

  endpoint(path) {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  async newPage(url) {
    const target = await (await fetch(this.endpoint(`/json/new?${encodeURIComponent(url)}`), { method: "PUT" })).json();
    const page = new Page(this, target.id);
    await page.connect(target.webSocketDebuggerUrl);
    return page;
  }

  async isOpen(targetId) {
    const targets = await (await fetch(this.endpoint("/json/list"))).json();
    return targets.some((target) => target.id === targetId);
  }

  kill() {
    this.process.kill();
  }
}

class Page {
  #lastMessageId = 0;
  #pending = new Map();
  errors = [];

  constructor(browser, targetId) {
    this.browser = browser;
    this.targetId = targetId;
  }

  async connect(webSocketUrl) {
    this.ws = new WebSocket(webSocketUrl);
    await new Promise((r) => this.ws.addEventListener("open", r, { once: true }));
    this.ws.addEventListener("message", (m) => this.#onMessage(JSON.parse(m.data)));
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    await this.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }

  #onMessage(message) {
    if (message.id && this.#pending.has(message.id)) {
      this.#pending.get(message.id)(message);
      this.#pending.delete(message.id);
    } else if (message.method === "Runtime.exceptionThrown") {
      this.errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      this.errors.push(message.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  }

  send(method, params = {}) {
    const id = ++this.#lastMessageId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => this.#pending.set(id, r));
  }

  async eval(expression) {
    const { result } = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  async waitFor(expression, what, timeoutMs = 10000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await this.eval(expression)) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${what}${this.errors.length ? `; the page threw: ${this.errors.join(" | ")}` : ""}`);
  }

  async screenshot(name) {
    const { result } = await this.send("Page.captureScreenshot", { format: "png" });
    const file = join(shots, `${name}.png`);
    writeFileSync(file, Buffer.from(result.data, "base64"));
    return file;
  }

  // A renderer crash ends the page without pagehide: the server only sees its polls stop.
  async crash() {
    this.send("Page.crash");
    await sleep(300);
  }

  async close() {
    await fetch(this.browser.endpoint(`/json/close/${this.targetId}`));
  }
}

const pageHelpers = `
window.__rangeOf = (needle, nth = 0) => {
  const doc = document.querySelector("#doc");
  let at = -1;
  for (let k = 0; k <= nth; k++) at = doc.textContent.indexOf(needle, at + 1);
  if (at < 0) throw new Error("not in doc: " + needle);
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0, startSet = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!startSet && at < seen + n.length) { range.setStart(n, at - seen); startSet = true; }
    if (startSet && at + needle.length <= seen + n.length) { range.setEnd(n, at + needle.length - seen); break; }
    seen += n.length;
  }
  return range;
};
window.__select = (needle, nth = 0) => {
  getSelection().removeAllRanges();
  getSelection().addRange(__rangeOf(needle, nth));
  document.querySelector("#doc").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
};
window.__spot = (needle, nth = 0) => {
  __rangeOf(needle, nth).startContainer.parentElement.scrollIntoView({ block: "start" });
  window.scrollBy(0, -innerHeight * 0.75);
  const rect = __rangeOf(needle, nth).getClientRects()[0];
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
window.__centre = (needle, nth = 0) => {
  __rangeOf(needle, nth).startContainer.parentElement.scrollIntoView({ block: "center" });
  const rect = __rangeOf(needle, nth).getClientRects()[0];
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
window.__esc = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
// With lateEnd, stop() ends the run only at __endRun(), as Chrome does after delivering its last result.
window.__fakeMic = ({ lateEnd = false } = {}) => {
  window.__sessions = [];
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    constructor() { __sessions.push(this); }
    start() {}
    stop() { if (lateEnd) this.ending = true; else this.onend?.(); }
    abort() { this.onend?.(); }
  };
};
window.__endRun = () => {
  const session = __sessions.at(-1);
  session.ending = false;
  session.onend?.();
};
// Chrome's events as recorded: [resultIndex, [[isFinal, transcript], …]] each.
window.__replay = (events) => {
  for (const [resultIndex, results] of events)
    __sessions.at(-1).onresult({ resultIndex, results: results.map(([isFinal, transcript]) => Object.assign([{ transcript }], { isFinal })) });
};
window.__heard = (...guesses) => __sessions.at(-1).onresult({ resultIndex: 0, results: [Object.assign(guesses.map((transcript) => ({ transcript })), { isFinal: true })] });
window.__typeOver = (field, from, to) => {
  const at = from === null ? field.value.length : field.value.indexOf(from);
  field.focus();
  field.setSelectionRange(at, from === null ? at : at + from.length);
  document.execCommand("insertText", false, to);
};
window.__annotate = async (needle, nth, label, text, act) => {
  __select(needle, nth);
  await new Promise((r) => setTimeout(r, 50));
  if (document.querySelector("#popover").hidden) throw new Error("popover did not open");
  document.querySelector('#popover [data-label="' + label + '"]').click();
  document.querySelector("#popover textarea").value = text;
  if (act === "send") document.querySelector('#popover [data-act="send"]').click();
  else document.querySelector('#popover button[type="submit"]').click();
  await new Promise((r) => setTimeout(r, 150));
};
window.__text = (selector) => document.querySelector(selector).textContent;
window.__struck = () => {
  const rule = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((r) => r.cssText.includes("::highlight(label-") && r.cssText.includes("line-through"));
  return CSS.highlights.get(rule?.selectorText.match(/highlight\\((.+)\\)/)[1])?.size ?? 0;
};
window.__states = (text) => [...document.querySelectorAll("#annotations .state")].filter((s) => s.textContent === text).length;
window.__badges = () => Object.fromEntries([...document.querySelectorAll("#outline a")].map((a) => [a.querySelector(".title").textContent, a.querySelector(".badge").textContent]));
window.__beside = (pane, doc) => document.querySelector(pane).getBoundingClientRect().right <= document.querySelector(doc).getBoundingClientRect().left;
true`;

const RISKS = "The CSV encoding must stay Windows-1250 for the accounting tool — UTF-8 breaks Czech diacritics like Plzeň and příjemce.\nIf the replica lags, the export may miss invoices issued in the last minutes before midnight.";

let passed = 0;
const check = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

let server = spawn(exe, ["serve"], { env, cwd: workDir });
let browser;
try {
  const { docId, url, labels } = cli(["open", md, "--no-browser"]);
  assert.equal(labels, "default", "open says the agent can skip reading the label list");
  const base = url.replace(/\/d\/.*$/, "");
  console.log(`server up, ${docId} at ${url}\n  screenshots: ${shots}`);
  browser = await Browser.launch();
  let page = await browser.newPage(url);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("Release checklist")`, "doc render");
  await page.eval(pageHelpers);
  assert.ok(await page.eval(`document.querySelectorAll("#doc [data-src-start]").length > 10`));
  assert.equal(await page.eval(`__text("#send-drafts") + "|" + document.querySelector("#send-drafts").disabled`), "Send drafts (0)|true");
  assert.ok(await page.eval(`[...document.querySelectorAll("#doc :is(h1, h2, h3, h4, h5, h6)")].every((heading) => heading.id.startsWith("md-"))`), "a heading cannot take the id of an element of the page");
  const savedAt = statSync(md).mtime;
  const savedTime = await page.eval(`new Date(${savedAt.getTime()}).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`);
  const savedLabel = await page.eval(`__text("#saved-at")`);
  assert.ok(savedLabel.startsWith("saved ") && savedLabel.endsWith(savedTime), `beside the file name, when the version shown was saved — its date too unless today: ${savedLabel}`);
  assert.match(await page.eval(`document.querySelector("#saved-at").title`), /as saved at .*a later time holds a newer version/i, "the hover says what the time is for");
  check("renders with source offsets; Send drafts gated at 0; the version shown says when it was saved");

  assert.deepEqual(
    await page.eval(`[...document.querySelectorAll("#outline .title")].map((t) => t.textContent)`),
    await page.eval(`[...document.querySelectorAll("#doc :is(h1, h2, h3, h4, h5, h6)")].map((h) => h.textContent)`),
  );
  assert.ok(await page.eval(`__beside("#left", "#doc")`), "the left pane sits beside the document");
  assert.ok(await page.eval(`document.querySelector("#changes-toggle").hidden && document.querySelector("#change-marks").children.length === 0`), "a first open marks nothing");
  check("the left pane lists the document's headings, beside the document, never over it");

  let event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`__annotate("The export runs", 1, "question", "Why never the primary?", "send")`);
  const query = await event;
  assert.deepEqual([query.kind, query.mode, query.round, query.annotations.length], ["send", "reply", 1, 1]);
  const [asked] = query.annotations;
  assert.deepEqual([asked.label, asked.text, asked.lines, asked.exact], ["question", "Why never the primary?", lineOf("The export runs on the"), true]);
  await page.waitFor(`__states("with agent ✓") === 1`, "seen-by-agent status");
  assert.match(await page.eval(`document.querySelector('#annotations [data-id="${asked.id}"] .awaiting')?.textContent ?? ""`), /waiting for the answer \d+:\d\d/, "the card shows the answer is still to come");
  check("Send now: one query, reply mode, exact line; the page flips to 'with agent ✓' once `wait` took it, and shows the answer is pending");

  cli(["push", docId, "--to", asked.id], "The primary serves **live invoicing**; exports would compete for locks.");
  await page.waitFor(`[...document.querySelectorAll('#annotations [data-id="${asked.id}"] .reply')].some(r => r.textContent.includes("live invoicing"))`, "reply under the query");
  assert.equal(await page.eval(`document.querySelectorAll('#annotations [data-id="${asked.id}"] .awaiting').length`), 0, "the answer ends the waiting");
  check("push --to threads the reply under that annotation, and the waiting sign goes");

  assert.ok(await page.eval(`(() => {
    const banner = document.querySelector("#banner"), bar = document.querySelector("#bar").getBoundingClientRect();
    const box = banner.getBoundingClientRect();
    return !banner.hidden && banner.textContent.includes("replied") && box.top >= bar.top && box.bottom <= bar.bottom;
  })()`), "the status message shows inside the top bar");
  check("the status message sits in the top bar, never over the document");

  await page.eval(`__annotate("nightly FTP upload", 0, "remove", "We still need it for Zlín.", "add")`);
  await page.eval(`__annotate("Brno branch", 0, "insert", "and Brno-venkov", "add")`);
  await page.eval(`__annotate(${JSON.stringify(RISKS)}, 0, "change", "Move this to the config section.", "add")`);
  assert.equal(await page.eval(`__struck()`), 1, "the remove label paints in its own colour, struck through");
  assert.ok(await page.eval(`document.querySelectorAll("#marks .mark-point").length === 1`), "insert point marker");
  assert.equal(await page.eval(`__text("#send-drafts")`), "Send drafts (3)");
  const copied = await page.eval(`(async () => {
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    const clipboard = new DataTransfer();
    document.activeElement.dispatchEvent(new ClipboardEvent("copy", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    document.querySelector('#popover [data-act="cancel"]').click();
    return clipboard.getData("text/plain");
  })()`);
  assert.equal(copied, "Watch the error dashboard", "Ctrl+C right after selecting copies the selection");
  check("Ctrl+C after selecting copies the selected text although the comment box has focus");

  const badges = () => page.eval(`__badges()`);
  const baselineBadges = { "Release checklist — invoice export v2": "", Scope: "2", "Rollout plan": "1", Configuration: "", Risks: "1" };
  assert.deepEqual(await badges(), baselineBadges);
  await page.eval(`__annotate("Open question: do the branches", 0, "comment", "temporary", "add")`);
  assert.equal((await badges()).Configuration, "1");
  await page.eval(`[...document.querySelectorAll("#annotations .item")].find((i) => i.querySelector(".text")?.textContent === "temporary").querySelector(".actions button:last-child").click()`);
  assert.deepEqual(await badges(), baselineBadges);
  check("outline badges count annotations per section and follow adds and deletes");

  await page.eval(`(async () => {
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector('#popover [data-label="good"]').dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
  })()`);
  assert.ok(await page.eval(`document.querySelector("#popover").hidden`), "Alt+click on a label closes the popover");
  const quickId = await page.eval(`[...document.querySelectorAll("#annotations .item")].find((i) => i.querySelector(".excerpt")?.textContent === "Watch the error dashboard")?.dataset.id`);
  assert.equal(await page.eval(`__text('#annotations [data-id="${quickId}"] strong') + "|" + !document.querySelector('#annotations [data-id="${quickId}"] .text')`), "Looks good|true");
  const orderBy = (value) => page.eval(`(() => {
    const select = document.querySelector("#order");
    select.value = "${value}";
    select.dispatchEvent(new Event("change"));
    return [...document.querySelectorAll("#annotations .item")].map((item) => item.dataset.id);
  })()`);
  const newestFirst = await orderBy("created");
  assert.equal(newestFirst[0], quickId, "newest first puts the latest annotation on top");
  const inDocument = await orderBy("document");
  assert.notEqual(inDocument[0], quickId, "document order puts it back in place");
  await page.eval(`document.querySelector('#annotations [data-id="${quickId}"] .actions button:last-child').click()`);
  check("Alt+click on a label adds the annotation at once; the right pane sorts by document, creation or last edit");

  const chips = await page.eval(`(async () => {
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    const chip = (id) => document.querySelector('#popover [data-label="' + id + '"]');
    const tip = document.querySelector("#popover .chip-tip");
    const described = () => getComputedStyle(tip.querySelector(".more")).display !== "none";
    chip("question").dispatchEvent(new PointerEvent("pointerenter"));
    const atOnce = [!tip.hidden && tip.querySelector("strong").textContent, described()];
    await new Promise((r) => setTimeout(r, 1200));
    const later = described() && tip.querySelector(".more").textContent;
    chip("question").dispatchEvent(new PointerEvent("pointerleave"));
    const delay = document.querySelector('[data-setting="labels.descriptionDelaySeconds"]');
    const delayShown = delay.value;
    delay.value = "0";
    delay.dispatchEvent(new Event("change"));
    chip("change").dispatchEvent(new PointerEvent("pointerenter"));
    await new Promise((r) => setTimeout(r, 50));
    const describedWithNoDelay = described();
    chip("change").dispatchEvent(new PointerEvent("pointerleave"));
    delay.value = delayShown;
    delay.dispatchEvent(new Event("change"));
    chip("question").click();
    chip("change").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    const field = document.querySelector("#popover textarea");
    field.value = "Why here?";
    field.setSelectionRange(0, 0);
    chip("remove").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    const pressed = [...document.querySelectorAll('#popover .labels [aria-pressed="true"]')].map((c) => c.dataset.label);
    document.querySelector('#popover button[type="submit"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const item = [...document.querySelectorAll("#annotations .item")].find((i) => i.querySelector(".excerpt")?.textContent === "Watch the error dashboard");
    const result = { atOnce, later, delayShown, describedWithNoDelay, pressed, text: field.value, head: item.querySelector("strong").textContent };
    item.querySelector(".actions button:last-child").click();
    return result;
  })()`);
  assert.deepEqual(chips.atOnce, ["Question", false], "hovering a chip names it at once, without the description");
  assert.equal(chips.later, "Answer it in the page; do not edit the file for it.", "the description rolls out after a second");
  assert.deepEqual([chips.delayShown, chips.describedWithNoDelay], ["1", true], "⚙ shows the delay, 1 s by default; at 0 the description comes at once");
  assert.deepEqual(chips.pressed, ["question", "change"], "Shift+click adds a second label");
  assert.equal(chips.text, "[🗑️ remove] Why here?", "Ctrl+click puts the tag at the caret, without picking the label");
  assert.equal(chips.head, "Question · Change");
  assert.equal(await page.eval(`document.querySelector('#popover [data-label="change"]').textContent`), "✏️", "chips show only their icon");
  const sessionList = cli(["labels", docId, "--set"], JSON.stringify({ labels: [{ id: "risk", icon: "⚠️", description: "Flag a risk.", color: "#d97706" }] }));
  assert.deepEqual([sessionList.custom, sessionList.labels.at(-1).id, sessionList.labels.at(-1).source], [true, "risk", "session"]);
  const offered = await page.eval(`(async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      __select("Watch the error dashboard", 0);
      await new Promise((r) => setTimeout(r, 100));
      const found = !!document.querySelector('#popover [data-label="risk"]');
      document.querySelector('#popover [data-act="cancel"]').click();
      if (found) return true;
    }
    return false;
  })()`);
  assert.ok(offered, "the page offers a label the agent set for the session");
  assert.equal(cli(["labels", docId, "--clear"]).custom, false);
  check("label chips: icon only, named on hover, described after ~3 s; Shift+click picks several, Ctrl+click tags the text; the agent sets a session list");

  const dictation = await page.eval(`(async () => {
    const sessions = [];
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      constructor() { sessions.push(this); this.starts = 0; }
      start() { this.starts++; }
      stop() { this.stopped = true; this.onend?.(); }
      abort() { this.onend?.(); }
    };
    const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });
    const ctrlD = () => { const key = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }); document.dispatchEvent(key); return key; };
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    const field = document.querySelector("#popover textarea");
    const mic = document.querySelector("#popover .mic");
    field.value = "Check:";
    field.setSelectionRange(6, 6);
    const shortcut = ctrlD();
    const session = sessions[0];
    session.onresult({ resultIndex: 0, results: [result("the export", false)] });
    const interim = field.value;
    session.onresult({ resultIndex: 0, results: [result("the export runs", true)] });
    session.onresult({ resultIndex: 1, results: [result("the export runs", true), result(" nightly", false)] });
    const streamed = field.value;
    session.onend();
    const restarts = session.starts;
    ctrlD();
    const out = { shown: !mic.hidden, kept: shortcut.defaultPrevented, lang: session.lang, interim, streamed, restarts,
      noLocal: document.querySelector("#popover .mic-engine").hidden && document.querySelector('#settings [data-key="dictation.engine"]').hidden,
      stopped: session.stopped === true && mic.getAttribute("aria-pressed") === "false" && session.starts === restarts };
    document.querySelector("#popover .mic-language").click();
    out.language = document.querySelector("#popover .mic-language").textContent;
    document.querySelector('#popover [data-act="cancel"]').click();
    const always = document.querySelector('[data-setting="dictation.always"]');
    always.click();
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    out.always = [sessions.length, sessions.at(-1).lang, mic.getAttribute("aria-pressed"), !always.closest("label").hidden];
    document.querySelector('#popover [data-act="cancel"]').click();
    out.always.push(mic.getAttribute("aria-pressed"));
    always.click();
    return out;
  })()`);
  assert.deepEqual([dictation.shown, dictation.kept, dictation.lang], [true, true, "cs-CZ"], "Ctrl+D starts Czech dictation and keeps Chrome's bookmark shortcut out");
  assert.equal(dictation.interim, "Check: the export", "words still being recognized stream in at the caret");
  assert.equal(dictation.streamed, "Check: the export runs nightly", "final words stay, the next ones follow");
  assert.equal(dictation.restarts, 2, "a session Chrome ends by itself restarts while the mic is on");
  assert.ok(dictation.stopped, "Ctrl+D again stops it for good");
  assert.ok(dictation.noLocal, "without Whisper installed, neither the engine badge nor its ⚙ section shows");
  assert.equal(dictation.language, "EN");
  assert.deepEqual(dictation.always, [2, "en-US", "true", true, "false"], "with ⚙ dictate-always, opening a comment starts listening in the kept language; closing it stops");
  check("dictation: Ctrl+D or 🎤 streams speech in at the caret, keeps listening until stopped, CZ/EN switch, optionally on with every comment");

  const popupBox = () => page.eval(`(() => { const r = document.querySelector("#popover").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const prefs = async () => (await fetch(`${base}/api/prefs?docId=${docId}`)).json();
  const drag = async (from, dx, dy) => {
    const mouse = (type, x, y) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    await mouse("mousePressed", from.x, from.y);
    await mouse("mouseMoved", from.x + dx / 2, from.y + dy / 2);
    await mouse("mouseMoved", from.x + dx, from.y + dy);
    await mouse("mouseReleased", from.x + dx, from.y + dy);
  };
  const centreOf = (selector) => page.eval(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.eval(`(() => {
    const item = [...document.querySelectorAll("#doc li")].find((li) => li.textContent.includes("Watch the error dashboard"));
    window.scrollBy(0, item.getBoundingClientRect().top - innerHeight * 0.85);
  })()`);
  await page.eval(`__select("Watch the error dashboard", 0)`);
  await page.waitFor(`!document.querySelector("#popover").hidden`, "popup open");
  const docked = await popupBox();
  assert.ok(await page.eval(`(() => {
    const popup = document.querySelector("#popover").getBoundingClientRect(), column = document.querySelector("#page").getBoundingClientRect();
    const clear = (pane) => { const r = document.querySelector(pane).getBoundingClientRect(); return popup.right <= r.left || popup.left >= r.right; };
    return popup.left >= column.left && popup.right <= column.right && popup.bottom <= innerHeight && Math.abs(popup.top - innerHeight * 2 / 3) < 24 && clear("#left") && clear("#side");
  })()`), "the popup docks over the lower third of the document column, clear of both panes");
  await page.waitFor(`(() => {
    const item = [...document.querySelectorAll("#doc li")].find((li) => li.textContent.includes("Watch the error dashboard"));
    return item.getBoundingClientRect().bottom <= document.querySelector("#popover").getBoundingClientRect().top;
  })()`, "adaptive scroll lifts the selection above the popup");
  await sleep(400);
  console.log(`    screenshot ${await page.screenshot("7-popup")}`);
  assert.ok(await page.eval(`!document.querySelector("#popover .quote, #popover .pop-head")`), "no header row, no quoted excerpt");
  const placeLit = () => page.eval(`document.querySelector("#popover .place-toggle").classList.contains("changed")`);
  assert.equal(await placeLit(), false, "Place is not lit while the popup sits where it opened");
  await drag(await centreOf("#popover .actions .spacer"), -80, -120);
  const moved = await popupBox();
  assert.ok(Math.abs(moved.left - (docked.left - 80)) < 2 && Math.abs(moved.top - (docked.top - 120)) < 2, "dragging an empty spot moves the popup");
  assert.equal(await placeLit(), true, "Place lights up once the popup was moved");
  const east = await page.eval(`(() => { const r = document.querySelector('#popover .pop-edge[data-edge="e"]').getBoundingClientRect(); return { x: r.left + 3, y: r.top + r.height / 2 }; })()`);
  await drag(east, -100, 0);
  assert.ok(Math.abs((await popupBox()).width - (moved.width - 100)) < 2, "the east edge resizes the popup");
  await page.eval(`document.querySelector("#popover .place-toggle").click()`);
  assert.equal(await page.eval(`document.querySelector("#place-menu").hidden + "|" + __text("#place-menu .variant-name")`), "false|in-text comments", "Place opens its menu, naming the variant");
  await page.eval(`document.querySelector('#place-menu [data-act="keep"][data-scope="document"]').click()`);
  const kept = await popupBox();
  assert.equal(await page.eval(`document.querySelector("#place-menu").hidden`), true, "keeping closes the menu");
  assert.equal(await placeLit(), false, "a kept place is no longer a change");
  await page.waitFor(`document.querySelector("#banner").textContent.includes("this document")`, "keep confirmation");
  assert.deepEqual((await prefs()).document["popup.inText.box"], { left: Math.round(kept.left), top: Math.round(kept.top), width: Math.round(kept.width), height: Math.round(kept.height) });
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  await page.eval(`__select("Roll out to the remaining branches", 0)`);
  assert.deepEqual(await popupBox(), kept, "a kept position is where the next in-text comment opens");
  await page.eval(`document.querySelector("#popover .place-toggle").click()`);
  await page.eval(`document.querySelector('#place-menu [data-act="reset"]').click()`);
  assert.ok(Math.abs((await popupBox()).top - docked.top) < 2 && !("popup.inText.box" in (await prefs()).document), "Reset docks it again and forgets the kept position");
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  await page.eval(`document.querySelector("#general").click()`);
  assert.equal(await page.eval(`document.querySelector("#popover").classList.contains("general") + "|" + document.querySelector("#popover textarea").placeholder.startsWith("Comment on the whole document")`), "true|true");
  assert.ok(Math.abs((await popupBox()).top - docked.top) < 2, "a general comment opens in the same place, tinted");
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  await page.eval(`document.querySelector("#seek").click()`);
  assert.deepEqual(await page.eval(`[document.querySelector("#popover").classList.contains("general"), [...document.querySelectorAll('#popover .labels [aria-pressed="true"]')].map((chip) => chip.dataset.label)]`), [true, ["seek"]], "🔍 Seek in the left pane opens a general comment with Seek picked");
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  assert.ok(await page.eval(`(() => { const end = document.querySelector("#doc-end"); return end.textContent === "end of document" && end.getBoundingClientRect().height >= innerHeight * 0.3; })()`), "the document ends with marked space to scroll into");
  await page.eval(`document.querySelector("#settings-toggle").click()`);
  await page.eval(`document.querySelector('[data-setting="scroll.adaptive"]').click()`);
  await page.waitFor(`!document.querySelector("#settings").hidden`, "settings open");
  await sleep(200);
  assert.equal((await prefs()).pc["scroll.adaptive"], false, "the adaptive-scroll setting is kept server-side");
  await page.eval(`document.querySelector('[data-setting="scroll.adaptive"]').click()`);
  await page.eval(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  assert.ok(await page.eval(`document.querySelector("#settings").hidden`), "a click elsewhere closes the settings");
  check("comment popup: docks over the lower third, lifts the selection above it, moves, resizes, keeps and resets its place; settings kept server-side");

  const shownInSettings = await page.eval(`[...document.querySelectorAll("#settings [data-setting]")].filter((control) => !control.closest("label").hidden).map((control) => control.dataset.setting)`);
  const listedSettings = cli(["settings", docId]).settings;
  assert.ok(shownInSettings.length >= 8 && shownInSettings.every((key) => listedSettings.some((setting) => setting.key === key && setting.description && ["default", "pc"].includes(setting.from))), `edit-md settings lists every setting ⚙ shows, with its description and where its value comes from: ${shownInSettings}`);
  const tickByAgent = cli(["settings", "--set", "threads.highlightOpensCard=true"]);
  assert.deepEqual([tickByAgent.setting.value, tickByAgent.setting.from, tickByAgent.scope], [true, "pc", "pc"], "--set without --scope keeps the value for this PC");
  await page.waitFor(`document.querySelector('[data-setting="threads.highlightOpensCard"]').checked`, "the tick, moved by the agent without a reload");
  assert.equal(await page.eval(`__text("#banner")`), "Changed by the agent: Clicking a chat's highlight opens the small card, not the large panel — on", "the status message names the change");
  assert.ok(await page.eval(`document.querySelector("#settings-toggle").classList.contains("flash")`), "with ⚙ closed, the gear flashes");
  assert.match(cli(["settings", "--set", "threads.highlightOpensCard=maybe"]).error, /true or false/, "a wrong value is refused with what is allowed");
  assert.match(cli(["settings", "--set", "annotations.order=random"]).error, /document, created, edited/);
  assert.match(cli(["settings", "--set", "no.such=1"]).error, /No setting no\.such\. Known: .*scroll\.adaptive/, "an unknown key is refused with the known ones");
  assert.match(cli(["settings", "--set", "dictation.engine=chrome", "--scope", "repo"]).error, /pc, session/, "a scope the setting cannot be kept in is refused");
  cli(["settings", docId, "--set", "annotations.compact=on", "--scope", "repo"]);
  await page.waitFor(`document.querySelector("#annotations").classList.contains("compact")`, "compact cards, set for the repo");
  assert.equal(JSON.parse(readFileSync(join(workDir, ".claude", "edit-md", "prefs.json"), "utf8"))["annotations.compact"], true, "the repo level lives in the repository");
  assert.deepEqual(await page.eval(`[document.querySelector('[data-setting="annotations.compact"]').disabled, __text('[data-key="annotations.compact"] .setting-scope')]`), [true, "· this repo"], "⚙ shows a value kept for the repo, and leaves it to the agent");
  cli(["settings", docId, "--unset", "annotations.compact", "--scope", "repo"]);
  cli(["settings", "--unset", "threads.highlightOpensCard"]);
  await page.waitFor(`!document.querySelector('[data-setting="threads.highlightOpensCard"]').checked && !document.querySelector("#annotations").classList.contains("compact")`, "both back to their defaults");
  await page.eval(`document.querySelector("#settings-toggle").click()`);
  const search = (text) => page.eval(`(() => { const box = document.querySelector("#settings-search"); box.value = ${JSON.stringify(text)}; box.dispatchEvent(new Event("input")); return [...document.querySelectorAll("#settings label[data-key]")].filter((row) => !row.hidden).map((row) => row.dataset.key); })()`);
  assert.deepEqual(await search("chat"), ["threads.highlightOpensCard"], "searching chat leaves only the thread setting");
  assert.ok((await search("")).length >= 8);
  assert.match(await page.eval(`__text("#settings .settings-banner")`), /best changed by asking the agent/);
  await page.eval(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  check("settings: ⚙ built from the registry, with a banner and a search; edit-md settings lists and changes them, refuses what is not allowed, and the open page shows the change at once");

  const gateways = ["setting", "customize-page", "new-kind"];
  const listedLabels = cli(["labels", docId]).labels;
  assert.deepEqual(gateways.map((id) => listedLabels.find((label) => label.id === id)?.hidden), [true, true, true], "edit-md labels lists the gateways as hidden");
  await page.eval(`document.querySelector("#general").click()`);
  const chipsShown = await page.eval(`[...document.querySelectorAll("#popover .labels [data-label]")].map((chip) => chip.dataset.label)`);
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  await page.eval(`document.querySelector("#stamp-toggle").click()`);
  const tilesShown = await page.eval(`[...document.querySelectorAll(".tile[data-label]")].map((tile) => tile.dataset.label)`);
  await page.eval(`__esc()`);
  assert.ok(chipsShown.includes("comment") && tilesShown.includes("good") && !gateways.some((id) => chipsShown.includes(id) || tilesShown.includes(id)), "the chips and the palette leave the gateways out");
  await page.eval(`document.querySelector("#settings-toggle").click()`);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("#settings [data-ask]")].filter((button) => !button.hidden).map((button) => button.dataset.ask)`), gateways, "⚙ offers Ask for a setting, Customize the page and New comment kind");
  await page.eval(`document.querySelector("#setting-ask").click()`);
  assert.deepEqual(await page.eval(`[document.querySelector("#settings").hidden, document.querySelector("#popover").classList.contains("general"), [...document.querySelectorAll('#popover .labels [aria-pressed="true"]')].map((chip) => chip.dataset.label)]`), [true, true, ["setting"]], "⚙ Ask for a setting opens a general comment with Setting picked");
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  const overlay = join(claudeHome, "edit-md", "client");
  writeFileSync(join(overlay, "comment_labels.json"), '{"labels": []}');
  assert.equal(await (await fetch(`${base}/comment_labels.json`)).text(), '{"labels": []}', "a file in the overlay folder is served instead of the installed one");
  rmSync(join(overlay, "comment_labels.json"));
  check("gateways: Setting, Customize the page and New comment kind are hidden kinds, left off the chips and the palette, opened from ⚙; the overlay folder's files win over the installed page");

  const press = (code, key) => page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "${key}", code: "${code}", ctrlKey: true, bubbles: true, cancelable: true }))`);
  cli(["settings", "--set", "hotkeys.dictation.toggle=Ctrl+M"]);
  await page.waitFor(`document.querySelector("#popover .mic").title === "Dictate — Ctrl+M starts and stops"`, "the 🎤 hover naming the new key");
  await page.eval(`__fakeMic(); document.querySelector("#general").click()`);
  assert.match(await page.eval(`document.querySelector("#popover textarea").placeholder`), /Ctrl\+M dictates/, "the comment box's placeholder names it too");
  await press("KeyD", "d");
  assert.equal(await page.eval(`__sessions.length`), 0, "Ctrl+D no longer dictates");
  await press("KeyM", "m");
  assert.deepEqual(await page.eval(`[__sessions.length, document.querySelector("#popover .mic").getAttribute("aria-pressed")]`), [1, "true"], "Ctrl+M dictates");
  await press("KeyM", "m");
  cli(["settings", docId, "--set", "hotkeys.skills.open=Ctrl+M", "--scope", "repo"]);
  await page.waitFor(`document.querySelector("#popover .skills-toggle").textContent === "/ Skills · Ctrl+M"`, "the skills button naming the repo's key");
  await press("KeyM", "m");
  await page.waitFor(`!document.querySelector("#skill-picker").hidden`, "the skill picker, on the repo's Ctrl+M");
  assert.equal(await page.eval(`__sessions.length`), 1, "the repo's binding of Ctrl+M wins: it opens the skill picker, and dictation has no key");
  await page.eval(`__esc()`);
  assert.equal(await page.eval(`__text('[data-key="hotkeys.dictation.toggle"] .setting-scope')`), "shadowed: Open the skill picker in a comment has it", "⚙ shows the PC's binding shadowed");
  assert.ok(await page.eval(`document.querySelector('[data-setting="hotkeys.dictation.toggle"]').classList.contains("shadowed") && !/Ctrl/.test(document.querySelector("#popover .mic").title)`));
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  cli(["settings", docId, "--unset", "hotkeys.skills.open", "--scope", "repo"]);
  cli(["settings", "--unset", "hotkeys.dictation.toggle"]);
  await page.waitFor(`document.querySelector("#popover .mic").title === "Dictate — Ctrl+D starts and stops" && document.querySelector("#popover .skills-toggle").textContent === "/ Skills · Ctrl+Space"`, "the keys back to their defaults");
  check("hotkeys: a key is a setting; the agent rebinds dictation to Ctrl+M and the 🎤 hover and the placeholder follow; a repo binding of the same key wins and ⚙ shows the other shadowed");
  console.log(`    screenshot ${await page.screenshot("1-drafts")}`);
  const { x: draftX, y: draftY } = await page.eval(`__spot("nightly FTP upload", 0)`);
  for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: draftX, y: draftY, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  await page.waitFor(`!document.querySelector("#popover").hidden`, "clicking a draft's highlight opens it as Edit does");
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#popover .labels [aria-pressed="true"]')].map((chip) => chip.dataset.label)`), ["remove"], "the draft itself, its label picked");
  await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  assert.equal(await page.eval(`__text("#send-drafts")`).then((text) => /3/.test(text)), true, "cancelling the edit keeps the draft");
  check("drafts highlight (Custom Highlight API) and count on Send drafts; clicking one opens it for editing");

  await page.eval(`document.querySelector("#send-drafts").click()`);
  await page.waitFor(`__states("queued · agent busy") === 3`, "queued status while no wait is armed");
  console.log(`    screenshot ${await page.screenshot("2-queued")}`);
  const group = await waitForEvent(docId);
  assert.deepEqual([group.kind, group.mode, group.annotations.length], ["send", "silent", 3]);
  const byLabel = Object.fromEntries(group.annotations.map((a) => [a.label, a]));
  assert.equal(byLabel.remove.lines, lineOf("nightly FTP upload"));
  assert.deepEqual([byLabel.insert.quote, byLabel.insert.sourceStart === byLabel.insert.sourceEnd, byLabel.insert.lines], ["", true, lineOf("Brno branch")]);
  assert.ok(byLabel.change.quoteLength > 160 && byLabel.change.quote.includes(" … ") && byLabel.change.quote.length < 160, "long quote abbreviated");
  assert.equal(byLabel.change.exact, true, "cross-line selection over **bold** / *italic* maps exactly");
  await page.waitFor(`__states("with agent ✓") === 4`, "group seen");
  check("Send drafts while the agent is busy: 'queued' → one silent group → 'with agent ✓'; long quote abbreviated, still exact");

  const decisions = cli(["mark", docId, "--set", "decisions"], JSON.stringify([
    { label: "decision", quote: "Windows-1250", note: "Keep it, or move to UTF-8?", focus: true },
    { label: "risk", quote: "If the replica lags", note: "Invoices may be missed." },
    { label: "decision", quote: "not in the document" },
  ]));
  assert.deepEqual([decisions.placed, decisions.notFound], [2, ["not in the document"]], "mark says which quotes it could not place");
  cli(["mark", docId, "--set", "seek: encoding"], JSON.stringify([{ label: "seek", quote: "UTF-8 breaks Czech diacritics" }]));
  const markView = () => page.eval(`({
    cards: document.querySelectorAll(".mark-card").length,
    focused: document.querySelector(".mark-card.focused .excerpt")?.textContent ?? null,
    quiet: CSS.highlights.get("mark-quiet")?.size, strong: CSS.highlights.get("mark-focus")?.size,
    ticks: document.querySelectorAll("#mark-ticks .mark-tick").length,
    dots: [...document.querySelectorAll("#outline .dot")].map((dot) => dot.title).sort().join(","),
    filters: [...document.querySelectorAll("#outline-filters label")].map((label) => label.textContent).filter((text) => text.startsWith("◆")),
  })`);
  await page.waitFor(`document.querySelectorAll(".mark-card").length === 3`, "marks listed in the left pane");
  const focusRule = () => page.eval(`[...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).find((rule) => rule.selectorText === "::highlight(mark-focus)")?.cssText`);
  assert.match(await focusRule(), /background-color: rgb\(217, 119, 6\); color: rgb\(255, 255, 255\)/, "the focused mark is painted in its label's solid colour, with text readable on it");
  assert.deepEqual(
    await page.eval(`[...document.querySelectorAll("#outline-filters > label span")].map((sign) => sign.style.color)`),
    ["rgb(217, 119, 6)", "rgb(219, 39, 119)", "rgb(59, 130, 246)"],
    "each set row shows a sign per colour it holds",
  );
  const firstView = await markView();
  assert.deepEqual(firstView, {
    cards: 3, focused: "Windows-1250", quiet: 2, strong: 1, ticks: 3, dots: "Seek,decision,risk",
    filters: ["◆◆ decisions (2)", "◆ decision (1)", "◆ risk (1)", "◆ seek: encoding (1)"],
  }, "two sets: quiet tints, the agent's focus strong, ticks in the margin, dots on the heading, a row per set and per label");
  await page.eval(`[...document.querySelectorAll("#doc h2")].find((h) => h.textContent === "Risks").scrollIntoView({ block: "start" })`);
  await sleep(300);
  console.log(`    screenshot ${await page.screenshot("8-marks")}`);
  await page.eval(`document.querySelector('.mark-card[data-mark="${decisions.marks[1].id}"]').click()`);
  assert.equal((await markView()).focused, "If the replica lags", "clicking a card focuses its mark");
  await page.eval(`document.querySelector('#mark-ticks .mark-tick.focused').click()`);
  assert.equal((await markView()).focused, null, "clicking the focused mark's tick unfocuses it");
  assert.equal(await focusRule(), undefined, "no focused mark, no strong paint");
  cli(["mark", docId, "--set", "seek: encoding"], JSON.stringify([{ label: "seek", quote: "Plzeň" }]));
  await page.waitFor(`[...document.querySelectorAll(".mark-card .excerpt")].some((e) => e.textContent === "Plzeň")`, "a re-sent set replaces itself");
  assert.equal((await markView()).cards, 3, "re-sending one set leaves the other alone");
  event = waitForEvent(docId);
  await page.eval(`(async () => {
    document.querySelector('.mark-card[data-mark="${decisions.marks[0].id}"] .resolve').click();
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("#popover textarea").value = "Keep Windows-1250.";
    document.querySelector('#popover [data-act="send"]').click();
  })()`);
  const resolved = (await event).annotations[0];
  assert.deepEqual([resolved.markId, resolved.markSet, resolved.quote, resolved.exact], [decisions.marks[0].id, "decisions", "Windows-1250", true], "Resolve answers the mark: the annotation carries its id");
  assert.equal(cli(["unmark", docId, "--all"]).dropped, true);
  await page.waitFor(`document.querySelectorAll(".mark-card, #mark-ticks .mark-tick, #outline .dot").length === 0`, "unmark --all clears the page");
  check("agent marks: sets add or replace themselves, one focused mark, ticks and heading dots, Resolve links the answer, unmark clears");

  const askedItem = `#annotations [data-id=${asked.id}]`;
  const panel = "#thread-panel";
  const panelOpen = () => page.eval(`!document.querySelector("${panel}").hidden`);
  const cardCount = () => page.eval(`document.querySelectorAll("#annotations > .item").length`);
  const cardsBefore = await cardCount();
  await page.eval(`document.querySelector('${askedItem} .reply-actions button').click()`);
  assert.equal(await page.eval(`document.activeElement === document.querySelector("${panel} textarea")`), true, "Reply opens the panel with the cursor in its reply box");
  assert.ok(await page.eval(`(() => {
    const box = document.querySelector("${panel}").getBoundingClientRect(), column = document.querySelector("#page").getBoundingClientRect();
    return box.left >= column.left && box.right <= column.right && box.bottom <= innerHeight * 2 / 3 && box.top < innerHeight * 0.1;
  })()`), "the panel covers the upper two thirds of the document column, the lower third stays free");
  assert.equal(await page.eval(`__text("${panel} .thread-title")`), `${asked.id} · L${asked.lines}`);
  const panelTurnClasses = () => page.eval(`[...document.querySelector("${panel} .thread-turns").children].map((turn) => turn.className)`);
  assert.deepEqual(await panelTurnClasses(), ["excerpt", "follow-up", "reply"], "the quote and the comment on top, then the agent's replies");
  event = waitForEvent(docId);
  await sleep(300);
  const midSend = await page.eval(`(() => {
    const box = document.querySelector("${panel} textarea"), sendButton = document.querySelector('${panel} button[type="submit"]');
    const ctrlEnter = () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    box.value = "And on a Sunday?";
    ctrlEnter();
    const shown = [sendButton.textContent, sendButton.disabled, box.readOnly];
    ctrlEnter();
    sendButton.click();
    return shown;
  })()`);
  assert.deepEqual(midSend, ["Sending…", true, true], "while a follow-up is on its way, Send says so and the box is read-only");
  const followUpEvent = await event;
  const [followUp] = followUpEvent.annotations;
  assert.deepEqual([followUpEvent.kind, followUpEvent.mode, followUp.replyTo, followUp.text], ["send", "reply", asked.id, "And on a Sunday?"]);
  assert.deepEqual([followUp.label, followUp.quote, followUp.lines], [undefined, undefined, undefined], "the event carries the follow-up and replyTo only");
  assert.match(followUpEvent.hint, new RegExp(`push ${docId} --to ${asked.id}`));
  await page.waitFor(`[...document.querySelectorAll("${panel} .follow-up")].at(-1)?.textContent.includes("with agent ✓")`, "the follow-up's status in the thread");
  assert.equal(await page.eval(`document.querySelector("${panel} textarea").value`), "", "a sent follow-up leaves the box empty");
  assert.deepEqual(
    await page.eval(`[document.querySelectorAll("${panel} .follow-up").length, document.querySelector('${panel} button[type="submit"]').textContent]`),
    [2, "Send"],
    "pressed three times in flight, it went once",
  );
  cli(["push", docId, "--to", followUp.id], "On Sundays **too**.");
  await page.waitFor(`document.querySelectorAll("${askedItem} .reply").length === 2`, "the answer to a follow-up lands in the same thread");
  await page.waitFor(`document.querySelectorAll("${panel} .thread-turns .reply").length === 2`, "a new turn appears in the open panel");
  assert.deepEqual(await panelTurnClasses(), ["excerpt", "follow-up", "reply", "follow-up", "reply"], "the turns stay in order");
  console.log(`    screenshot ${await page.screenshot("9-thread")}`);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("${askedItem} > :is(.reply, .follow-up)")].map((turn) => turn.className)`), ["reply", "follow-up", "reply"], "in the pane the follow-up is a bubble inside the thread");
  assert.equal(await cardCount(), cardsBefore, "the pane treats the thread as one annotation");
  assert.ok(await page.eval(`!document.querySelector('#annotations [data-id="${followUp.id}"]')`), "a follow-up is not a card of its own");
  const printed = cli(["thread", docId, followUp.id]);
  assert.deepEqual([printed.id, printed.quote, printed.lines], [asked.id, "The export runs", asked.lines]);
  assert.deepEqual(printed.turns.map((turn) => [turn.by, turn.text]), [
    ["reviewer", "Why never the primary?"],
    ["agent", "The primary serves **live invoicing**; exports would compete for locks."],
    ["reviewer", "And on a Sunday?"],
    ["agent", "On Sundays **too**."],
  ], "edit-md thread prints the turns in order");
  assert.match(cli(["thread", docId, "a999"]).error ?? "", /No thread/);
  check("reply threads: Reply opens the panel; a follow-up travels with replyTo; the answer lands in the same thread; edit-md thread prints it");

  const scrolled = await page.eval(`scrollY`);
  await page.eval(`__select("Watch the error dashboard", 0)`);
  await page.waitFor(`!document.querySelector("#popover").hidden`, "the comment popup beside the open panel");
  assert.ok(await panelOpen(), "a selection opens the comment popup with the panel still open");
  console.log(`    screenshot ${await page.screenshot("10-thread-and-popup")}`);
  assert.ok(await page.eval(`document.querySelector("${panel}").getBoundingClientRect().bottom <= document.querySelector("#popover").getBoundingClientRect().top`), "the popup docks in the lower third, under the panel");
  await page.eval(`__esc()`);
  assert.equal(await page.eval(`document.querySelector("#popover").hidden`), true, "Esc closes the popup first");
  assert.ok(await panelOpen());
  await page.eval(`__esc()`);
  assert.equal(await panelOpen(), false, "Esc again closes the panel");
  assert.equal(await page.eval(`scrollY`), scrolled, "the document underneath has not moved");
  const looseReply = cli(["push", docId, "--text", "A word on the whole document."]);
  await page.waitFor(`document.querySelector("#agent-messages .reply-actions")`, "a reply to no annotation");
  const doubleClickAt = async ({ x, y }) => {
    for (const clickCount of [1, 2]) {
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount });
    }
  };
  const cardBackground = (selector) => page.eval(`(() => {
    const card = document.querySelector('${selector}');
    card.scrollIntoView({ block: "center" });
    const box = card.getBoundingClientRect();
    return { x: box.left + 4, y: box.top + box.height / 2 };
  })()`);
  const wordIn = (selector) => page.eval(`(() => {
    const walker = document.createTreeWalker(document.querySelector('${selector}'), NodeFilter.SHOW_TEXT, { acceptNode: (node) => (/\\w{4}/.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const node = walker.nextNode(), start = node.textContent.search(/\\w{4}/), range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 2);
    const box = range.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  await doubleClickAt(await wordIn(`${askedItem} .reply`));
  assert.equal(await panelOpen(), false, "a double-click on a word in a card selects it and opens nothing");
  assert.ok(await page.eval(`getSelection().toString().trim().length > 0`), "the word is selected");
  const besideText = await page.eval(`(() => {
    const field = document.querySelector('${askedItem} .text'), run = document.createRange();
    run.selectNodeContents(field);
    const line = [...run.getClientRects()].at(-1), box = field.getBoundingClientRect();
    return { x: line.right + (box.right - line.right) / 2, y: line.top + line.height / 2, room: box.right - line.right };
  })()`);
  assert.ok(besideText.room > 20, `the comment's line leaves room after its text: ${besideText.room}px`);
  await doubleClickAt(besideText);
  assert.ok(await panelOpen(), "a double-click in the empty end of the comment's line opens the chat");
  assert.equal(await page.eval(`getSelection().isCollapsed`), true, "and leaves no word selected");
  await page.eval(`__esc()`);
  await doubleClickAt(await cardBackground(askedItem));
  assert.ok(await panelOpen(), "a double-click on a card's background opens its chat");
  assert.equal(await page.eval(`__text("${panel} .thread-title")`), `${asked.id} · L${asked.lines}`);
  await doubleClickAt(await cardBackground("#agent-messages > li"));
  assert.equal(await page.eval(`__text("${panel} .thread-title")`), "From the agent", "the agent's own thread opens the same way");
  assert.ok(await page.eval(`(() => {
    const expand = document.querySelector('${askedItem} .reply-actions .expand').getBoundingClientRect();
    return expand.width >= 32 && expand.height >= 24;
  })()`), "⤢ is a target of at least 32 × 24 px");
  await page.eval(`__esc()`);
  await page.eval(`document.querySelector('${askedItem} .reply-actions button:last-child').click()`);
  await page.eval(`document.querySelector("#agent-messages .reply-actions button:last-child").click()`);
  assert.equal(await page.eval(`__text("${panel} .thread-title")`), "From the agent", "⤢ on another reply swaps the panel's thread");
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`(() => {
    const box = document.querySelector("${panel} textarea");
    box.value = "Which part?";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  })()`);
  assert.equal((await event).annotations[0].replyTo, `r${looseReply.seq}`, "Ctrl+Shift+Enter sends too; a reply to no annotation is a thread of its own");
  cli(["push", docId, "--to", `r${looseReply.seq}`], "The rollout.");
  await page.waitFor(`document.querySelectorAll("#agent-messages > li").length === 1 && document.querySelectorAll("#agent-messages .reply").length === 2`, "the loose thread stays one thread");
  const panelBox = () => page.eval(`(() => { const r = document.querySelector("${panel}").getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  const dockedPanel = await panelBox();
  await drag(await centreOf(`${panel} .thread-head .spacer`), 30, 40);
  assert.deepEqual(await panelBox(), { ...dockedPanel, left: dockedPanel.left + 30, top: dockedPanel.top + 40 }, "the panel moves by an empty spot");
  assert.equal(await page.eval(`document.querySelector("${panel} .place-toggle").classList.contains("changed")`), true);
  await page.eval(`document.querySelector("${panel} .place-toggle").click()`);
  await page.eval(`document.querySelector('${panel} [data-act="keep"][data-scope="document"]').click()`);
  await page.waitFor(`document.querySelector("#banner").textContent.includes("thread panel")`, "keep confirmation");
  const keptPanel = await panelBox();
  await sleep(200);
  await page.eval(`location.reload()`);
  await sleep(500);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("Release checklist") && document.querySelector('${askedItem} .reply-actions')`, "reloaded");
  await page.eval(pageHelpers);
  assert.equal(await page.eval(`document.querySelectorAll("${askedItem} .follow-up").length`), 1, "follow-ups survive a reload");
  await page.eval(`document.querySelector('${askedItem} .reply-actions button:last-child').click()`);
  assert.deepEqual(await panelBox(), keptPanel, "a moved panel keeps its place after a reload");
  await page.eval(`document.querySelector("${panel} .place-toggle").click()`);
  await page.eval(`document.querySelector('${panel} [data-act="reset"]').click()`);
  assert.deepEqual(await panelBox(), dockedPanel, "Reset docks it again");
  await page.eval(`document.querySelector('${panel} [data-act="close"]').click()`);
  assert.equal(await panelOpen(), false, "× closes it");
  const clickAt = async ({ x, y }) => {
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  };
  await clickAt(await page.eval(`__spot("The export runs", 1)`));
  await page.waitFor(`!document.querySelector("${panel}").hidden`, "clicking a chat's highlight opens the large panel, as the right pane does");
  assert.equal(await page.eval(`__text("${panel} .thread-title")`), `${asked.id} · L${asked.lines}`);
  assert.equal(await page.eval(`document.querySelector("#thread-card").hidden`), true, "not the small card");
  await page.eval(`document.querySelector('${panel} [data-act="close"]').click()`);
  await page.eval(`document.querySelector('[data-setting="threads.highlightOpensCard"]').click()`);
  await clickAt(await page.eval(`__spot("The export runs", 1)`));
  await page.waitFor(`!document.querySelector("#thread-card").hidden`, "with the ⚙ switch, the highlight opens the small card");
  assert.ok(await page.eval(`document.querySelector("#thread-card .thread-turns").textContent.includes("live invoicing")`));
  await page.eval(`__esc()`);
  assert.equal(await page.eval(`document.querySelector("#thread-card").hidden`), true, "Esc closes the card");
  await clickAt(await page.eval(`__spot("The export runs", 1)`));
  await page.waitFor(`!document.querySelector("#thread-card").hidden`, "the card again");
  await page.eval(`document.querySelector('#thread-card [data-act="expand"]').click()`);
  assert.ok((await panelOpen()) && await page.eval(`document.querySelector("#thread-card").hidden`), "the card's ⤢ opens the large panel");
  await page.eval(`document.querySelector('${panel} [data-act="close"]').click()`);
  await page.eval(`document.querySelector('[data-setting="threads.highlightOpensCard"]').click()`);
  const itemsHaveReply = () => page.eval(`[...document.querySelectorAll("#annotations .item")].map((item) => !!item.querySelector(".reply"))`);
  const unfiltered = await itemsHaveReply();
  await page.eval(`document.querySelector("#replies-only").click()`);
  assert.ok((await itemsHaveReply()).every(Boolean) && (await itemsHaveReply()).length < unfiltered.length, "the replies-only filter narrows the pane");
  await page.eval(`document.querySelector("#replies-only").click()`);
  assert.deepEqual(await itemsHaveReply(), unfiltered);
  assert.ok(await page.eval(`(() => {
    const head = document.querySelector(".side-head"), order = document.querySelector("#order");
    return !head.querySelector("h2") && order.getBoundingClientRect().top >= head.getBoundingClientRect().bottom;
  })()`), "no heading over the cards, the order on a line of its own under the ticks");
  const shownIn = (selector) => page.eval(`[...document.querySelectorAll('${askedItem} ${selector}')].some((node) => node.offsetParent)`);
  await page.eval(`document.querySelector("#compact").click()`);
  assert.deepEqual([await shownIn(".head"), await shownIn(".text"), await shownIn(".reply"), await shownIn(".excerpt")], [true, true, false, false], "Compact keeps the label line and the comment, hides the rest");
  assert.equal(await page.eval(`document.querySelector('${askedItem} .text').getBoundingClientRect().height < 24`), true, "the comment shrinks to one line");
  await page.eval(`document.querySelector("#compact").click()`);
  assert.ok(await shownIn(".reply"), "unticked, the cards are whole again");
  check("the panel docks above the popup, closes by Esc or ×, swaps threads, keeps its place; a highlight opens the large panel, or the small card by ⚙; the pane filters to replies or goes compact");

  const dictate = (...guesses) => `(async () => {
    __fakeMic();
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("#popover .mic").click();
    __heard(...${JSON.stringify(guesses)});
  })()`;
  const popupField = `document.querySelector("#popover textarea")`;
  const cancelPopup = () => page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
  const sendPopup = `document.querySelector('#popover [data-act="send"]').click()`;
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`${dictate("the secret results")}.then(() => document.querySelector("#popover .fix").click())`);
  const fixRequest = await event;
  assert.deepEqual([fixRequest.kind, fixRequest.annotations[0].text, fixRequest.annotations[0].dictated], ["fix", "the secret results", true], "✨ Fix sends the comment, marked as dictated");
  cli(["push", docId, "--fix", fixRequest.fixId, "--text", "the seek results"]);
  await page.waitFor(`!document.querySelector("#popover .fix-suggestion").hidden && document.querySelector("#popover .fix-text").textContent === "the seek results"`, "the agent's suggestion under the comment box");
  assert.equal(await page.eval(`document.querySelector("#popover textarea").value`), "the secret results", "a suggestion never overwrites the comment by itself");
  await page.eval(`document.querySelector('#popover [data-act="fix-use"]').click()`);
  assert.equal(await page.eval(`document.querySelector("#popover textarea").value`), "the seek results", "Use takes the suggestion");
  event = waitForEvent(docId);
  await page.eval(sendPopup);
  assert.deepEqual([(await event).annotations[0].text, (await event).annotations[0].dictated], ["the seek results", undefined], "an accepted fix leaves nothing marked as spoken");
  event = waitForEvent(docId);
  await page.eval(`${dictate("spoken words stay")}.then(() => ${sendPopup})`);
  const allSpoken = (await event).annotations[0];
  assert.deepEqual([allSpoken.dictated, allSpoken.spoken], [true, undefined], "a comment all spoken is dictated, without a list of parts");
  check("✨ Fix: the agent corrects a dictated comment and suggests it back; dictated comments are marked for the agent");

  event = waitForEvent(docId);
  await page.eval(`${dictate("the secret results should stay in the pain")}.then(() => {
    __typeOver(${popupField}, "secret", "seek");
    __typeOver(${popupField}, null, " see XTbl");
    ${sendPopup};
  })`);
  const mixed = (await event).annotations[0];
  assert.deepEqual([mixed.text, mixed.dictated, mixed.spoken], ["the seek results should stay in the pain see XTbl", true, ["the", "results should stay in the pain"]], "only the spoken parts are listed; what was typed over or added is not");
  event = waitForEvent(docId);
  await page.eval(`${dictate("spoken words stay")}.then(() => {
    __typeOver(${popupField}, "words", "terms");
    ${sendPopup};
  })`);
  const corrected = (await event).annotations[0];
  assert.deepEqual([corrected.dictated, corrected.spoken], [true, ["spoken", "stay"]], "correcting one word of a phrase keeps the rest marked");
  event = waitForEvent(docId);
  await page.eval(`${dictate("spoken words stay")}.then(() => {
    __typeOver(${popupField}, "words", "terms");
    document.execCommand("undo");
    ${sendPopup};
  })`);
  const undone = (await event).annotations[0];
  assert.deepEqual([undone.text, undone.dictated, undone.spoken], ["spoken words stay", true, undefined], "what undo brings back counts as spoken");
  event = waitForEvent(docId);
  await page.eval(`${dictate("hello world")}.then(() => {
    document.querySelector('#popover [data-label="remove"]').dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    __heard(" and more");
    ${sendPopup};
  })`);
  const tagged = (await event).annotations[0];
  assert.deepEqual([tagged.text, tagged.spoken], ["hello world [🗑️ remove] and more", ["hello world", "and more"]], "a chip's tag counts as typed, and the next words follow it");
  const dictateInto = (steps) => page.eval(`(async () => {
    __fakeMic({ lateEnd: true });
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("#popover .mic").click();
    ${steps};
    return ${popupField}.value;
  })()`);
  // Chrome keeps a stable and an unstable interim result and moves words between them before it settles one final result.
  const chromeTake = `__replay([
    [0, [[false, "the"]]],
    [0, [[false, "the"], [false, " seek results"]]],
    [0, [[false, "the seek"], [false, " results should"]]],
    [0, [[false, "the seek results should stay"]]],
    [0, [[false, "the seek results should stay"], [false, " in the pain"]]],
    [0, [[true, "the seek results should stay in the pane"]]],
    [1, [[true, "the seek results should stay in the pane"], [false, " then"]]],
    [1, [[true, "the seek results should stay in the pane"], [false, " then"], [false, " we mark"]]],
    [1, [[true, "the seek results should stay in the pane"], [true, " then we mark"]]],
  ])`;
  assert.equal(await dictateInto(chromeTake), "the seek results should stay in the pane then we mark", "Chrome's interim results, split and merged as it settles them, land once each, none lost");
  await cancelPopup();
  const typedWhileSettling = await dictateInto(`
    __replay([[0, [[false, "the seek"], [false, " results"]]]]);
    __typeOver(${popupField}, null, "/");
    const ended = __sessions.at(-1).ending;
    __replay([[0, [[true, "the seek results"]]]]);
    __endRun();
    __replay([[0, [[true, " and on"]]]]);
    if (!ended) throw new Error("typing did not end the run");
  `);
  assert.equal(typedWhileSettling, "the seek results/ and on", "typing while words are still settling ends the run: they settle where they were shown, once, and the next run's words follow what you typed");
  await cancelPopup();
  assert.equal(await dictateInto(`
    __replay([[0, [[false, "the seek"]]]]);
    __typeOver(${popupField}, "seek", "peak");
    __replay([[0, [[true, "the seek results"]]]]);
    __endRun();
    __replay([[0, [[true, " and on"]]]]);
  `), "the peak and on", "words you typed into are yours: their later version is dropped, not added");
  await cancelPopup();
  event = waitForEvent(docId);
  await page.eval(`${dictate("označ ten Mark a pošli jí do plánu", "označten Mark a pošli zík do plánu", "označ ten Mark a pošli zík do plánu", "Označte Mark a pošli zík do plánu", "označ ten Mark a pošli jí doplánu")}.then(() => ${sendPopup})`);
  const guessed = (await event).annotations[0];
  assert.deepEqual([guessed.text, guessed.dictated, guessed.maybe], ["označ ten Mark a pošli jí do plánu", true, { "označ ten": ["označten", "Označte"], "jí": ["zík"], "do plánu": ["doplánu"] }], "the recognizer's other guesses reach the agent as maybe");
  event = waitForEvent(docId);
  await page.eval(`${dictate("označ ten Mark a pošli jí do plánu", "označ ten Mark a pošli zík do plánu")}.then(() => {
    __typeOver(${popupField}, "jí", "seek");
    ${sendPopup};
  })`);
  assert.equal((await event).annotations[0].maybe, undefined, "a corrected word loses its guesses");
  assert.equal(await page.eval(`__sessions.at(-1).maxAlternatives`), 5, "the page asks the recognizer for its other guesses");
  await page.eval(`${dictate("kept on a draft")}.then(() => document.querySelector('#popover button[type="submit"]').click())`);
  await sleep(200);
  await page.eval(`location.reload()`);
  await sleep(500);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("Release checklist") && [...document.querySelectorAll("#annotations .item .text")].some((text) => text.textContent === "kept on a draft")`, "the draft after a reload");
  await page.eval(pageHelpers);
  event = waitForEvent(docId);
  await page.eval(`(async () => {
    const draft = [...document.querySelectorAll("#annotations .item")].find((item) => item.querySelector(".text")?.textContent === "kept on a draft");
    draft.querySelector(".actions button").click();
    await new Promise((r) => setTimeout(r, 50));
    ${sendPopup};
  })()`);
  assert.equal((await event).annotations[0].dictated, true, "Edit on a draft, after a reload, keeps what was spoken");
  check("spoken or typed: the agent gets the spoken parts and the recognizer's other guesses; typed words, tags and an accepted fix are taken at face value");

  const glossaries = [join(claudeHome, "edit-md", "glossary.json"), join(workDir, ".claude", "edit-md", "glossary.json")];
  const [userGlossary, repoGlossary] = glossaries;
  for (const file of glossaries) mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(userGlossary, JSON.stringify({ terms: ["XTbl"], mishearings: { "ex table": "XTbl" } }));
  writeFileSync(repoGlossary, JSON.stringify({ terms: ["seek"], mishearings: { "secret results": "seek results" } }));
  const merged = { terms: ["seek", "XTbl"], mishearings: { "ex table": "XTbl", "secret results": "seek results" } };
  const { repoFile, ...listed } = cli(["glossary", docId]);
  assert.deepEqual(listed, { ...merged, prompt: "Glossary: seek, XTbl." }, "edit-md glossary: the user's and the repo's lists merged, the repo's terms first, and Whisper's prompt");
  assert.match(repoFile, /[\\/]\.claude[\\/]edit-md[\\/]glossary\.json$/, "and where the repo's list lives, as the document is in a repository");
  // The page re-reads the glossary as dictation starts; the wait lets it arrive before the first words.
  const dictateWithGlossary = (steps) => page.eval(`(async () => {
    __fakeMic();
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("#popover .mic").click();
    await new Promise((r) => setTimeout(r, 300));
    ${steps};
    return ${popupField}.value;
  })()`);
  assert.equal(await dictateWithGlossary(`__replay([[0, [[false, "the ex"], [false, " table works"]]]])`), "the XTbl works", "a known mishearing is corrected while the words are still being recognized, across Chrome's two interim results");
  assert.equal(await page.eval(`__text("#setting-glossary")`), "Glossary: 2 terms, 2 known mishearings.", "⚙ says what the glossary holds");
  event = waitForEvent(docId);
  await page.eval(`__heard("the ex table works"); ${sendPopup}`);
  const glossed = await event;
  assert.deepEqual([glossed.annotations[0].text, glossed.annotations[0].dictated, glossed.annotations[0].maybe], ["the XTbl works", true, { XTbl: ["ex table"] }], "the corrected words stay spoken, and what was heard reaches the agent as maybe");
  assert.deepEqual(glossed.glossary, merged, "a send with dictated words carries the glossary");
  assert.equal(await dictateWithGlossary(`__heard("Ex Table and ex tables, the secret  results")`), "XTbl and ex tables, the seek results", "whole words only, in any case, across any spaces");
  event = waitForEvent(docId);
  await page.eval(`document.querySelector("#popover .fix").click()`);
  assert.deepEqual((await event).glossary, merged, "a fix event carries the glossary");
  await cancelPopup();
  event = waitForEvent(docId);
  await page.eval(`__annotate("Watch the error dashboard", 0, "comment", "typed, not spoken", "send")`);
  assert.equal((await event).glossary, undefined, "a send with typed words only carries none");
  for (const file of glossaries) rmSync(file);
  assert.equal(await dictateWithGlossary(`__heard("the ex table works")`), "the ex table works", "without the files nothing is corrected");
  await cancelPopup();
  check("the glossary: known mishearings corrected as the words land, interim ones too; the original reaches the agent as maybe; fix and dictated sends carry the glossary");

  const offers = () => page.eval(`[...document.querySelectorAll("#popover .remember-row")].map((row) => [...row.querySelectorAll("input")].map((field) => field.value).concat([...row.querySelectorAll("button")].map((button) => button.textContent)))`);
  const offersShown = (count) => page.waitFor(`document.querySelectorAll("#popover .remember-row").length === ${count}`, `${count} offers to remember a correction`);
  const rememberFor = (layer) => page.eval(`[...document.querySelectorAll("#popover .remember-row button")].find((button) => button.textContent === "${layer}").click()`);
  const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
  assert.equal(await dictateWithGlossary(`__heard("the ex table works"); __typeOver(${popupField}, "ex table", "XTbl")`), "the XTbl works");
  await offersShown(1);
  assert.deepEqual(await offers(), [["ex table", "XTbl", "This repo", "Me", "×"]], "spoken words typed over are offered as a mishearing, for the repo or for you");
  assert.ok(!existsSync(userGlossary), "nothing is remembered silently");
  await rememberFor("Me");
  await offersShown(0);
  assert.deepEqual(readJson(userGlossary), { terms: ["XTbl"], mishearings: { "ex table": "XTbl" } }, "Me writes your own glossary, the term joining the terms");
  await cancelPopup();
  assert.equal(await dictateWithGlossary(`__heard("the ex table works")`), "the XTbl works", "the gate: a remembered correction corrects the next dictation");
  await cancelPopup();

  await dictateWithGlossary(`__heard("the secret results matter"); __typeOver(${popupField}, "secret", "seek")`);
  await offersShown(1);
  assert.deepEqual(await offers(), [["secret", "seek", "This repo", "Me", "×"]]);
  await page.eval(`(() => {
    const [heard, meant] = document.querySelectorAll("#popover .remember-row input");
    heard.value = "secret results";
    meant.value = "seek results";
  })()`);
  await rememberFor("This repo");
  await offersShown(0);
  assert.deepEqual(readJson(repoGlossary), { terms: ["seek"], mishearings: { "secret results": "seek results" } }, "an everyday word is widened in the row; only the word not heard joins the terms");
  await cancelPopup();

  await page.eval(`(async () => {
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    __typeOver(${popupField}, null, "typed words");
    __typeOver(${popupField}, "words", "terms");
  })()`);
  await sleep(1200);
  assert.deepEqual(await offers(), [], "typed words corrected by hand are not mishearings");
  await cancelPopup();

  event = waitForEvent(docId);
  await dictateWithGlossary(`__heard("the market is set"); document.querySelector("#popover .fix").click()`);
  cli(["push", docId, "--fix", (await event).fixId, "--text", "the mark is set"]);
  await page.waitFor(`document.querySelector("#popover .fix-text").textContent === "the mark is set"`, "the agent's suggestion");
  await page.eval(`document.querySelector('#popover [data-act="fix-use"]').click()`);
  await offersShown(1);
  assert.deepEqual(await offers(), [["market", "mark", "This repo", "Me", "×"]], "what an accepted fix corrected is offered at once");
  await page.eval(`document.querySelector("#popover .remember-drop").click()`);
  await offersShown(0);
  assert.deepEqual(readJson(userGlossary).mishearings, { "ex table": "XTbl" }, "× drops the offer and writes nothing");
  await cancelPopup();
  await page.eval(`document.querySelector('[data-setting="dictation.offerCorrections"]').click()`);
  await dictateWithGlossary(`__heard("the spoken word"); __typeOver(${popupField}, "word", "term")`);
  await sleep(1200);
  assert.deepEqual(await offers(), [], "⚙ switches the offers off");
  await cancelPopup();
  await page.eval(`document.querySelector('[data-setting="dictation.offerCorrections"]').click()`);
  for (const file of glossaries) rmSync(file);
  check("learning from corrections: spoken words typed over, or changed by an accepted fix, are offered for the repo or for you, unless ⚙ switches it off; a remembered one corrects the next dictation");

  await page.eval(`(async () => {
    __fakeMic();
    document.querySelector('${askedItem} .reply-actions button').click();
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("${panel} textarea").focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }));
    __heard("said in the thread");
  })()`);
  assert.deepEqual(await page.eval(`[document.querySelector("${panel} textarea").value, document.querySelector("#popover textarea").value]`), ["said in the thread", ""], "with both boxes open, the focused one takes the dictation");
  await page.eval(`__esc()`);
  assert.equal(await page.eval(`document.querySelector("${panel} .mic").getAttribute("aria-pressed")`), "true", "closing the popup leaves the panel's dictation on");
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`document.querySelector("${panel} .thread-reply").requestSubmit()`);
  const spokenFollowUp = (await event).annotations[0];
  assert.deepEqual([spokenFollowUp.replyTo, spokenFollowUp.dictated], [asked.id, true], "a dictated follow-up says so");
  assert.equal(await page.eval(`document.querySelector("${panel} .mic").getAttribute("aria-pressed")`), "false", "sending ends the dictation");
  const replyField = `document.querySelector("${panel} textarea")`;
  await page.eval(`(() => {
    document.querySelector("${panel} .mic").click();
    __heard("the ex table again");
    document.querySelector("${panel} .mic").click();
    __typeOver(${replyField}, "ex table", "XTbl");
  })()`);
  await page.waitFor(`document.querySelectorAll("${panel} .remember-row").length === 1`, "an offer under the reply box");
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("${panel} .remember-row input")].map((field) => field.value)`), ["ex table", "XTbl"], "a corrected follow-up offers the pair as the popup does");
  await page.eval(`__esc()`);
  assert.equal(await page.eval(`document.querySelectorAll("${panel} .remember-row").length`), 0, "closing the panel drops the offer");
  await page.eval(`(() => {
    document.querySelector('${askedItem} .reply-actions button').click();
    ${replyField}.select();
    document.execCommand("delete");
  })()`);
  await page.eval(`__esc()`);
  const micsPressed = () => page.eval(`["#popover", "${panel}"].map((box) => document.querySelector(box + " .mic").getAttribute("aria-pressed"))`);
  await page.eval(`(async () => {
    __fakeMic();
    document.querySelector('${askedItem} .reply-actions button').click();
    __select("Watch the error dashboard", 0);
    await new Promise((r) => setTimeout(r, 50));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  assert.deepEqual(await micsPressed(), ["true", "false"], "Ctrl+D dictates into the focused popup");
  await page.eval(`${replyField}.focus()`);
  assert.deepEqual(await micsPressed(), ["false", "true"], "moving into the reply box takes the microphone along");
  await page.eval(`__heard("moved along")`);
  assert.deepEqual(await page.eval(`[${replyField}.value, document.querySelector("#popover textarea").value]`), ["moved along", ""], "the words land where the focus is");
  await page.eval(`document.querySelector("#popover textarea").focus()`);
  assert.deepEqual(await micsPressed(), ["true", "false"], "and back into the popup");
  await cancelPopup();
  await page.eval(`(() => {
    ${replyField}.select();
    document.execCommand("delete");
  })()`);
  await page.eval(`__esc()`);
  await page.eval(`document.querySelector('[data-setting="dictation.always"]').click()`);
  await page.eval(`document.querySelector('${askedItem} .reply-actions .expand').click()`);
  assert.deepEqual([await micsPressed(), await page.eval(`document.activeElement === ${replyField}`)], [["false", "true"], true], "with ⚙ dictate-always, opening the chat by ⤢ listens in its reply box");
  await page.eval(`__esc()`);
  await page.eval(`document.querySelector('[data-setting="dictation.always"]').click()`);
  check("the reply box takes dictation by 🎤 or Ctrl+D, and a follow-up carries what was spoken and offers to remember what was corrected; the microphone follows the focus between boxes, and ⚙ dictate-always opens a chat listening");

  await page.waitFor(`!!document.querySelector("pre.mermaid[data-processed] svg")`, "mermaid diagram rendered", 20000);
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`document.querySelector("pre.mermaid").scrollIntoView({ block: "center" })`);
  await page.eval(`__annotate("Fix and re-test", 0, "question", "Who signs off the fix?", "send")`);
  const onDiagram = (await event).annotations[0];
  assert.deepEqual([onDiagram.quote, onDiagram.lines, onDiagram.exact], ["Fix and re-test", lineOf("fix[Fix and re-test]"), true]);
  assert.ok(await page.eval(`!document.querySelector(".state.orphan")`), "diagram annotation resolves");
  console.log(`    screenshot ${await page.screenshot("4-mermaid")}`);
  check("mermaid renders lazily; a diagram label is annotatable and maps to its source line");

  const ALT = 1;
  const CTRL = 2;
  const SHIFT = 8;
  const key = (type, name, code, virtualKey, modifiers = 0) => page.send("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  const altDown = () => key("rawKeyDown", "Alt", "AltLeft", 18, ALT);
  const altUp = () => key("keyUp", "Alt", "AltLeft", 18);
  const altDigit = async (digit) => {
    await key("rawKeyDown", String(digit), `Digit${digit}`, 48 + digit, ALT);
    await key("keyUp", String(digit), `Digit${digit}`, 48 + digit, ALT);
  };
  const pointAt = ({ x, y }, modifiers = 0) => page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
  const clickWith = async ({ x, y }, modifiers) => {
    await pointAt({ x, y }, modifiers);
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers });
  };
  const altClick = (spot) => clickWith(spot, ALT);
  const popupHidden = () => page.eval(`document.querySelector("#popover").hidden`);
  const popupQuote = () => page.eval(`[...CSS.highlights.get("pending")][0]?.toString()`);
  const sendPicked = async () => {
    event = waitForEvent(docId);
    await sleep(300);
    await page.eval(`document.querySelector('#popover [data-act="send"]').click()`);
    return (await event).annotations[0];
  };

  const rowSpot = await page.eval(`__centre("Praha, Ostrava", 0)`);
  await altDown();
  await pointAt(rowSpot, ALT);
  assert.ok(await page.eval(`(() => {
    const outline = document.querySelector("#block-outline"), row = [...document.querySelectorAll("#doc tr")].find((tr) => tr.textContent.includes("Praha, Ostrava")).getBoundingClientRect();
    const box = outline.getBoundingClientRect();
    return !outline.hidden && box.left <= row.left && box.right >= row.right && box.top <= row.top && box.bottom >= row.bottom && box.height < row.height + 12;
  })()`), "with Alt held the block under the pointer gets an outline");
  await altUp();
  assert.equal(await page.eval(`document.querySelector("#block-outline").hidden`), true, "releasing Alt takes the outline away");
  await altClick(rowSpot);
  assert.match(await popupQuote(), /Praha, Ostrava/);
  const row = await sendPicked();
  assert.deepEqual([row.scope, row.lines, row.exact], ["block", lineOf("| 2    | Praha"), true], "Alt+click takes the innermost block");
  await altClick(rowSpot);
  await altClick(rowSpot);
  const table = await sendPicked();
  assert.deepEqual([table.scope, table.lines, table.exact], ["block", `${lineOf("| Wave | Branches")}-${lineOf("| 3    | Plzeň")}`, true], "a second Alt+click on a table row takes the whole table");
  const diagramSpot = await page.eval(`(() => {
    const diagram = document.querySelector("pre.mermaid");
    diagram.scrollIntoView({ block: "center" });
    const rect = diagram.querySelector("svg").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await altClick(diagramSpot);
  const diagram = await sendPicked();
  assert.deepEqual([diagram.scope, diagram.lines, diagram.exact], ["block", `${lineOf("```mermaid")}-${Number(lineOf("wave2 --> wave3")) + 1}`, true], "Alt+click on a mermaid diagram sends its fence's lines");
  await sleep(100);
  console.log(`    screenshot ${await page.screenshot("11-diagram-block")}`);
  await page.eval(`document.addEventListener("click", (click) => { window.__clickPrevented = click.defaultPrevented; })`);
  const linkSpot = await page.eval(`(() => {
    const link = document.querySelector('#doc a[href*="portal"]');
    link.scrollIntoView({ block: "center" });
    const rect = link.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await altClick(linkSpot);
  assert.equal(await page.eval(`window.__clickPrevented`), true, "the browser's download on Alt+click is suppressed");
  assert.match(await popupQuote(), /^Drop the nightly FTP upload.*instead\.$/, "Alt+click on a link picks its block");
  await cancelPopup();
  const from = await page.eval(`__centre("Export invoices as CSV", 0)`);
  const to = await page.eval(`(() => { const rect = __rangeOf("the old XML export", 0).getClientRects()[0]; return { x: rect.left + 10, y: rect.top + rect.height / 2 }; })()`);
  await clickWith(from, 0);
  await clickWith(to, SHIFT);
  await page.waitFor(`!document.querySelector("#popover").hidden`, "the extended selection opens the popup");
  assert.match(await popupQuote(), /CSV[\s\S]*Keep/, "Shift+click still extends a selection");
  await cancelPopup();
  check("block pick: Alt shows the outline, Alt+click takes the block, again widens it; a diagram and a link work; Shift+click stays the browser's");

  const tap = async () => {
    await key("rawKeyDown", "Control", "ControlLeft", 17, CTRL);
    await key("rawKeyDown", "Shift", "ShiftLeft", 16, CTRL | SHIFT);
    await key("keyUp", "Shift", "ShiftLeft", 16, CTRL);
    await key("keyUp", "Control", "ControlLeft", 17);
  };
  const paletteOpen = () => page.eval(`!document.querySelector("#label-palette").hidden`);
  const iconShown = () => page.eval(`!document.querySelector("#armed-icon").hidden`);
  const draftCount = async () => Number((await page.eval(`__text("#send-drafts")`)).match(/\d+/)[0]);
  const escape = () => key("rawKeyDown", "Escape", "Escape", 27);
  await page.eval(`getSelection().removeAllRanges(); document.activeElement.blur()`);
  await tap();
  await tap();
  assert.ok(!(await paletteOpen()) && !(await iconShown()), "with no label armed yet, a second tap only closes the palette");
  await tap();
  assert.ok(await paletteOpen(), "Ctrl+Shift tapped opens the palette");
  assert.deepEqual(
    await page.eval(`[...document.querySelectorAll("#label-palette .tile")].map((tile) => [tile.dataset.label, tile.querySelector(".tile-name").textContent, tile.querySelector(".tile-digit")?.textContent ?? "", tile.classList.contains("greyed")])`),
    [["comment", "Comment", "", false], ["question", "Question", "4", false], ["change", "Change", "", false], ["remove", "Remove", "", false], ["insert", "Insert here", "", true], ["good", "Looks good", "5", false], ["reject", "Not this", "6", false], ["seek", "Seek", "", false]],
    "every label as a tile, with its digit; a point label is greyed",
  );
  await page.eval(`document.querySelector('#label-palette [data-label="reject"]').dispatchEvent(new PointerEvent("pointerenter"))`);
  assert.match(await page.eval(`__text("#label-palette .palette-description")`), /^Rejected as it stands/, "hovering a tile shows its description at once");
  console.log(`    screenshot ${await page.screenshot("12-palette")}`);
  await escape();
  assert.equal(await paletteOpen(), false, "Esc closes the palette");
  await page.eval(`document.querySelector("#stamp-toggle").click()`);
  assert.ok(await paletteOpen(), "the toolbar button opens it too");
  await page.eval(`document.querySelector('#label-palette [data-label="insert"]').click()`);
  assert.ok((await paletteOpen()) && !(await iconShown()), "a greyed tile cannot be picked");
  await key("rawKeyDown", "5", "Digit5", 53);
  assert.ok(!(await paletteOpen()) && (await iconShown()), "a digit picks its tile and arms the label");
  await pointAt({ x: 500, y: 300 });
  assert.deepEqual(await page.eval(`(() => { const box = document.querySelector("#armed-icon").getBoundingClientRect(); return [box.left, box.top, __text("#armed-icon")]; })()`), [514, 314, "👍"], "the armed label's icon rides beside the cursor");
  const armedHint = () => page.eval(`getComputedStyle(document.querySelector("#armed-icon"), "::after").content`);
  assert.match(await armedHint(), /click blocks · tap Alt or Esc to stop/, "the icon says how stamping works and how it ends");
  assert.deepEqual(await page.eval(`(() => {
    const icon = document.querySelector("#armed-icon"), hint = getComputedStyle(icon, "::after");
    return [icon.dataset.name, hint.backgroundColor, hint.color];
  })()`), ["Looks good", "rgb(34, 197, 94)", "rgb(255, 255, 255)"], "the hint names the armed label and wears its colour");
  assert.equal(await page.eval(`document.querySelector("#stamp-toggle").getAttribute("aria-pressed")`), "true", "🏷 shows that a label is armed");
  await escape();
  assert.equal(await iconShown(), false, "Esc drops the pick");
  await tap();
  await key("rawKeyDown", "5", "Digit5", 53);
  await altDown();
  await altUp();
  assert.equal(await iconShown(), false, "an Alt tap ends stamping");
  await tap();
  await key("rawKeyDown", "5", "Digit5", 53);
  await page.eval(`document.querySelector("#stamp-toggle").click()`);
  assert.ok(!(await iconShown()) && !(await paletteOpen()), "so does 🏷");

  const planSpots = async () => [
    await page.eval(`__centre("Enable the feature flag", 0)`),
    await page.eval(`(() => { const rect = __rangeOf("Watch the error dashboard", 0).getClientRects()[0]; return { x: rect.left + 20, y: rect.top + rect.height / 2 }; })()`),
    await page.eval(`(() => { const rect = __rangeOf("Roll out to the remaining", 0).getClientRects()[0]; return { x: rect.left + 20, y: rect.top + rect.height / 2 }; })()`),
  ];
  const [first, second, third] = await planSpots();
  const before = await draftCount();
  await tap();
  await page.eval(`document.querySelector('#label-palette [data-label="good"]').click()`);
  await pointAt(first);
  assert.ok(await page.eval(`!document.querySelector("#block-outline").hidden`), "while stamping the block under the pointer gets its outline without Alt");
  assert.equal(await page.eval(`document.querySelector("#block-outline").style.borderColor`), "rgb(34, 197, 94)", "the outline takes the armed label's colour");
  await clickWith(first, 0);
  await clickWith(second, 0);
  assert.equal(await draftCount(), before + 2, "a plain click stamps, as many blocks as you like");
  assert.equal(await popupHidden(), true, "a stamp opens no popup");
  await altDown();
  await altClick(third);
  await altUp();
  assert.equal(await draftCount(), before + 3, "Alt+click stamps too");
  assert.equal(await iconShown(), true, "releasing Alt after a click keeps stamping");
  await altDown();
  await altUp();
  assert.equal(await iconShown(), false, "only an Alt tap ends it");
  await altClick(first);
  assert.equal(await popupHidden(), false, "after it, Alt+click is block pick again");
  const chipsLook = () => page.eval(`(() => {
    const chip = document.querySelector("#popover .labels button[data-label]"), box = chip.getBoundingClientRect();
    return { at: [box.left, box.top, box.width], background: getComputedStyle(chip).backgroundColor, hint: getComputedStyle(document.querySelector("#popover .labels"), "::after").content };
  })()`);
  await altUp();
  const altUpLook = await chipsLook();
  assert.match(altUpLook.hint, /Alt\+click: add now/, "a note's popup always says what Alt+click on a label does, right of the labels");
  await altDown();
  const altDownLook = await chipsLook();
  assert.deepEqual(altDownLook.at, altUpLook.at, "holding Alt moves and grows nothing: the labels stay where they are about to be clicked");
  assert.notEqual(altDownLook.background, altUpLook.background, "holding Alt only tints the labels' background");
  await altUp();
  await cancelPopup();
  await sleep(100);
  console.log(`    screenshot ${await page.screenshot("13-stamps")}`);
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`document.querySelector("#send-drafts").click()`);
  const stamps = (await event);
  assert.deepEqual(
    [stamps.mode, ...stamps.annotations.map((stamp) => [stamp.label, stamp.text, stamp.scope, stamp.lines, stamp.exact])],
    ["silent", ...["Enable the feature flag", "Watch the error dashboard", "Roll out to the remaining"].map((item) => ["good", "", "block", lineOf(item), true])],
    "Send drafts delivers the stamps as one group: no text, each item's lines",
  );

  const armedIcon = () => page.eval(`__text("#armed-icon")`);
  await tap();
  await tap();
  assert.ok(!(await paletteOpen()) && (await iconShown()), "a double tap closes the palette and re-arms");
  assert.equal(await armedIcon(), "👍", "it re-arms the label of the round that ended");
  const flagSpot = await page.eval(`__centre("Enable the feature flag", 0)`);
  const draftsBeforeRepeat = await draftCount();
  await clickWith(flagSpot, 0);
  assert.equal(await draftCount(), draftsBeforeRepeat + 1, "and a click stamps with it");
  await clickWith(flagSpot, 0);
  assert.equal(await draftCount(), draftsBeforeRepeat, "again removes that stamp, as after any pick");
  await escape();
  await altDown();
  await altDigit(6);
  await altUp();
  assert.equal(await iconShown(), true, "Alt+digit starts stamping, and releasing Alt after the digit keeps it");
  await altDown();
  await altDigit(6);
  await altUp();
  assert.equal(await iconShown(), false, "the armed label's Alt+digit again stops stamping");
  await altDown();
  await altDigit(6);
  await altUp();
  await escape();
  await tap();
  await tap();
  assert.equal(await armedIcon(), "👎", "a label armed by its hotkey counts as the last one too");
  await key("rawKeyDown", "5", "Digit5", 53);
  assert.equal(await armedIcon(), "👍", "while stamping a plain digit switches the label");
  await key("rawKeyDown", "5", "Digit5", 53);
  assert.equal(await iconShown(), false, "and the armed label's digit again stops stamping");
  await escape();
  await tap();
  await sleep(600);
  await tap();
  assert.ok(!(await paletteOpen()) && !(await iconShown()), "a slow second tap only closes the palette");
  await tap();
  await escape();
  await tap();
  assert.ok((await paletteOpen()) && !(await iconShown()), "another key between two taps leaves them single taps");
  await escape();

  const stampOf = (spotQuote) => page.eval(`(() => {
    const item = [...document.querySelectorAll("#annotations .item")].find((candidate) => candidate.querySelector(".excerpt")?.textContent.startsWith(${JSON.stringify(spotQuote)}) && candidate.querySelector(".actions"));
    return item ? item.querySelector("strong").textContent : null;
  })()`);
  const codeSpot = await page.eval(`__centre("The CSV encoding must stay", 0)`);
  await altDown();
  await altDigit(5);
  assert.ok(await iconShown(), "Alt+digit arms a label and starts stamping");
  await altClick(codeSpot);
  assert.equal(await stampOf("The CSV encoding"), "Looks good");
  await altDigit(6);
  await altClick(codeSpot);
  assert.equal(await stampOf("The CSV encoding"), "Not this", "another digit switches the label mid-round; again on a stamp with another label switches it");
  await altClick(codeSpot);
  assert.equal(await stampOf("The CSV encoding"), null, "again with the same label removes the stamp");
  await altUp();
  await escape();
  await altClick(codeSpot);
  await page.eval(`document.querySelector("#popover textarea").value = "A comment with text."`);
  await page.eval(`document.querySelector('#popover button[type="submit"]').click()`);
  await sleep(150);
  await altDown();
  await altDigit(6);
  await altClick(codeSpot);
  await altUp();
  await escape();
  assert.equal(await page.eval(`[...document.querySelectorAll("#annotations .item")].filter((item) => item.querySelector(".excerpt")?.textContent.startsWith("The CSV encoding") && item.querySelector(".actions")).length`), 2, "an annotation with text is never touched; a stamp is added beside it");
  await page.eval(`[...document.querySelectorAll("#annotations .item")].filter((item) => item.querySelector(".excerpt")?.textContent.startsWith("The CSV encoding") && item.querySelector(".actions")).forEach((item) => item.querySelector(".actions button:last-child").click())`);

  const marked = cli(["mark", docId, "--set", "stamped"], JSON.stringify([{ label: "decision", quote: "Open question: do the branches" }]));
  assert.equal(marked.placed, 1);
  await page.waitFor(`document.querySelectorAll(".mark-card").length === 1`, "the mark to stamp");
  const markedSpot = await page.eval(`__centre("Open question: do the branches", 0)`);
  await altDown();
  await altDigit(5);
  await altClick(markedSpot);
  await altUp();
  await escape();
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`document.querySelector("#send-drafts").click()`);
  const onMark = (await event).annotations[0];
  assert.deepEqual([onMark.markId, onMark.markSet], [marked.marks[0].id, "stamped"], "a stamp on a marked block says which mark it answers");
  cli(["unmark", docId, "--all"]);

  await page.eval(`__select("Watch the error dashboard", 0)`);
  await page.waitFor(`!document.querySelector("#popover").hidden`, "the popup for the chip test");
  const draftsNow = await draftCount();
  assert.equal(await page.eval(`document.querySelector('#popover [data-label="reject"] .chip-digit').textContent`), "6", "a chip with a hotkey shows its digit");
  await altDigit(6);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#popover .labels [aria-pressed="true"]')].map((chip) => chip.dataset.label)`), ["reject"], "in the popup Alt+digit only marks that chip");
  assert.ok(!(await iconShown()) && (await draftCount()) === draftsNow && !(await popupHidden()), "it neither arms, adds nor sends");
  await altDigit(6);
  assert.ok(!(await page.eval(`[...document.querySelectorAll('#popover .labels [aria-pressed="true"]')].map((chip) => chip.dataset.label)`)).includes("reject"), "Alt+digit again unpicks that chip");
  await tap();
  assert.equal(await paletteOpen(), false, "the tap is ignored while the popup is open");
  await tap();
  assert.ok(!(await paletteOpen()) && !(await iconShown()), "so is a double tap");
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`document.querySelector("#popover textarea").focus(); document.querySelector("#popover textarea").value = "Sent by keys."`);
  await key("rawKeyDown", "Control", "ControlLeft", 17, CTRL);
  await key("rawKeyDown", "Shift", "ShiftLeft", 16, CTRL | SHIFT);
  await key("rawKeyDown", "Enter", "Enter", 13, CTRL | SHIFT);
  await key("keyUp", "Enter", "Enter", 13, CTRL | SHIFT);
  await key("keyUp", "Shift", "ShiftLeft", 16, CTRL);
  await key("keyUp", "Control", "ControlLeft", 17);
  assert.equal((await event).annotations[0].text, "Sent by keys.", "Ctrl+Shift+Enter still sends now");
  assert.equal(await paletteOpen(), false, "and opens nothing");

  await page.eval(`document.querySelector('${askedItem} .reply-actions button').click()`);
  assert.equal(await page.eval(`document.activeElement === document.querySelector("${panel} textarea")`), true);
  await altDigit(5);
  await tap();
  await tap();
  assert.ok(!(await iconShown()) && !(await paletteOpen()), "in the reply box neither Alt+digit nor a tap or double tap does anything");
  await page.eval(`__esc()`);

  await page.eval(`getSelection().removeAllRanges(); document.activeElement.blur()`);
  await tap();
  await key("rawKeyDown", "5", "Digit5", 53);
  await page.eval(`__select("Watch the error dashboard", 0)`);
  await page.waitFor(`!document.querySelector("#popover").hidden`, "a selection while stamping opens the popup");
  assert.ok(!(await iconShown()) && (await page.eval(`document.querySelector("#block-outline").hidden`)), "the popup pauses stamping");
  await cancelPopup();
  assert.equal(await iconShown(), true, "closing it resumes stamping");
  const stampedLinkSpot = await page.eval(`(() => {
    const link = document.querySelector('#doc a[href*="portal"]');
    link.scrollIntoView({ block: "center" });
    const rect = link.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const draftsBeforeLink = await draftCount();
  await page.eval(`window.__clickPrevented = null`);
  await clickWith(stampedLinkSpot, 0);
  assert.ok((await page.eval(`window.__clickPrevented`)) && (await draftCount()) === draftsBeforeLink + 1, "a click on a link stamps its block and does not follow it");
  await clickWith(stampedLinkSpot, 0);
  await escape();
  check("label stamp: the palette, Alt+digit or a double tap arm a label; then every click stamps a block without text until an Alt tap, Esc or 🏷; the popup pauses it; digits switch the label");

  const fakeRuns = () => readFileSync(claudeLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const flagOf = (run, flag) => run.args[run.args.indexOf(flag) + 1];
  const openComment = (needle, comment) => page.eval(`(async () => {
    __select(${JSON.stringify(needle)}, 0);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("#popover textarea").value = ${JSON.stringify(comment)};
  })()`);
  const tick = (name) => page.eval(`document.querySelector('#popover .send-ticks [data-tick="${name}"]').click()`);
  const sendLabel = () => page.eval(`document.querySelector('#popover [data-act="send"]').textContent`);
  const clickSend = () => page.eval(`document.querySelector('#popover [data-act="send"]').click()`);
  const cardOf = (comment) => `[...document.querySelectorAll("#annotations .item")].find((item) => item.querySelector(".text")?.textContent === ${JSON.stringify(comment)})`;
  const repliesIn = (comment) => page.eval(`[...${cardOf(comment)}.querySelectorAll(".reply")].map((reply) => reply.textContent)`);
  const noSessionEvent = async (what) => assert.equal((await waitForEvent(docId, 2)).kind, "timeout", what);

  await openComment("Keep the old XML export", "A blank question");
  assert.equal(await page.eval(`document.querySelector('#popover .send-ticks [data-tick="repo"]').disabled`), true, "the other checkboxes wait for New agent");
  await tick("new");
  assert.equal(await sendLabel(), "Send now · Default high blank", "while anything is ticked, Send now says who will answer");
  assert.match(await page.eval(`__text("#popover .send-warning")`), /session will not see this thread/);
  console.log(`    screenshot ${await page.screenshot("14-send-row")}`);
  await clickSend();
  await page.waitFor(`${cardOf("A blank question")}?.querySelector(".reply")?.textContent.includes("Answered: A blank question")`, "a separate run answers under the annotation");
  await noSessionEvent("a new agent never wakes the session");
  const blankRun = fakeRuns().at(-1);
  assert.ok(blankRun.args.includes("--safe-mode") && blankRun.args.includes("--strict-mcp-config") && blankRun.bundledSkillsOff, "repo context off runs blank");
  assert.deepEqual(blankRun.sessionMarkers, [], "the run cannot find the session");
  assert.equal(flagOf(blankRun, "--tools"), "Read,Grep,Glob,WebSearch,WebFetch,Bash", "it may only read");
  assert.match(blankRun.prompt, /Document: .*demo\.md[\s\S]*Lines: \d+[\s\S]*Quoted text: Keep the old XML export[\s\S]*Label: [\s\S]*Comment: A blank question/, "the request is all it gets");
  assert.match(blankRun.cwd, /edit-md-e2e-/, "it starts in the document's folder");
  assert.equal(await page.eval(`${cardOf("A blank question")}.querySelector(".reply").dataset.by`), "default model · high effort · blank", "the card says who answered");
  assert.ok(await page.eval(`${cardOf("A blank question")}.querySelector(".state").textContent === "with a new agent" && !${cardOf("A blank question")}.querySelector(".actions")`), "a sent card is never sent again");

  event = waitForEvent(docId);
  await page.eval(`${cardOf("A blank question")}.querySelector(".reply-actions button").click()`);
  await sleep(100);
  const beforeFollowUp = fakeRuns().length;
  await page.eval(`(() => {
    const box = document.querySelector("${panel} textarea");
    box.value = "And a follow-up";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  })()`);
  await page.waitFor(`${cardOf("A blank question")}.querySelectorAll(".reply").length === 2`, "the follow-up's answer in the same thread");
  const followUpRun = fakeRuns()[beforeFollowUp];
  assert.equal(flagOf(followUpRun, "--resume"), flagOf(blankRun, "--session-id"), "a follow-up goes back to the same run");
  assert.ok(followUpRun.args.includes("--safe-mode"), "with the same ticks");
  assert.equal((await event).kind, "timeout", "and the session stays out of it");
  await page.eval(`__esc()`);

  await openComment("Export invoices as CSV", "SLOW question");
  await tick("new");
  await clickSend();
  await page.waitFor(`${cardOf("SLOW question")}?.querySelector(".run-state.answering .run-elapsed")`, "answering, with the time");
  await page.waitFor(`__text("#runs-warning") === "1 run still answering — Submit cancels them" && !document.querySelector("#runs-warning").hidden`, "the Submit row warns of a running run");
  await sleep(800);
  await page.eval(`location.reload()`);
  await sleep(600);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("Release checklist")`, "reloaded");
  await page.eval(pageHelpers);
  await page.waitFor(`${cardOf("SLOW question")}?.querySelector(".run-state.answering")`, "a reload does not stop a run");
  const slowPid = fakeRuns().at(-1).pid;
  process.kill(slowPid, 0);
  await page.eval(`${cardOf("SLOW question")}.querySelector(".run-state button").click()`);
  await page.waitFor(`${cardOf("SLOW question")}?.querySelector(".run-state.cancelled")?.textContent === "Cancelled."`, "Cancel stops the run and the card says so");
  await page.waitFor(`document.querySelector("#runs-warning").hidden`, "no more warning");
  assert.throws(() => process.kill(slowPid, 0), "the process is gone");
  await openComment("Export invoices as CSV", "BROKEN question");
  await tick("new");
  await clickSend();
  await page.waitFor(`${cardOf("BROKEN question")}?.querySelector(".run-state.failed")?.textContent === "It broke."`, "a failed run leaves its error on the card");
  await openComment("Export invoices as CSV", "PLAINTEXT question");
  await tick("new");
  await clickSend();
  await page.waitFor(`${cardOf("PLAINTEXT question")}?.querySelector(".reply")?.textContent.includes("No structure here.")`, "a run without structured output still answers");

  await openComment("Export invoices as CSV", "REWRITE this");
  await tick("new");
  await clickSend();
  await page.waitFor(`${cardOf("REWRITE this")}?.querySelector(".reply-suggestion p")?.textContent === "Better wording."`, "the suggestion on the reply card");
  await page.eval(`[...${cardOf("REWRITE this")}.querySelectorAll(".reply-suggestion button")].find((b) => b.textContent === "Use").click()`);
  assert.equal(await page.eval(`${cardOf("Better wording.")}.querySelector("strong").textContent + "|" + ${cardOf("Better wording.")}.querySelector(".excerpt").textContent`), "Change|Export invoices as CSV", "Use turns it into a change draft on the same span");
  assert.equal(await page.eval(`!!${cardOf("REWRITE this")}.querySelector(".reply-suggestion")`), false, "and the offer is gone");
  await page.eval(`${cardOf("Better wording.")}.querySelector(".actions button:last-child").click()`);
  check("a new agent: a separate run answers under the annotation, the session never wakes; Cancel, errors, follow-ups by the same run, a suggestion to Use");

  cli(["models", "--set"], JSON.stringify([{ id: "claude-opus-5-5", name: "Opus 5.5" }]));
  assert.deepEqual(cli(["models"]), [{ id: "claude-opus-5-5", name: "Opus 5.5" }]);
  await page.eval(`location.reload()`);
  await sleep(600);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("Release checklist")`, "reloaded");
  await page.eval(pageHelpers);
  await openComment("Export invoices as CSV", "A repo question");
  await tick("new");
  await tick("repo");
  await page.eval(`(() => { const model = document.querySelector("#popover .send-ticks select"); model.value = "claude-opus-5-5"; model.dispatchEvent(new Event("change")); })()`);
  assert.equal(await sendLabel(), "Send now · Opus 5.5 high repo");
  await clickSend();
  await page.waitFor(`${cardOf("A repo question")}?.querySelector(".reply")`, "the repo run's answer");
  const repoRun = fakeRuns().at(-1);
  assert.ok(!repoRun.args.includes("--safe-mode") && !repoRun.bundledSkillsOff, "repo context on loads the repo");
  assert.equal(flagOf(repoRun, "--model"), "claude-opus-5-5", "the picked model answers");
  assert.equal(flagOf(repoRun, "--effort"), "high", "at high effort unless the slider says otherwise");
  assert.ok(!repoRun.args.includes("--settings"), "in the session's own repo, hooks stay on");

  await openComment("Export invoices as CSV", "EDITDOC please");
  await tick("new");
  await tick("edit");
  assert.equal(await page.eval(`document.querySelector('#popover .send-ticks [data-tick="repo"]').checked`), true, "ticking May edit also ticks Repo context");
  assert.match(await page.eval(`__text("#popover .send-warning")`), /edits files in the repo itself/);
  assert.equal(await sendLabel(), "Send now · Default high repo may edit");
  await clickSend();
  await page.waitFor(`${cardOf("EDITDOC please")}?.querySelector(".reply-reload")`, "the ↻ for a run that changed the reviewed document");
  const editRun = fakeRuns().at(-1);
  assert.ok(flagOf(editRun, "--tools").endsWith(",Edit,Write") && editRun.args.includes("Edit") && editRun.args.includes("Write"), "May edit adds the editing tools");
  assert.match(await page.eval(`${cardOf("EDITDOC please")}.querySelector(".reply-changed").textContent`), /Changed: demo\.md/, "the card lists what changed");
  assert.ok(readFileSync(md, "utf8").includes("A paragraph the run added."));
  assert.ok(await page.eval(`!document.querySelector("#doc").textContent.includes("A paragraph the run added.")`), "nothing reloads on its own");
  event = waitForEvent(docId);
  await sleep(300);
  await openComment("Export invoices as CSV", "Asked over an old version");
  await clickSend();
  assert.equal((await event).fileChanged, true, "a send on an older version says so");
  await page.eval(`${cardOf("EDITDOC please")}.querySelector(".reply-reload").click()`);
  await page.waitFor(`document.querySelector("#doc").textContent.includes("A paragraph the run added.")`, "the ↻ shows the edit in place");
  await page.waitFor(`!${cardOf("EDITDOC please")}.querySelector(".reply-reload")`, "the ↻ is gone once used");
  assert.ok(await page.eval(`!!${cardOf("Asked over an old version")}`), "the page's annotations stay");
  event = waitForEvent(docId);
  await sleep(300);
  await openComment("Export invoices as CSV", "Asked over the new version");
  await clickSend();
  assert.equal((await event).fileChanged, undefined, "after it, a send has nothing to warn of");

  await openComment("Export invoices as CSV", "EDITPROTECTED please");
  await tick("new");
  await tick("edit");
  await clickSend();
  await page.waitFor(`${cardOf("EDITPROTECTED please")}?.querySelector(".reply-changed")?.textContent.includes("protected.md")`, "the server applies what the run's tools cannot write");
  assert.equal(readFileSync(join(workDir, "protected.md"), "utf8"), "fresh false");
  await openComment("Export invoices as CSV", "EDITBAD please");
  await tick("new");
  await tick("edit");
  await clickSend();
  await page.waitFor(`${cardOf("EDITBAD please")}?.querySelector(".reply-note")?.textContent.includes("refused")`, "refused edits are said on the card");
  assert.equal(readFileSync(join(workDir, "protected.md"), "utf8"), "fresh false", "refused means none applied");
  assert.match(await page.eval(`${cardOf("EDITBAD please")}.querySelector(".reply-changed").textContent`), /src\.txt/, "what the run's own tools did is still listed");

  const editingRuns = fakeRuns().length;
  await openComment("Export invoices as CSV", "TAKEATURN first");
  await tick("new");
  await tick("edit");
  await clickSend();
  await openComment("Export invoices as CSV", "TAKEATURN second");
  await tick("new");
  await tick("edit");
  await clickSend();
  await page.waitFor(`${cardOf("TAKEATURN second")}?.querySelector(".reply") && ${cardOf("TAKEATURN first")}?.querySelector(".reply")`, "both editing runs answered", 15000);
  const [firstEditor, secondEditor] = fakeRuns().slice(editingRuns);
  assert.ok(secondEditor.at - firstEditor.at >= 1400, "a second editing run in the repo starts only after the first has ended");
  await page.eval(`${cardOf("TAKEATURN first")}.querySelector(".reply-actions button").click()`);
  assert.equal(await page.eval(`document.querySelector("${panel}").classList.contains("may-edit")`), true, "a thread with May edit shows red in its reply box");
  await page.eval(`__esc()`);
  check("May edit: the run edits itself, the server applies what it cannot, all or none; the card lists it, ↻ shows it; one editing run per repo");

  const sessionButtons = cli(["buttons", docId, "--set"], JSON.stringify({ buttons: [
    { id: "cold", icon: "🧊", name: "Cold read", description: "Opus, as an outsider", by: "new", model: "claude-haiku-5-5", prompt: "Read it as an outsider.", system: "Be skeptical.", maxTurns: 7 },
    { id: "compare", icon: "⚖️", name: "Compare", by: "session", instructions: "Run it twice and compare." },
  ] }));
  assert.deepEqual(sessionButtons.buttons.map((button) => button.id), ["session", "blank", "repo", "brief", "do-it", "cold", "compare"], "the session's list adds to the five shipped");
  assert.match(cli(["buttons", docId, "--set"], JSON.stringify({ buttons: [{ id: "x", icon: "y", temperature: 1 }] })).error ?? "", /temperature/, "an unknown field is reported, not ignored");
  await page.waitFor(`document.querySelector('#popover .send-chip[data-button="cold"]')`, "the chips");
  await openComment("Export invoices as CSV", "By a button");
  assert.ok(await page.eval(`document.querySelector('#popover .send-chip[data-button="do-it"]').classList.contains("edits") && !document.querySelector('#popover .send-chip[data-button="cold"]').classList.contains("edits")`), "a button that edits is a red chip");
  const pickModel = (id) => page.eval(`(() => { const model = document.querySelector("#popover .send-ticks select"); model.value = "${id}"; model.dispatchEvent(new Event("change")); })()`);
  assert.equal(await page.eval(`document.querySelector("#popover .send-ticks select").disabled`), false, "the model picker works without New agent, for the buttons");
  await pickModel("claude-opus-5-5");
  await page.eval(`document.querySelector('#popover .send-chip[data-button="cold"]').click()`);
  await page.waitFor(`${cardOf("By a button")}?.querySelector(".reply")`, "one click answers");
  const buttonRun = fakeRuns().at(-1);
  assert.equal(flagOf(buttonRun, "--model"), "claude-haiku-5-5", "a button with its own model keeps it over the picked one");
  assert.equal(flagOf(buttonRun, "--max-turns"), "7");
  assert.match(flagOf(buttonRun, "--append-system-prompt"), /Be skeptical\./);
  assert.ok(buttonRun.prompt.indexOf("Read it as an outsider.") < buttonRun.prompt.indexOf("Document: "), "the button's prompt goes before the request");
  assert.equal(await page.eval(`${cardOf("By a button")}.querySelector(".reply").dataset.by`), "claude-haiku-5-5 · high effort · blank", "its card shows the model");
  await openComment("Export invoices as CSV", "By Blank with a pick");
  await pickModel("claude-opus-5-5");
  await page.eval(`document.querySelector('#popover .send-chip[data-button="blank"]').click()`);
  await page.waitFor(`${cardOf("By Blank with a pick")}?.querySelector(".reply")`, "the Blank button's answer");
  assert.equal(flagOf(fakeRuns().at(-1), "--model"), "claude-opus-5-5", "a button without a model of its own takes the picked one");
  assert.equal(await page.eval(`${cardOf("By Blank with a pick")}.querySelector(".reply").dataset.by`), "claude-opus-5-5 · high effort · blank");
  assert.match(fakeRuns().at(-1).args.join(" "), /You are a separate run edit-md started/, "a run is told it is not the session agent");
  event = waitForEvent(docId);
  await sleep(300);
  await openComment("Export invoices as CSV", "By the session's button");
  await page.eval(`document.querySelector('#popover .send-chip[data-button="compare"]').click()`);
  const buttoned = await event;
  assert.deepEqual([buttoned.button?.id, buttoned.button?.instructions], ["compare", "Run it twice and compare."], "a by-session button reaches the session with its instructions");
  cli(["push", docId, "--to", buttoned.annotations[0].id], "Compared.");

  event = waitForEvent(docId);
  await sleep(300);
  await openComment("Export invoices as CSV", "A briefed question");
  await tick("new");
  await tick("brief");
  assert.match(await page.eval(`__text("#popover .send-warning")`), /writes the brief and sees nothing after it/, "with Brief the fixed line says so");
  await clickSend();
  const briefEvent = await event;
  assert.equal(briefEvent.agent?.brief, true, "the event reaches the session with the ticks");
  assert.match(briefEvent.hint, /delegate/);
  assert.match(cli(["delegate", docId, "--to", "a999"], "x").error ?? "", /not waiting/);
  assert.deepEqual(cli(["delegate", docId, "--to", briefEvent.annotations[0].id], "The reviewer cares about the replica."), { started: briefEvent.annotations[0].id });
  await page.waitFor(`${cardOf("A briefed question")}?.querySelector(".reply")`, "the briefed run answers");
  assert.match(fakeRuns().at(-1).prompt, /A brief from an agent[\s\S]*The reviewer cares about the replica\./, "the run gets the brief");
  assert.equal(await page.eval(`${cardOf("A briefed question")}.querySelector(".reply").dataset.by`), "default model · high effort · blank · briefed");
  check("send buttons: chips add to the checkboxes, one click sends with the button's setup, by-session reaches the agent; Brief hands off through the session");

  await openComment("Export invoices as CSV", "Keeps nothing");
  await tick("new");
  await page.eval(`document.querySelector('#popover button[type="submit"]').click()`);
  await sleep(100);
  assert.equal(await page.eval(`!!${cardOf("Keeps nothing")}.querySelector(".send-row")`), false, "on a draft card the send row stays folded");
  await page.eval(`${cardOf("Keeps nothing")}.querySelector(".send-more").click()`);
  assert.equal(await page.eval(`${cardOf("Keeps nothing")}.querySelector('[data-tick="new"]').checked`), false, "Add drops the ticks: the card's own row starts off");
  await page.eval(`${cardOf("Keeps nothing")}.querySelector('[data-tick="new"]').click()`);
  assert.match(await page.eval(`[...${cardOf("Keeps nothing")}.querySelectorAll(".actions button")].map((b) => b.textContent).join("|")`), /Send now · Default high blank/, "the card's Send now says who answers");
  await page.eval(`[...${cardOf("Keeps nothing")}.querySelectorAll(".actions button")].find((b) => b.textContent.startsWith("Send now")).click()`);
  await page.waitFor(`${cardOf("Keeps nothing")}.querySelector(".reply")`, "a draft card can send to a new agent");
  await openComment("Export invoices as CSV", "Testing the save");
  await tick("new");
  await tick("edit");
  await page.eval(`document.querySelector("#popover .send-save").click()`);
  await sleep(150);
  const keptTicks = (await prefs())?.pc["delegated.ticks"];
  assert.deepEqual([keptTicks.newAgent, keptTicks.repo, "edit" in keptTicks], [true, true, false], "💾 keeps the ticks as this PC's default, May edit never");
  await cancelPopup();
  await openComment("Export invoices as CSV", "The next one");
  assert.deepEqual(await page.eval(`["new", "repo", "edit"].map((name) => document.querySelector('#popover [data-tick="' + name + '"]').checked)`), [true, true, false], "the next comment starts from them");
  await tick("repo");
  await tick("new");
  await page.eval(`document.querySelector("#popover .send-save").click()`);
  await sleep(150);
  await cancelPopup();
  check("the ticks: start off, stick only through 💾 and never for May edit, Add drops them; a draft card's row is folded");

  const printedSkills = cli(["skills", docId]).skills;
  assert.deepEqual(printedSkills.map((skill) => [skill.name, skill.source, skill.shadowed ?? false]), [["repo-probe", "repo", false], ["same-name", "user", false], ["same-name", "repo", true], ["show-md-for-comment", "user", false]], "edit-md skills prints what the server read");
  const pickerOpen = () => page.eval(`!document.querySelector("#skill-picker").hidden`);
  const typeInto = async (text) => page.send("Input.insertText", { text });
  const ctrlSpace = async () => {
    await key("rawKeyDown", " ", "Space", 32, CTRL);
    await key("keyUp", " ", "Space", 32, CTRL);
  };
  await openComment("Export invoices as CSV", "");
  assert.match(await page.eval(`document.querySelector("#popover textarea").placeholder`), /Ctrl\+Space skills/, "the box hints the key");
  assert.equal(await page.eval(`__text("#popover .skills-toggle")`), "/ Skills · Ctrl+Space", "the button shows it");
  await page.eval(`document.querySelector("#popover textarea").focus()`);
  await typeInto("/");
  assert.equal(await pickerOpen(), false, "typing / opens nothing");
  await page.eval(`document.querySelector("#popover textarea").value = "Please run "; document.querySelector("#popover textarea").setSelectionRange(11, 11)`);
  await ctrlSpace();
  await page.waitFor(`!document.querySelector("#skill-picker").hidden`, "Ctrl+Space opens the picker");
  assert.deepEqual(
    await page.eval(`[...document.querySelectorAll("#skill-picker section")].map((section) => [section.dataset.source, [...section.querySelectorAll(".skill-item")].map((item) => item.textContent + (item.classList.contains("shadowed") ? "*" : ""))])`),
    [["repo", ["repo-probe", "same-name*"]], ["user", ["same-name", "show-md-for-comment"]]],
    "repo and user split, alphabetical, a shadowed one greyed",
  );
  assert.deepEqual(await page.eval(`[...document.querySelectorAll("#skill-picker .skill-item.user-only")].map((item) => [item.closest("section").dataset.source, item.dataset.name, getComputedStyle(item, "::after").content])`), [["user", "same-name", '" ❗"']], "a user-only skill carries ❗");
  assert.match(await page.eval(`document.querySelector("#skill-picker .skill-item.user-only").title`), /Type \/same-name in the chat once/, "its hover says how to start it");
  assert.equal(await page.eval(`document.activeElement === document.querySelector("#skill-picker input")`), true, "the search box has the focus");
  await typeInto("smfc");
  await page.waitFor(`[...document.querySelectorAll("#skill-picker .skill-item")].length === 1`, "the search keeps the names holding the characters in order");
  assert.equal(await page.eval(`__text("#skill-picker .skill-item.selected")`), "show-md-for-comment", "the best match is preselected");
  assert.match(await page.eval(`__text("#skill-picker .skill-description")`), /Open a Markdown file for comment\./, "the description shows beside the list");
  console.log(`    screenshot ${await page.screenshot("15-skills")}`);
  await key("rawKeyDown", "Enter", "Enter", 13);
  assert.equal(await pickerOpen(), false, "Enter inserts and closes");
  assert.equal(await page.eval(`document.querySelector("#popover textarea").value`), "Please run /show-md-for-comment ", "the name lands at the cursor");
  assert.equal(await page.eval(`document.activeElement === document.querySelector("#popover textarea")`), true, "the cursor is back in the box");
  await ctrlSpace();
  await page.waitFor(`!document.querySelector("#skill-picker").hidden`, "the picker again");
  await key("rawKeyDown", "ArrowDown", "ArrowDown", 40);
  assert.ok(await page.eval(`!!document.querySelector("#skill-picker .skill-item.selected")`), "arrow keys move through the list");
  await key("rawKeyDown", "Escape", "Escape", 27);
  assert.equal(await pickerOpen(), false, "Esc closes the picker first");
  assert.equal(await popupHidden(), false, "and leaves the comment open");
  assert.equal(await page.eval(`document.querySelector("#popover textarea").value`), "Please run /show-md-for-comment ", "with its text as it was");
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`document.querySelector('#popover [data-act="send"]').click()`);
  const naming = (await event).annotations[0];
  assert.deepEqual(naming.skills, ["show-md-for-comment"], "the annotation carries the name");
  event = waitForEvent(docId);
  await openComment("Export invoices as CSV", "the show-md-for-comment skill and /not-a-skill are just words");
  await clickSend();
  assert.equal((await event).annotations[0].skills, undefined, "a bare word or an unknown name does not count");
  await openComment("Export invoices as CSV", "");
  await tick("new");
  await page.eval(`document.querySelector("#popover .skills-toggle").click()`);
  await page.waitFor(`!document.querySelector("#skill-picker").hidden`, "the picker from the button");
  assert.match(await page.eval(`__text("#skill-picker .skill-note")`), /do not load in a blank run/, "for a blank run the picker says skills do not load");
  await page.eval(`[...document.querySelectorAll("#skill-picker .skill-item")].find((item) => item.textContent === "repo-probe").click()`);
  await tick("repo");
  await page.eval(`document.querySelector("#popover textarea").value += "on this"`);
  await clickSend();
  await page.waitFor(`${cardOf("/repo-probe on this")}?.querySelector(".reply")`, "the repo run's answer");
  const skillRun = fakeRuns().at(-1);
  assert.ok(skillRun.prompt.startsWith("/repo-probe"), "a name that starts the comment leads the run's prompt");
  assert.equal(await page.eval(`${cardOf("/repo-probe on this")}.querySelector(".reply").dataset.by`), "default model · high effort · repo · /repo-probe", "the reply card names the skill");
  await openComment("Export invoices as CSV", "why did /repo-probe fail?");
  await tick("new");
  await tick("repo");
  await clickSend();
  await page.waitFor(`${cardOf("why did /repo-probe fail?")}?.querySelector(".reply")`, "the answer");
  assert.ok(!fakeRuns().at(-1).prompt.startsWith("/"), "anywhere else in the comment it stays text");
  await page.eval(`(async () => {
    __fakeMic();
    __select("Export invoices as CSV", 0);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("#popover .mic").click();
    __heard("first words");
    document.querySelector("#popover .skills-toggle").click();
    await new Promise((r) => setTimeout(r, 150));
    document.querySelector("#skill-picker .skill-item").click();
    __heard(" last words");
  })()`);
  assert.equal(await page.eval(`document.querySelector("#popover textarea").value`), "first words /repo-probe last words", "a skill picked while dictating stays where it was put, and the next words follow it");
  await cancelPopup();
  await page.eval(`document.querySelector('${askedItem} .reply-actions button').click()`);
  assert.equal(await page.eval(`!document.querySelector("#thread-panel .skills-toggle").hidden`), true, "the reply box has the button too");
  await page.eval(`__esc()`);
  assert.deepEqual(cli(["skills", "--ran", "/same-name", "repo-probe"]).ran, ["repo-probe", "same-name"], "the session reports the skills it has run");
  await openComment("Export invoices as CSV", "");
  await page.eval(`document.querySelector("#popover .skills-toggle").click()`);
  await page.waitFor(`!document.querySelector("#skill-picker").hidden && document.querySelector('#skill-picker [data-source="user"] [data-name="same-name"]')`, "the picker again");
  assert.deepEqual(await page.eval(`(() => { const item = document.querySelector('#skill-picker [data-source="user"] [data-name="same-name"]'); return [item.classList.contains("user-only"), item.title]; })()`), [false, "Run in this session: the agent can follow it from a comment."], "a skill the session has run drops its ❗");
  await page.eval(`__esc()`);
  await cancelPopup();
  check("skill picker: the user's and the repo's, split; Ctrl+Space and the button; search, description, insert; a /name that starts the comment fires in a run; a user-only one shows ❗ until the session has run it");
  assert.deepEqual(page.errors, [], `page errors: ${page.errors.join("\n")}`);

  await page.eval(`(async () => {
    document.querySelector("#general").click();
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector("#popover textarea").value = "Overall fine, ship after the encoding fix.";
    document.querySelector('#popover button[type="submit"]').click();
  })()`);
  assert.equal(await page.eval(`__text("#submit") + "|" + document.querySelector("#apply-silent").hidden`), "Apply & review|false");
  assert.equal(await page.eval(`document.querySelector('#annotations .item .head strong').textContent`), "Comment", "a general comment starts from the first label");
  assert.equal(await page.eval(`document.querySelectorAll("#annotations .item.general").length`), 1, "the general comment is tinted in the list");
  cli(["push", docId, "--quote", "reporting replica", "--text", "This is the replica I meant."]);
  await page.waitFor(`CSS.highlights.get("agent")?.size === 1`, "agent quote highlight");
  console.log(`    screenshot ${await page.screenshot("3-replies")}`);
  await clickAt(await page.eval(`__spot("reporting replica", 0)`));
  await page.waitFor(`document.querySelector("#thread-panel").hidden === false && document.querySelector("#thread-panel .thread-turns").textContent.includes("the replica I meant")`, "the large panel from a reply's own highlight");
  await page.eval(`__esc()`);
  check("push --quote highlights an agent-chosen span, and clicking it opens the reply");

  writeFileSync(md, readFileSync(md, "utf8").replace("# Release checklist", "# Release checklist (rev 2)\n\nA new intro line pushes everything down."));
  const reopened = cli(["open", md, "--no-browser"]);
  assert.deepEqual([reopened.reopened, reopened.changes], [true, 2]);
  await page.waitFor(`document.querySelector("#doc h1").textContent.includes("rev 2")`, "re-render after re-open");
  await page.waitFor(`__struck() === 1 && !document.querySelector(".state.orphan")`, "anchors re-resolved, a picked diagram's once it has rendered again", 20000);
  check("re-open while connected re-renders in place; anchors re-resolve");

  await page.waitFor(`document.querySelectorAll("#change-marks .chg-mark").length === 2`, "change marks");
  assert.ok(await page.eval(`(() => {
    const bar = document.querySelector("#change-marks .chg-mark.changed").getBoundingClientRect(), h1 = document.querySelector("#doc h1").getBoundingClientRect();
    return Math.abs(bar.top - h1.top) < 2 && Math.abs(bar.height - h1.height) < 2 && bar.right <= document.querySelector("#doc").getBoundingClientRect().left;
  })()`), "the changed bar sits in the gutter beside the edited heading");
  assert.equal(await page.eval(`document.querySelectorAll("#change-marks .chg-mark.added").length`), 1);
  assert.deepEqual(
    await page.eval(`[...document.querySelectorAll("#outline .change")].map((c) => c.classList[1] + "|" + (c.querySelector(".before")?.textContent ?? ""))`),
    ["changed|# Release checklist — invoice export v2", "added|"],
  );
  assert.equal(
    await page.eval(`[...document.querySelectorAll("#outline-filters label")].map((l) => l.textContent).join(",")`),
    "Outline,Changes (2),~ changed (1),+ added (1)",
  );
  const toggleFilter = (category) => page.eval(`document.querySelector('#outline-filters input[data-category="${category}"]:not([data-tone])').click()`);
  await page.eval(`document.querySelector('#outline-filters input[data-tone="added"]').click()`);
  assert.deepEqual(
    await page.eval(`[...document.querySelectorAll("#outline .section-item:not([hidden]) .change")].map((c) => c.classList[1]).join() + "|" + document.querySelector("#outline > li .hidden-counts").textContent`),
    "changed|+1",
    "unticking one kind hides just those changes and counts them on the heading",
  );
  await page.eval(`document.querySelector('#outline-filters input[data-tone="added"]').click()`);
  await toggleFilter("changes");
  assert.ok(await page.eval(`[...document.querySelectorAll("#outline .section-item")].every((item) => item.hidden)`), "unticking Changes hides the changes");
  assert.deepEqual(
    await page.eval(`[...document.querySelector("#outline > li .hidden-counts").children].map((count) => count.className + count.textContent)`),
    ["tone-changed~1", "tone-added+1"],
    "hidden changes leave coloured counts on their heading",
  );
  await toggleFilter("changes");
  await toggleFilter("outline");
  assert.equal(await page.eval(`[...document.querySelectorAll("#outline > li")].filter((li) => !li.hidden).length`), 1, "unticking Outline keeps only the heading that holds changes");
  await toggleFilter("outline");
  await page.eval(`document.querySelector("#changes-toggle").click()`);
  assert.equal(await page.eval(`document.querySelectorAll("#change-marks .chg-mark").length`), 0);
  await page.eval(`document.querySelector("#changes-toggle").click()`);
  assert.equal(await page.eval(`document.querySelectorAll("#change-marks .chg-mark").length`), 2);
  await page.eval(`window.scrollTo(0, 0)`);
  console.log(`    screenshot ${await page.screenshot("6-changes")}`);
  check("re-open marks what changed since the page last loaded: bars in the gutter, old text in the left pane, filterable, toggleable");

  const leftBody = `document.querySelector("#left .pane-body")`;
  const leftWidth = () => page.eval(`document.querySelector("#left").getBoundingClientRect().width`);
  assert.ok(await page.eval(`${leftBody}.scrollWidth <= ${leftBody}.clientWidth`), "no sideways scrolling in the left pane");
  const fitted = await leftWidth();
  assert.ok(fitted >= 160 && fitted <= 361, `the left pane fits its content within its cap (${fitted}px)`);
  const edge = await page.eval(`(() => { const r = document.querySelector('#left .pane-edge').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 }; })()`);
  const mouse = (type, x) => page.send("Input.dispatchMouseEvent", { type, x, y: edge.y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  await mouse("mousePressed", edge.x);
  await mouse("mouseMoved", edge.x + 40);
  await mouse("mouseMoved", edge.x - 60);
  await mouse("mouseReleased", edge.x - 60);
  const layoutLeft = await page.eval(`document.querySelector("#layout").getBoundingClientRect().left`);
  assert.ok(Math.abs((await leftWidth()) - (edge.x - 60 - layoutLeft)) < 2, "dragging the edge resizes the pane to the pointer");
  await page.eval(`document.querySelector("#left .pane-edge").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  assert.ok(Math.abs((await leftWidth()) - fitted) < 2, "a double-click fits the content again");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 300, deviceScaleFactor: 1, mobile: false });
  assert.ok(await page.eval(`(() => {
    const body = ${leftBody};
    body.scrollTop = body.scrollHeight;
    const head = document.querySelector("#left .pane-head").getBoundingClientRect().top;
    return body.scrollTop > 0 && Math.abs(head - body.getBoundingClientRect().top) < 1;
  })()`), "the pane header with the filters stays on top while the outline scrolls");
  await page.eval(`${leftBody}.scrollTop = 0`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  check("the left pane fits its content without sideways scrolling, resizes by its edge, keeps its header on top");

  assert.equal(await page.eval(`document.querySelector("#outline .title").textContent`), await page.eval(`document.querySelector("#doc h1").textContent`), "outline rebuilt on re-render");
  await page.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await page.waitFor(`document.querySelector("#outline a.current .title")?.textContent === "Risks"`, "outline marks the last section at the bottom");
  await page.eval(`[...document.querySelectorAll("#outline a")].find((a) => a.textContent.startsWith("Scope")).click()`);
  await page.waitFor(
    `(() => {
      const scopeTop = [...document.querySelectorAll("#doc h2")].find((h) => h.textContent === "Scope").getBoundingClientRect().top;
      return Math.abs(scopeTop - document.querySelector("#bar").getBoundingClientRect().bottom - 12) < 3
        && document.querySelector("#outline a.current .title")?.textContent === "Scope";
    })()`,
    "Scope scrolled under the bar and marked current",
  );
  check("clicking an outline entry brings its heading under the bar; the outline marks the section on screen");

  const pageWidth = () => page.eval(`document.querySelector("#page").getBoundingClientRect().width`);
  const withOutline = await pageWidth();
  await page.eval(`document.querySelector("#outline-toggle").click()`);
  assert.ok(await page.eval(`getComputedStyle(document.querySelector("#left")).display === "none"`));
  assert.ok((await pageWidth()) > withOutline + 200, "collapsing gives the document the pane's width");
  await page.eval(`document.querySelector("#outline-toggle").click()`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.waitFor(`getComputedStyle(document.querySelector("#left")).display === "none"`, "outline collapsed on a narrow screen");
  await page.eval(`document.querySelector("#outline-toggle").click()`);
  assert.ok(await page.eval(`(() => {
    const left = document.querySelector("#left").getBoundingClientRect(), doc = document.querySelector("#doc").getBoundingClientRect();
    return left.height > 0 && left.bottom <= doc.top;
  })()`), "opened on a narrow screen, the pane stacks above the document");
  console.log(`    screenshot ${await page.screenshot("5-narrow")}`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.waitFor(`getComputedStyle(document.querySelector("#left")).display !== "none" && __beside("#left", "#doc")`, "outline back beside the document");
  check("the outline collapses to give the document its width; narrow, it starts collapsed and stacks above the document");
  assert.deepEqual(page.errors, [], `page errors: ${page.errors.join("\n")}`);

  await openComment("Export invoices as CSV", "SLOW and interrupted");
  await tick("new");
  await clickSend();
  await page.waitFor(`${cardOf("SLOW and interrupted")}?.querySelector(".run-state.answering")`, "a run still answering at Submit");
  await sleep(800);
  const interruptedPid = fakeRuns().at(-1).pid;
  event = waitForEvent(docId);
  await sleep(300);
  await page.eval(`document.querySelector("#submit").click()`);
  const submitted = await event;
  await sleep(500);
  assert.throws(() => process.kill(interruptedPid, 0), "Submit cancels a running run");
  assert.deepEqual([submitted.kind, submitted.decision, submitted.round, submitted.fileChanged], ["submit", "apply-review", 1, false]);
  assert.deepEqual(submitted.annotations.map((a) => a.scope), ["general"]);
  await sleep(500);
  const stillOpen = await browser.isOpen(page.targetId);
  if (stillOpen) assert.ok(await page.eval(`!!document.querySelector(".ended")`), "submitted page shows the end screen");
  check(`Submit carries only the unsent rest and ends the review (${stillOpen ? "end screen" : "tab closed itself"})`);
  assert.match(cli(["push", docId, "--text", "late"]).error ?? "", /submitted/);
  if (stillOpen) await page.close();

  writeFileSync(md, readFileSync(md, "utf8").replace("> Open question: do the branches need a signed PDF, or is the portal download enough?\n\n", ""));
  const round2 = cli(["open", md, "--no-browser"]);
  assert.equal(round2.changes, 1, "round 2 diffs against what round 1's page showed");
  await fetch(`${base}/api/docs/${docId}/inbox?after=0&timeout=1`);
  assert.equal((await waitForEvent(docId, 7)).kind, "timeout");
  check("after Submit nothing more is raised; a stray inbox poller (no tab id) neither fakes a tab nor an abort");

  page = await browser.newPage(round2.url);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("rev 2")`, "round 2 render");
  await page.eval(pageHelpers);
  assert.ok(await page.eval(`document.querySelectorAll("#annotations .item").length === 0 && document.querySelector("#agent").hidden`), "round 2 starts clean");
  assert.equal(await page.eval(`__text("#submit") + "|" + document.querySelector("#apply-silent").hidden`), "Approve|true");
  const removedInConfiguration = `(() => {
    const section = [...document.querySelectorAll("#outline > li")].find((li) => li.querySelector(".title").textContent === "Configuration");
    return document.querySelectorAll("#change-marks .chg-mark.removed").length === 1
      && section?.querySelector(".change.removed .before")?.textContent.startsWith("Open question: do the branches");
  })()`;
  await page.waitFor(removedInConfiguration, "round 2 marks the removed quote, listed under the section it left");
  await page.eval(`location.reload()`);
  await sleep(500);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("rev 2")`, "reloaded");
  await page.waitFor(removedInConfiguration, "the marks last for the round, across a reload");
  assert.equal((await waitForEvent(docId, 7)).kind, "timeout");
  check("re-open after Submit = fresh round 2 with its changes marked; a reload is not an abort");

  await page.crash();
  const lost = await waitForEvent(docId, 20);
  assert.deepEqual([lost.kind, lost.reason, lost.round], ["aborted", "lost", 2]);
  page = await browser.newPage(round2.url);
  const resumed = await waitForEvent(docId, 10);
  assert.deepEqual([resumed.kind, resumed.round], ["resumed", 2]);
  check("a crashed tab is 'lost' after the long grace; the page coming back raises 'resumed'");

  await page.crash();
  await sleep(4500);
  page = await browser.newPage(round2.url);
  await page.waitFor(`document.querySelector("#doc h1")?.textContent.includes("rev 2")`, "back again");
  assert.equal((await waitForEvent(docId, 4)).kind, "timeout");
  const history = await (await fetch(`${base}/api/events?docId=${docId}`)).json();
  assert.ok(history.some((entry) => entry.state === "superseded" && entry.event.kind === "aborted"), "pending abort superseded");
  check("an abort the agent hasn't picked up yet is withdrawn when the tab returns");

  const closedAt = Date.now();
  event = waitForEvent(docId, 20);
  await page.close();
  const aborted = await event;
  assert.deepEqual([aborted.kind, aborted.reason], ["aborted", "closed"]);
  check(`closing the tab unsubmitted = aborted/closed after ${((Date.now() - closedAt) / 1000).toFixed(1)} s (page-close beacon)`);

  cli(["stop"]);
  await new Promise((stopped) => (server.exitCode !== null ? stopped() : server.once("exit", stopped)));
  writeFileSync(md, readFileSync(md, "utf8").replace("(rev 2)", "(rev 3)"));
  server = spawn(exe, ["serve"], { env, cwd: workDir });
  const afterRestart = cli(["open", md, "--no-browser"]);
  assert.equal(afterRestart.changes, 1);
  assert.equal(new URL(afterRestart.url).origin, new URL(base).origin, "the session keeps its port, so the page keeps its origin");
  check("a new server keeps the session's port and still marks what changed since the reviewer last saw the doc");

  console.log(`\n${passed} checks passed`);
} finally {
  try {
    cli(["stop"]);
  } catch {}
  browser?.kill();
  server.kill();
}
