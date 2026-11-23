// Real, headed Chromium launched by edit-md itself (windows flash briefly):
// one dedicated profile per session — its docs share one window, a parallel session never steals them, Submit closes the tab.
// usage: node tests/e2e/grouping.mjs <edit-md executable>
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const exe = resolve(process.argv[2] ?? "src/LalamoMado/bin/Debug/net10.0/edit-md");
const workDir = mkdtempSync(join(tmpdir(), "edit-md-grouping-"));
const profiles = join(workDir, "profiles");
const sharedEnv = {
  ...process.env,
  EDIT_MD_PROFILE_ROOT: profiles,
  EDIT_MD_PREFS: join(workDir, "prefs.json"),
  EDIT_MD_USER_LABELS: join(workDir, "comment_labels.json"),
  EDIT_MD_BROWSER_ARGS: "--remote-debugging-port=0 --window-size=900,650 --window-position=60,60",
};
delete sharedEnv.EDIT_MD_PROFILE_DIR;
const sessionEnv = (name) => ({ ...sharedEnv, EDIT_MD_HOME: join(workDir, name), CLAUDE_CODE_SESSION_ID: `session-${name}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeDoc(name) {
  const path = join(workDir, `${name}.md`);
  writeFileSync(path, `# ${name}\n\nGrouping test document ${name}.\n`);
  return path;
}

function cli(env, args) {
  try {
    return JSON.parse(execFileSync(exe, args, { env, encoding: "utf8" }).trim().split("\n").pop());
  } catch (failure) {
    if (failure.stdout) return JSON.parse(failure.stdout.trim().split("\n").pop());
    throw failure;
  }
}

async function until(probe, what, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

class Cdp {
  #lastId = 0;
  #pending = new Map();

  static async connect(url) {
    const cdp = new Cdp();
    cdp.ws = new WebSocket(url);
    await new Promise((r) => cdp.ws.addEventListener("open", r, { once: true }));
    cdp.ws.addEventListener("message", (m) => {
      const message = JSON.parse(m.data);
      if (message.id && cdp.#pending.has(message.id)) {
        cdp.#pending.get(message.id)(message);
        cdp.#pending.delete(message.id);
      }
    });
    return cdp;
  }

  async send(method, params = {}, sessionId) {
    const id = ++this.#lastId;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    const reply = await new Promise((r) => this.#pending.set(id, r));
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result;
  }

  async pagesUnder(base) {
    const { targetInfos } = await this.send("Target.getTargets");
    return targetInfos.filter((t) => t.type === "page" && t.url.startsWith(base));
  }

  async windowOf(targetId) {
    return (await this.send("Browser.getWindowForTarget", { targetId })).windowId;
  }
}

const connectedDocs = (env) => (cli(env, ["status"]).docs ?? []).filter((d) => d.browserConnected).length;

let passed = 0;
const check = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

const s1 = sessionEnv("s1");
const s2 = sessionEnv("s2");
mkdirSync(profiles, { recursive: true });
const servers = [spawn(exe, ["serve"], { env: s1 }), spawn(exe, ["serve"], { env: s2 })];
const browsers = [];

async function browserOf(session) {
  const activePort = join(profiles, `session-${session}`, "DevToolsActivePort");
  await until(() => existsSync(activePort), `session ${session}'s profile DevToolsActivePort`);
  const [port, browserPath] = readFileSync(activePort, "utf8").trim().split(/\r?\n/);
  const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${browserPath}`);
  browsers.push(cdp);
  return cdp;
}

async function tabsOf(cdp, base, count, what) {
  return until(async () => {
    const tabs = await cdp.pagesUnder(base);
    return tabs.length === count && tabs;
  }, what);
}

try {
  const [a, b, c, d, e] = ["alpha", "beta", "gamma", "delta", "epsilon"].map(writeDoc);

  const openedA = cli(s1, ["open", a]);
  assert.notEqual(openedA.browser, "default", "a Chromium browser was found");
  assert.equal(openedA.newWindow, true);
  const base1 = openedA.url.replace(/\/d\/.*$/, "");
  const cdp1 = await browserOf("s1");
  await until(() => connectedDocs(s1) === 1, "alpha's tab to connect");
  const [firstTab] = await cdp1.pagesUnder(base1);
  const { sessionId: firstTabSession } = await cdp1.send("Target.attachToTarget", { targetId: firstTab.targetId, flatten: true });
  const microphone = await cdp1.send("Runtime.evaluate", { expression: "navigator.permissions.query({ name: 'microphone' }).then((s) => s.state)", awaitPromise: true, returnByValue: true }, firstTabSession);
  assert.equal(microphone.result.value, "granted", "the dedicated profile has the microphone pre-allowed for the review page");
  check(`first doc opens a new window of session 1's own ${openedA.browser} profile, the microphone already allowed`);

  const openedB = cli(s1, ["open", b]);
  assert.equal(openedB.newWindow, false);
  const session1Tabs = await tabsOf(cdp1, base1, 2, "beta's tab");
  const session1Windows = new Set(await Promise.all(session1Tabs.map((t) => cdp1.windowOf(t.targetId))));
  assert.equal(session1Windows.size, 1, "both docs of session 1 share one window");
  await until(() => connectedDocs(s1) === 2, "beta's tab to connect");
  check("the session's second doc becomes a tab in that same window");

  const openedC = cli(s2, ["open", c]);
  const openedE = cli(s2, ["open", e]);
  assert.deepEqual([openedC.newWindow, openedE.newWindow], [true, false], "a second open right after the first does not start another window");
  const base2 = openedC.url.replace(/\/d\/.*$/, "");
  const cdp2 = await browserOf("s2");
  const session2Tabs = await tabsOf(cdp2, base2, 2, "gamma's and epsilon's tabs");
  assert.equal(new Set(await Promise.all(session2Tabs.map((t) => cdp2.windowOf(t.targetId)))).size, 1, "both quick opens share one window");
  assert.equal((await cdp1.pagesUnder(base2)).length, 0, "session 2's docs are not in session 1's browser");
  check("a parallel session gets a separate browser profile and window; two quick opens share it");

  const openedD = cli(s1, ["open", d]);
  assert.equal(openedD.newWindow, false);
  const session1TabsNow = await tabsOf(cdp1, base1, 3, "delta's tab in session 1");
  assert.equal(new Set(await Promise.all(session1TabsNow.map((t) => cdp1.windowOf(t.targetId)))).size, 1);
  assert.equal((await cdp2.pagesUnder(base1)).length, 0, "session 2's window got none of session 1's docs");
  check("after session 2 opened, session 1's next doc still lands in session 1's window");

  const alphaTab = session1Tabs.find((t) => t.url.includes("/d/d1/"));
  const { sessionId } = await cdp1.send("Target.attachToTarget", { targetId: alphaTab.targetId, flatten: true });
  await until(async () => {
    const { result } = await cdp1.send("Runtime.evaluate", { expression: `document.querySelector("#submit")?.textContent`, returnByValue: true }, sessionId);
    return result.value === "Approve";
  }, "alpha's page to be ready");
  const submitted = new Promise((r) => {
    const child = spawn(exe, ["wait", "d1", "--timeout", "15"], { env: s1 });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("exit", () => r(JSON.parse(out.trim())));
  });
  await sleep(300);
  await cdp1.send("Runtime.evaluate", { expression: `document.querySelector("#submit").click()` }, sessionId);
  const event = await submitted;
  assert.deepEqual([event.kind, event.decision], ["submit", "approve"]);
  await until(async () => !(await cdp1.pagesUnder(base1)).some((t) => t.targetId === alphaTab.targetId), "alpha's tab to close itself", 5000);
  assert.equal((await cdp1.pagesUnder(base1)).length, 2, "beta and delta stay open in the session window");
  check("Submit closes its own tab in headed Chrome; the rest of the session window stays");

  console.log(`\n${passed} checks passed`);
} finally {
  for (const cdp of browsers) {
    try {
      await cdp.send("Browser.close");
    } catch {}
  }
  for (const env of [s1, s2]) {
    try {
      cli(env, ["stop"]);
    } catch {}
  }
  servers.forEach((server) => server.kill());
}
