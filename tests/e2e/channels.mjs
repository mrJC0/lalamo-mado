// The released and the dev build in one Claude Code session (plan 19): two servers, two ports, two browser windows,
// your own files apart, and neither one's commands reach the other. A fake browser records each launch instead of opening one.
// usage: node tests/e2e/channels.mjs <release edit-md> <dev edit-md>
//   e.g. src/LalamoMado/bin/Debug/net10.0/edit-md and ~/.claude/bin/edit-md-dev/edit-md (scripts/deploy-dev.ps1)
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

const release = resolve(process.argv[2] ?? "src/LalamoMado/bin/Debug/net10.0/edit-md");
const dev = process.argv[3] ? resolve(process.argv[3]) : null;
if (!dev) throw new Error("usage: node tests/e2e/channels.mjs <release edit-md> <dev edit-md>");

const workDir = mkdtempSync(join(tmpdir(), "edit-md-channels-"));
mkdirSync(join(workDir, ".git"));
const claudeHome = join(workDir, "claude-home");
const browserLog = join(workDir, "browser.log");
writeFileSync(browserLog, "");
const fakeBrowser = join(workDir, process.platform === "win32" ? "browser.cmd" : "browser");
writeFileSync(join(workDir, "browser.mjs"), `import { appendFileSync } from "node:fs";\nappendFileSync(process.env.FAKE_BROWSER_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
writeFileSync(fakeBrowser, process.platform === "win32" ? `@node "${join(workDir, "browser.mjs")}" %*\r\n` : `#!/bin/sh\nexec node "${join(workDir, "browser.mjs")}" "$@"\n`, { mode: 0o755 });

const session = `edit-md-e2e-channels-${process.pid}`;
const env = { ...process.env, CLAUDE_CODE_SESSION_ID: session, CLAUDE_CONFIG_DIR: claudeHome, EDIT_MD_BROWSER: fakeBrowser, FAKE_BROWSER_LOG: browserLog };
for (const name of ["EDIT_MD_HOME", "EDIT_MD_PREFS", "EDIT_MD_USER_LABELS", "EDIT_MD_USER_BUTTONS", "EDIT_MD_PROFILE_ROOT", "EDIT_MD_PROFILE_DIR"]) delete env[name];
const stateDirs = [join(tmpdir(), "edit-md", session), join(tmpdir(), "edit-md-dev", session)];
const profileDirs = [release, dev].map((exe) => join(dirname(exe), "profiles", session));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cli(exe, args) {
  try {
    return JSON.parse(execFileSync(exe, args, { env, encoding: "utf8" }).trim().split("\n").pop());
  } catch (failure) {
    if (failure.stdout) return JSON.parse(failure.stdout.trim().split("\n").pop());
    throw failure;
  }
}

async function until(probe, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const portOf = (url) => Number(new URL(url).port);
const launches = () => readFileSync(browserLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const argument = (launch, name) => launch.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function writeDoc(name) {
  const path = join(workDir, `${name}.md`);
  writeFileSync(path, `# ${name}\n\nChannels test document ${name}.\n`);
  return path;
}

const servers = [];
try {
  mkdirSync(join(claudeHome, "edit-md"), { recursive: true });
  writeFileSync(join(claudeHome, "edit-md", "comment_labels.json"), JSON.stringify({ labels: [{ id: "released-only", icon: "R", name: "Released only" }] }));

  servers.push(spawn(release, ["serve"], { env, cwd: workDir, stdio: "ignore" }));
  const releaseServer = await until(() => cli(release, ["status"]).url && cli(release, ["status"]), "the release server");
  servers.push(spawn(dev, ["serve"], { env, cwd: workDir, stdio: "ignore" }));
  const devServer = await until(() => cli(dev, ["status"]).url && cli(dev, ["status"]), "the dev server");

  assert.equal(releaseServer.channel, "release");
  assert.equal(devServer.channel, "dev");
  assert.notEqual(releaseServer.pid, devServer.pid, "the dev build's serve started its own server, not reused the release's");
  assert.ok(portOf(releaseServer.url) >= 41000 && portOf(releaseServer.url) <= 41999, `release port ${releaseServer.url}`);
  assert.ok(portOf(devServer.url) >= 42000 && portOf(devServer.url) <= 42999, `dev port ${devServer.url}`);
  for (const dir of stateDirs) assert.ok(existsSync(join(dir, "server.json")), `state in ${dir}`);
  console.log(`ok - one session, two servers: release ${releaseServer.url}, dev ${devServer.url}`);

  const releaseDoc = cli(release, ["open", writeDoc("released")]);
  const devDoc = cli(dev, ["open", writeDoc("developed")]);
  assert.equal(releaseDoc.newWindow, true);
  assert.equal(devDoc.newWindow, true);
  const [first, second] = await until(() => launches().length >= 2 && launches(), "two browser launches");
  assert.notEqual(argument(first, "user-data-dir"), argument(second, "user-data-dir"), "each build launches its own profile");
  assert.ok(first.includes("--new-window") && second.includes("--new-window"), "each build opens a window of its own");
  assert.deepEqual(new Set([first, second].map((launch) => portOf(launch.at(-1)))), new Set([portOf(releaseServer.url), portOf(devServer.url)]));
  console.log("ok - each build opens its doc in a window of its own profile");

  assert.deepEqual(cli(release, ["status"]).docs.map((d) => d.path), [releaseDoc.path], "the release server holds only its own doc");
  assert.deepEqual(cli(dev, ["status"]).docs.map((d) => d.path), [devDoc.path], "the dev server holds only its own doc");
  console.log("ok - no cross-talk: each CLI reaches only its own server");

  assert.ok(JSON.stringify(cli(release, ["labels", releaseDoc.docId])).includes("released-only"), "the release reads ~/.claude/edit-md");
  assert.ok(!JSON.stringify(cli(dev, ["labels", devDoc.docId])).includes("released-only"), "the dev build never reads ~/.claude/edit-md");
  assert.ok(existsSync(join(claudeHome, "edit-md", "client")) && existsSync(join(claudeHome, "edit-md-dev", "client")), "an overlay folder per build");
  console.log("ok - your own files apart: labels and page overlay");

  assert.equal(cli(release, ["stop"]).status, "stopped");
  await until(() => cli(release, ["status"]).error, "the release server to stop");
  assert.equal(cli(dev, ["status"]).channel, "dev", "stopping the release leaves the dev server running");
  assert.equal(cli(dev, ["stop"]).status, "stopped");
  console.log("ok - stopping one leaves the other");
} finally {
  for (const server of servers) server.kill();
  await sleep(500);
  for (const dir of [...stateDirs, ...profileDirs, workDir]) rmSync(dir, { recursive: true, force: true });
}
