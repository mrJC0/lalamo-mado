// Plan 10's gates against the real `claude`, on a cheap model and in throwaway repos: what a separate run may load, read and write.
// It costs a little and needs the network, so it stays out of roundtrip.mjs.
// usage: node tests/e2e/runs-real.mjs <edit-md executable> [model]
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

const exe = resolve(process.argv[2] ?? "src/LalamoMado/bin/Debug/net10.0/edit-md");
const model = process.argv[3] ?? "haiku";
// The temp folder as the OS hands it out, 8.3 form on some PCs, is how the scratchpad case opens its document; everything else uses the long form.
const tempForm = mkdtempSync(join(tmpdir(), "edit-md-runs-"));
const workDir = realpathSync.native(tempForm);
const repo = join(workDir, "repo");
const other = join(workDir, "other");
const scratch = join(workDir, "scratch");
const env = { ...process.env, CLAUDE_CODE_SESSION_ID: "edit-md-e2e-runs", EDIT_MD_HOME: join(workDir, "state"), EDIT_MD_PREFS: join(workDir, "prefs.json"), EDIT_MD_USER_LABELS: join(workDir, "labels.json"), EDIT_MD_USER_BUTTONS: join(workDir, "buttons.json") };

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const skill = (name, reply) => `---\nname: ${name}\ndescription: A probe.\n---\nReply with exactly ${reply} in the answer, and nothing else.\n`;
const git = (folder, ...args) => execFileSync("git", ["-C", folder, ...args], { stdio: "ignore" });

write(join(repo, "CLAUDE.md"), "The magic word in this repo is WOMBAT.\n");
write(join(repo, ".claude/skills/probe-root/SKILL.md"), skill("probe-root", "ROOT-SKILL-RAN"));
write(join(repo, "sub/.claude/skills/probe-nested/SKILL.md"), skill("probe-nested", "NESTED-SKILL-RAN"));
write(join(repo, "sub/doc.md"), "# Plan\n\nThe nightly export runs on the replica.\n");
write(join(repo, "src/a.txt"), "alpha\n");
write(join(repo, ".claude/project-plans/plan.md"), "gamma\n");
write(join(workDir, "outside.txt"), "delta\n");
git(repo, "init", "-q");
git(repo, "add", "-A");
git(repo, "-c", "user.name=probe", "-c", "user.email=probe@example.com", "commit", "-q", "-m", "first commit subject");
write(join(other, "CLAUDE.md"), "The magic word in this repo is NARWHAL.\n");
write(join(other, "doc.md"), "# Other\n\nA document in another repo.\n");
write(join(other, ".claude/settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `node -e "require('fs').writeFileSync('hook-fired.txt','1')"` }] }] } }));
git(other, "init", "-q");
write(join(scratch, "questions.md"), "# Questions\n\nThe scratch word is PANGOLIN.\n");

const lastJsonLine = (out) => JSON.parse(out.trim().split("\n").pop());
const cli = (...args) => lastJsonLine(execFileSync(exe, args, { env, encoding: "utf8" }));

let server;
let base;
let nextId = 1;
const cursors = new Map();

async function ask(docId, text, agent) {
  const id = `a${nextId++}`;
  const response = await fetch(`${base}/api/docs/${docId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "send", mode: "reply", agent: { model, ...agent }, annotations: [{ id, label: "question", text, scope: "general" }] }),
  });
  assert.ok(response.ok, `the server refused: ${response.status}`);
  assert.equal((await response.json()).delegated, true, "a separate run answers");
  return { id, ...(await answerTo(docId, id)) };
}

async function followUp(docId, thread, text) {
  const id = `a${nextId++}`;
  await fetch(`${base}/api/docs/${docId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "send", mode: "reply", annotations: [{ id, replyTo: thread, text, scope: "general" }] }),
  });
  return answerTo(docId, thread);
}

async function answerTo(docId, thread) {
  const until = Date.now() + 180000;
  let reply = null;
  while (Date.now() < until) {
    const after = cursors.get(docId) ?? 0;
    const response = await fetch(`${base}/api/docs/${docId}/inbox?after=${after}&timeout=5`);
    if (response.status !== 200) continue;
    const messages = await response.json();
    cursors.set(docId, messages.at(-1).seq);
    for (const message of messages.filter((candidate) => candidate.annotationId === thread)) {
      if (message.kind === "reply") reply = message;
      if (message.runState === "failed") throw new Error(`run failed: ${message.error}`);
      if (message.runState === "done") return { text: reply.html.replace(/<[^>]+>/g, "").trim(), reply };
    }
  }
  throw new Error(`no answer to ${thread}`);
}

let passed = 0;
const check = (name) => {
  passed++;
  console.log(`  ✓ ${name}`);
};

let exitCode = 0;
try {
  server = spawn(exe, ["serve"], { env, cwd: repo, stdio: "ignore" });
  const opened = cli("open", join(repo, "sub/doc.md"), "--no-browser");
  base = opened.url.replace(/\/d\/.*$/, "");
  const inRepo = opened.docId;

  const MAGIC_WORD_QUESTION = "What is the magic word in this repo, according to your instructions? Answer with the word only, or NONE if you were given none. Do not search for it.";
  const blank = await ask(inRepo, MAGIC_WORD_QUESTION, {});
  assert.match(blank.text, /NONE/, `a blank run names no rules: ${blank.text}`);
  check("a blank run was given no rules");
  const withRepo = await ask(inRepo, MAGIC_WORD_QUESTION, { repo: true });
  assert.match(withRepo.text, /WOMBAT/, `a repo run names the repo's: ${withRepo.text}`);
  check("a repo run was given the repo's, from a document in a subfolder");
  const remembered = await ask(inRepo, "Remember the number 4711. Reply with the word NOTED only.", { repo: true });
  const recalled = await followUp(inRepo, remembered.id, "Which number did I ask you to remember? Reply with the number only.");
  assert.match(recalled.text, /4711/, `a follow-up keeps the run's context: ${recalled.text}`);
  check("a follow-up goes back to the same run, with its context");

  const rootSkill = await ask(inRepo, "/probe-root", { repo: true });
  assert.match(rootSkill.text, /ROOT-SKILL-RAN/, rootSkill.text);
  const nestedSkill = await ask(inRepo, "/probe-nested", { repo: true });
  assert.match(nestedSkill.text, /NESTED-SKILL-RAN/, nestedSkill.text);
  check("a /name that starts the comment fires, the repo's and the one beside the document");

  const history = await ask(inRepo, "Run `git log -1 --format=%s` with your Bash tool and reply with its output only.", {});
  assert.match(history.text, /first commit subject/, history.text);
  check("read-only git runs");
  for (const command of ["git diff --output=leaked.txt", "git log -p -1 --output=leaked.txt", "git show --output=leaked.txt HEAD", "git log -1 > leaked.txt"]) {
    await ask(inRepo, `Run exactly this with your Bash tool: ${command}\nThen say whether it ran.`, {});
    assert.equal(existsSync(join(repo, "sub/leaked.txt")) || existsSync(join(repo, "leaked.txt")), false, `${command} must not write a file`);
  }
  check("git output options and a redirect write nothing");
  await ask(inRepo, `Use your tools to change alpha to ALPHA in ${join(repo, "src/a.txt")}. Then say what happened.`, { repo: true });
  assert.equal(readFileSync(join(repo, "src/a.txt"), "utf8"), "alpha\n", "without May edit nothing changes");
  check("without May edit the run touches no file");

  const edited = await ask(inRepo, `Change alpha to ALPHA in ${join(repo, "src/a.txt")} with your Edit tool, and create ${join(repo, "src/new.txt")} containing hi with your Write tool. List both in changed.`, { repo: true, edit: true });
  assert.equal(readFileSync(join(repo, "src/a.txt"), "utf8").trim(), "ALPHA", edited.text);
  assert.equal(readFileSync(join(repo, "src/new.txt"), "utf8").trim(), "hi");
  assert.ok(edited.reply.changed?.length >= 2, `the card lists both: ${JSON.stringify(edited.reply.changed)}`);
  check("May edit: the run edits a file, creates another, and lists them");
  const protectedEdit = await ask(inRepo, `In ${join(repo, ".claude/project-plans/plan.md")} change gamma to GAMMA. That file is under .claude/, so return it in edits with file ".claude/project-plans/plan.md", old "gamma", new "GAMMA".`, { repo: true, edit: true });
  assert.equal(readFileSync(join(repo, ".claude/project-plans/plan.md"), "utf8").trim(), "GAMMA", protectedEdit.text);
  check("May edit: a plan under .claude/ changes through the server's edits");
  await ask(inRepo, `Change delta to DELTA in ${join(workDir, "outside.txt")} with your Edit tool. Then say what happened.`, { repo: true, edit: true });
  assert.equal(readFileSync(join(workDir, "outside.txt"), "utf8"), "delta\n", "a file outside the repo stays untouched");
  check("May edit: a file outside the repo stays untouched");

  const inScratch = cli("open", join(tempForm, "scratch", "questions.md"), "--no-browser").docId;
  const fromScratch = await ask(inScratch, `${MAGIC_WORD_QUESTION} Then read the document named in this request and add the scratch word it names. Answer as: word, scratch word.`, { repo: true });
  assert.match(fromScratch.text, /WOMBAT/, fromScratch.text);
  assert.match(fromScratch.text, /PANGOLIN/, fromScratch.text);
  check("a scratchpad document's repo run loads the session's repo and reads the document, through an 8.3 temp path");

  const inOther = cli("open", join(other, "doc.md"), "--no-browser").docId;
  const fromOther = await ask(inOther, MAGIC_WORD_QUESTION, { repo: true });
  assert.match(fromOther.text, /NARWHAL/, fromOther.text);
  assert.equal(existsSync(join(other, "hook-fired.txt")), false, "another repo's hook stays silent");
  check("another repo's document: its CLAUDE.md loads, its hooks stay silent");

  console.log(`\n${passed} checks passed`);
} catch (error) {
  console.error(error.message);
  exitCode = 1;
} finally {
  try {
    cli("stop");
  } catch {}
  server?.kill();
  setTimeout(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
    process.exit(exitCode);
  }, 800);
}
