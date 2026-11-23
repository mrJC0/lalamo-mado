// Chrome's real recognizer on synthesized speech, with no microphone: a WAV decoded in the page goes in as recognition.start(audioTrack).
// It needs the network and a Windows voice, so it stays out of roundtrip.mjs. It shows what the agent's `maybe` is made of.
// usage: node tests/e2e/recognizer.mjs [chrome executable]
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const chrome = process.argv[2] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const workDir = mkdtempSync(join(tmpdir(), "edit-md-recognizer-"));
const PHRASES = [
  { voice: "Microsoft Zira Desktop", culture: "en-US", lang: "en-US", text: "the seek results should stay in the pane", file: "en.wav" },
  { voice: "Microsoft Jakub", culture: "cs-CZ", lang: "cs-CZ", text: "označ ten mark a pošli seek do plánu", file: "cs-mixed.wav" },
];

function synthesize({ voice, culture, text, file }) {
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('${voice}')
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('${join(workDir, file)}', $format)
$p = New-Object System.Speech.Synthesis.PromptBuilder([Globalization.CultureInfo]'${culture}')
$p.AppendBreak([TimeSpan]::FromSeconds(1))
$p.AppendText('${text}')
$p.AppendBreak([TimeSpan]::FromSeconds(1))
$s.Speak($p)
$s.Dispose()`;
  execFileSync("pwsh", ["-NoProfile", "-Command", script], { stdio: "ignore" });
}

const PAGE = `<!doctype html><meta charset=utf-8><script>
const query = new URLSearchParams(location.search);
const report = (o) => fetch("/report", { method: "POST", body: JSON.stringify(o) });
(async () => {
  const recognition = new webkitSpeechRecognition();
  Object.assign(recognition, { lang: query.get("lang"), continuous: true, interimResults: true, maxAlternatives: 5 });
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++)
      if (event.results[i].isFinal) report({ guesses: Array.from(event.results[i], (guess) => guess.transcript.trim()) });
  };
  recognition.onerror = (event) => report({ error: event.error });
  recognition.onend = () => report({ done: true });
  const audio = new AudioContext();
  await audio.resume();
  const buffer = await audio.decodeAudioData(await (await fetch("/audio.wav")).arrayBuffer());
  const output = audio.createMediaStreamDestination();
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(output);
  recognition.start(output.stream.getAudioTracks()[0]);
  source.onended = () => setTimeout(() => recognition.stop(), 1500);
  source.start();
})().catch((error) => report({ error: String(error), done: true }));
</script>`;

function recognize({ file, lang }) {
  return new Promise((resolve, reject) => {
    const guesses = [];
    const profile = mkdtempSync(join(workDir, "chrome-"));
    let browser;
    const server = createServer((request, response) => {
      if (request.url === "/report") {
        let body = "";
        request.on("data", (chunk) => (body += chunk)).on("end", () => {
          response.end();
          const report = JSON.parse(body);
          if (report.guesses) guesses.push(report.guesses);
          if (report.error) reject(new Error(report.error));
          if (report.done) finish();
        });
      } else if (request.url === "/audio.wav") {
        response.end(readFileSync(join(workDir, file)));
      } else {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(PAGE);
      }
    });
    const timeout = setTimeout(() => reject(new Error(`no answer for ${file}`)), 60000);
    function finish() {
      clearTimeout(timeout);
      browser.kill();
      server.close();
      resolve(guesses);
    }
    server.listen(0, "127.0.0.1", () => {
      const url = `http://localhost:${server.address().port}/?lang=${lang}`;
      browser = spawn(chrome, ["--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", url], { stdio: "ignore" });
    });
  });
}

let exitCode = 0;
try {
  for (const phrase of PHRASES) {
    synthesize(phrase);
    const results = await recognize(phrase);
    console.log(`${phrase.lang}: "${phrase.text}"`);
    for (const guesses of results) for (const guess of guesses) console.log(`  ${guess}`);
    assert.ok(results.some((guesses) => guesses.length > 1), `the recognizer gave one guess only for ${phrase.file}`);
  }
  console.log("\nthe recognizer returns its other guesses");
} catch (error) {
  console.error(error.message);
  exitCode = 1;
}
setTimeout(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {}
  process.exit(exitCode);
}, 500);
