// Local dictation end to end: the real server with Whisper, and headless Chrome whose microphone plays a synthesized take.
// Then ✨ Fix with Local's transcript (plan 09 step 5): Chrome dictates while the page keeps the same take for Local.
// Then plan 09's glossary gate: a Czech take with XTbl, transcribed for a repo without a glossary and for one with it.
// It needs the opt-in install (models, and NVIDIA's DLLs for the GPU), so it stays out of roundtrip.mjs; without models it says so and passes.
// usage: node tests/e2e/local-dictation.mjs <edit-md executable> [whisper home] [chrome executable]
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const exe = resolve(process.argv[2] ?? "src/LalamoMado/bin/Debug/net10.0/edit-md");
const whisperHome = process.argv[3] ?? join(homedir(), ".claude", "bin", "edit-md", "whisper");
const chrome = process.argv[4] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SAID = "The seek results show every mark in the chapter.";
// How a Czech speaker says XTbl; Whisper alone writes "Rex Table".
const SAID_IN_CZECH = "Data čteme přes eks tejbl a výsledky ukládáme do tabulky.";

if (!existsSync(join(whisperHome, "models"))) {
  console.log(`no Whisper models in ${whisperHome}: nothing to test`);
  process.exit(0);
}

const workDir = mkdtempSync(join(tmpdir(), "edit-md-local-"));
const env = { ...process.env, CLAUDE_CONFIG_DIR: join(workDir, "claude-home"), CLAUDE_CODE_SESSION_ID: "edit-md-e2e-local", EDIT_MD_HOME: join(workDir, "state"), EDIT_MD_PREFS: join(workDir, "prefs.json"), EDIT_MD_WHISPER: whisperHome };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (args) => JSON.parse(execFileSync(exe, args, { env, encoding: "utf8" }).trim().split("\n").pop());

// The microphone's take is 48 kHz with pauses around it; the one posted straight to the server is already 16 kHz, as the page sends it.
function synthesize(file, { voice = "Microsoft David Desktop", culture = "en-US", text = SAID, rate = 48000, pauses = true } = {}) {
  const pause = (seconds) => (pauses ? `$p.AppendBreak([TimeSpan]::FromSeconds(${seconds}))` : "");
  execFileSync("pwsh", ["-NoProfile", "-Command", `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('${voice}')
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${rate}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('${file}', $format)
$p = New-Object System.Speech.Synthesis.PromptBuilder([Globalization.CultureInfo]'${culture}')
${pause(2)}
$p.AppendText('${text}')
${pause(3)}
$s.Speak($p)
$s.Dispose()`], { stdio: "ignore" });
}

function samplesOf(wavFile) {
  const wav = readFileSync(wavFile);
  let at = 12;
  while (wav.toString("ascii", at, at + 4) !== "data") at += 8 + wav.readUInt32LE(at + 4);
  const pcm = wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
  return Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
}

function noteInRepo(name, glossary) {
  const repo = join(workDir, name);
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, "note.md"), "# Notes\n\nSeek results and marks live in the left pane.\n");
  if (glossary) {
    mkdirSync(join(repo, ".claude", "edit-md"), { recursive: true });
    writeFileSync(join(repo, ".claude", "edit-md", "glossary.json"), JSON.stringify(glossary));
  }
  return join(repo, "note.md");
}

async function openPage(port, url) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let lastId = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => {
    const message = JSON.parse(m.data);
    pending.get(message.id)?.(message);
  });
  const evaluate = (expression) => {
    const id = ++lastId;
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    return new Promise((r) => pending.set(id, (message) => r(message.result?.result?.value)));
  };
  return {
    eval: evaluate,
    async waitFor(expression, what, timeoutMs = 20000) {
      for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(200)) if (await evaluate(expression)) return;
      throw new Error(`Timed out waiting for ${what}`);
    },
  };
}

const take = join(workDir, "take.wav");
synthesize(take);
const czechTake = join(workDir, "czech.wav");
synthesize(czechTake, { voice: "Microsoft Jakub", culture: "cs-CZ", text: SAID_IN_CZECH, rate: 16000, pauses: false });
const glossedNote = noteInRepo("glossed", { terms: ["XTbl", "seek", "mark"], mishearings: { "every mark": "each mark" } });
const plainNote = noteInRepo("plain");
const server = spawn(exe, ["serve"], { env, cwd: workDir });
const port = 9800 + Math.floor(Math.random() * 100);
let browser;
let exitCode = 0;
try {
  const { docId, url } = cli(["open", glossedNote, "--no-browser"]);
  browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(workDir, "chrome")}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${take}%noloop`, "about:blank"]);
  for (let i = 0; ; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      break;
    } catch {
      if (i > 50) throw new Error("Chrome did not start");
      await sleep(200);
    }
  }
  const page = await openPage(port, url);
  await page.waitFor(`document.querySelector("#doc h1")`, "the document");
  await page.eval(`document.querySelector("#general").click()`);
  await page.waitFor(`!document.querySelector("#popover .mic-engine").hidden`, "the engine badge, once the server says Local is there");
  assert.equal(await page.eval(`document.querySelector("#popover .mic-engine").textContent`), "Chrome", "Chrome stays the engine until the reviewer switches");
  await page.eval(`document.querySelector("#popover .mic-engine").click()`);
  assert.equal(await page.eval(`document.querySelector("#popover .mic-engine").textContent`), "Local", "a click switches to Local");
  assert.equal(await page.eval(`document.querySelector('#settings [data-setting="dictation.engine"]').value`), "local", "⚙ follows the badge");
  await page.eval(`document.querySelector("#popover .mic-language").textContent === "CZ" && document.querySelector("#popover .mic-language").click()`);
  await page.eval(`document.querySelector("#popover .mic").click()`);
  await page.waitFor(`/seek/i.test(document.querySelector("#popover textarea").value) && !document.querySelector("#popover textarea").value.includes("…")`, "the take, transcribed at the caret", 60000);
  await page.eval(`document.querySelector("#popover .mic").click()`);
  const text = await page.eval(`document.querySelector("#popover textarea").value`);
  console.log(`  heard: ${text}`);
  assert.match(text, /seek results show each mark in the chapter/i, "Whisper heard the take, and the page corrected a known mishearing in Local's words");
  const note = await page.eval(`document.querySelector("#settings .setting-note").textContent`);
  console.log(`  ⚙: ${note}`);
  if (existsSync(join(whisperHome, "cuda12"))) assert.match(note, /GPU/, "with NVIDIA's DLLs installed it runs on the GPU");

  const nextEvent = () =>
    new Promise((resolveEvent) => {
      const wait = spawn(exe, ["wait", docId, "--timeout", "60"], { env });
      let out = "";
      wait.stdout.on("data", (chunk) => (out += chunk));
      wait.on("exit", () => resolveEvent(JSON.parse(out.trim())));
    });
  const event = nextEvent();
  await sleep(300);
  await page.eval(`document.querySelector('#popover [data-act="send"]').click()`);
  const sent = (await event).annotations[0];
  assert.equal(sent.dictated, true, "a comment dictated with Local reaches the agent marked as spoken");
  assert.equal(sent.spoken, undefined, "all of it spoken, so no parts listed");
  assert.deepEqual(sent.maybe, { each: ["every"] }, "what Whisper wrote before the correction reaches the agent as maybe");

  // Chrome is faked, as it needs its speech service; the microphone the page opens for Local plays the take again from its start.
  await page.eval(`(() => {
    window.__recordings = 0;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => (window.__recordings++, getUserMedia(constraints));
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      constructor() { window.__chrome = this; }
      start() {}
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    };
  })()`);
  const fixDictatedWithChrome = async (listenMs) => {
    await page.eval(`document.querySelector("#general").click()`);
    if ((await page.eval(`document.querySelector("#popover .mic-engine").textContent`)) === "Local") await page.eval(`document.querySelector("#popover .mic-engine").click()`);
    await page.eval(`document.querySelector("#popover .mic").click()`);
    await sleep(listenMs);
    await page.eval(`__chrome.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "the secret results show every mark in the chapter." }], { isFinal: true })] })`);
    await page.eval(`document.querySelector("#popover .mic").click()`);
    const fix = nextEvent();
    await sleep(300);
    await page.eval(`document.querySelector("#popover .fix").click()`);
    const request = (await fix).annotations[0];
    await page.eval(`document.querySelector('#popover [data-act="cancel"]').click()`);
    return request;
  };
  const chromeAlone = await fixDictatedWithChrome(300);
  assert.equal(chromeAlone.localTranscript, undefined, "with ⚙ Fix with Local's transcript off, ✨ sends Chrome's text alone");
  assert.equal(await page.eval(`__recordings`), 0, "and Chrome dictates without the page opening the microphone for Local");
  await page.eval(`document.querySelector('#settings [data-setting="dictation.fixWithLocal"]').click()`);
  const withLocal = await fixDictatedWithChrome(8000);
  console.log(`  Chrome: ${withLocal.text}
  Local:  ${withLocal.localTranscript}`);
  assert.equal(await page.eval(`__recordings`), 1, "with it on, the page keeps the take while Chrome dictates");
  assert.match(withLocal.text, /secret results/, "the comment keeps Chrome's words");
  assert.match(withLocal.localTranscript, /seek results show each mark in the chapter/i, "the fix carries Local's transcript of the same take, known mishearings corrected");
  assert.match(withLocal.maybe.secret?.join(), /^seek$/i, "where the two differ, Local's word reaches the agent as maybe");

  const base = url.replace(/\/d\/.*$/, "");
  const transcribeCzech = async (note) => {
    const { docId: id } = cli(["open", note, "--no-browser"]);
    const response = await fetch(`${base}/api/transcribe?model=turbo&language=cs&docId=${id}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: samplesOf(czechTake) });
    return (await response.json()).text;
  };
  const withoutGlossary = await transcribeCzech(plainNote);
  const withGlossary = await transcribeCzech(glossedNote);
  console.log(`  without the glossary: ${withoutGlossary}\n  with it:              ${withGlossary}`);
  assert.doesNotMatch(withoutGlossary, /XTbl/, "without the glossary Whisper spells the term by sound");
  assert.match(withGlossary, /XTbl/, "with the repo's glossary as its prompt Whisper writes the term as the reviewer does");
  console.log("\nlocal dictation works end to end");
} catch (error) {
  console.error(error.message);
  exitCode = 1;
} finally {
  browser?.kill();
  try {
    cli(["stop"]);
  } catch {}
  server.kill();
  setTimeout(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
    process.exit(exitCode);
  }, 500);
}
