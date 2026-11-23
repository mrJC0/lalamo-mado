// Stands in for `claude -p` in roundtrip.mjs: logs how it was started and answers by the word in its prompt.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const prompt = readFileSync(0, "utf8");
const after = (flag) => args[args.indexOf(flag) + 1];
const session = args.includes("--resume") ? after("--resume") : after("--session-id");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SESSION_MARKERS = ["CLAUDE_CODE_SESSION_ID", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({
  args,
  prompt,
  cwd: process.cwd(),
  pid: process.pid,
  at: Date.now(),
  sessionMarkers: SESSION_MARKERS.filter((name) => name in process.env),
  bundledSkillsOff: process.env.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS === "1",
})}\n`);

const answer = (structured) => console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: structured.answer, session_id: session, total_cost_usd: 0.01, structured_output: structured }));

if (prompt.includes("SLOW")) await sleep(60000);
if (prompt.includes("TAKEATURN")) await sleep(1500);

if (prompt.includes("BROKEN")) {
  console.log(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["It broke."], session_id: session }));
} else if (prompt.includes("PLAINTEXT")) {
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "No structure here.", session_id: session }));
} else if (prompt.includes("REWRITE")) {
  answer({ answer: "A rewrite, if you want it.", edit: "Better wording." });
} else if (prompt.includes("EDITDOC")) {
  const document = /^Document: (.*)$/m.exec(prompt)[1].trim();
  appendFileSync(document, "\n\nA paragraph the run added.\n");
  answer({ answer: "Edited the document.", changed: ["demo.md"] });
} else if (prompt.includes("EDITPROTECTED")) {
  answer({ answer: "Edited a protected file.", edits: [{ file: "protected.md", old: "", new: `fresh ${existsSync("protected.md")}` }] });
} else if (prompt.includes("EDITBAD")) {
  answer({ answer: "Tried to edit.", changed: ["src.txt"], edits: [{ file: "protected.md", old: "not in there", new: "x" }] });
} else {
  answer({ answer: `Answered: ${prompt.trim().split("\n").filter((line) => line.startsWith("Comment: ")).at(-1)?.slice(9) ?? prompt.trim()}` });
}
