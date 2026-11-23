// Local dictation (plan 09): Whisper in the edit-md server, on this PC, as the other engine beside Chrome's.
// Research, kept removable: this file, its hooks in mic.js and the server's LocalDictation are all of it.

import { docId } from "./api.js";
import { preference, savePreference } from "./prefs.js";

const RATE = 16000;
const FRAME = RATE / 10;
const PRE_ROLL_FRAMES = 3;
const PAUSE_FRAMES = 7;
const MAX_FRAMES = 250;
const MIN_SPEECH_FRAMES = 2;
const MICROPHONE_BLOCKED = "Dictation needs the microphone: allow it for this page (the icon at the right of the address bar).";

// Hands the microphone's samples to the page in 100 ms frames.
const TAP = URL.createObjectURL(new Blob([`
registerProcessor("tap", class extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Float32Array(${FRAME}); this.filled = 0; }
  process([input]) {
    for (const sample of input[0] ?? []) {
      this.frame[this.filled++] = sample;
      if (this.filled === this.frame.length) { this.port.postMessage(this.frame); this.frame = new Float32Array(${FRAME}); this.filled = 0; }
    }
    return true;
  }
});`], { type: "text/javascript" }));

let status = { local: false, models: [] };
const statusListeners = new Set();

/** Asks the server once whether it can run Whisper; until it answers, only Chrome is offered. */
export async function loadLocalStatus() {
  try {
    const response = await fetch("/api/dictation");
    if (response.ok) updateStatus(await response.json());
  } catch {}
  return status.local;
}

export const localAvailable = () => status.local;
export const engine = () => (status.local && preference("dictation.engine", "chrome") === "local" ? "local" : "chrome");
export const chooseEngine = (next) => savePreference("pc", "dictation.engine", next);
export const onLocalStatus = (listener) => statusListeners.add(listener);

/** For ⚙: where Local runs, once a model has loaded. */
export const localNote = () =>
  status.runtime === "cuda12" ? "Local runs on the GPU." : status.runtime ? "Local runs on the CPU: slow without an NVIDIA GPU." : "Local loads its model when you first dictate.";

function chosenModel() {
  const present = status.models.filter((model) => model.present);
  return (present.find((model) => model.id === preference("dictation.model", "turbo")) ?? present[0])?.id;
}

/**
 * Records until stopped and cuts at each pause; the pieces are transcribed one after another, in order.
 * `onPiece` fires when a piece goes to the server, `onText` with its text, `onEnd` once a stop has delivered the last one.
 */
export function listenLocally({ language, onPiece, onText, onProblem, onEnd }) {
  const model = chosenModel();
  let stopping = false;
  let aborted = false;
  let ended = false;
  let pending = 0;
  let queue = Promise.resolve();

  fetch(`/api/dictation/load?model=${model}`, { method: "POST" })
    .then((response) => (response.ok ? response.json() : null))
    .then((loaded) => loaded && updateStatus(loaded))
    .catch(() => {});

  const recorder = recordPieces({
    onCut: (samples) => {
      pending++;
      onPiece();
      queue = queue
        .then(() => transcribe(samples, model, language))
        .then(
          (text) => !aborted && onText(text),
          (error) => !aborted && onProblem(error.message),
        )
        .then(() => {
          pending--;
          finishIfDone();
        });
    },
    onProblem: (message) => !aborted && onProblem(message),
  });

  function finishIfDone() {
    if (!stopping || pending > 0 || ended) return;
    ended = true;
    if (!aborted) onEnd();
  }

  return {
    /** The reviewer stopped: what was said last is still cut, transcribed and kept. */
    stop() {
      recorder.stop();
      stopping = true;
      finishIfDone();
    },
    /** The box closed: nothing more lands in it. */
    abort() {
      aborted = true;
      stopping = true;
      recorder.abort();
    },
  };
}

export const fixWithLocal = () => status.local && preference("dictation.fixWithLocal", false);

/** While Chrome dictates, ⚙ "Fix with Local's transcript too" keeps the same pieces in `take`, untranscribed until ✨ asks. */
export const keepTake = (take, language, onProblem) => recordPieces({ onCut: (samples) => take.push({ samples, language }), onProblem });

/** Local's transcript of a kept take, each piece transcribed once, however often ✨ asks. */
export async function transcribeTake(take) {
  const model = chosenModel();
  const texts = await Promise.all(
    take.map((piece) =>
      (piece.transcription ??= transcribe(piece.samples, model, piece.language).catch((error) => {
        piece.transcription = undefined;
        throw error;
      })),
    ),
  );
  return texts.map((text) => text.trim()).filter(Boolean).join(" ");
}

/** Cuts the microphone's sound at each pause; `onCut` gets every piece that held speech, the last one on `stop()` but not on `abort()`. */
function recordPieces({ onCut, onProblem }) {
  let stream = null;
  let context = null;
  let stopped = false;
  let preRoll = [];
  let frames = [];
  let speaking = false;
  let speechFrames = 0;
  let quietFrames = 0;
  let noiseFloor = 0.005;

  function onFrame(frame) {
    if (stopped) return;
    const loudness = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
    const loud = loudness > Math.max(0.012, noiseFloor * 3);
    if (!speaking) {
      if (!loud) {
        noiseFloor = noiseFloor * 0.95 + loudness * 0.05;
        preRoll = [...preRoll, frame].slice(-PRE_ROLL_FRAMES);
        return;
      }
      speaking = true;
      frames = [...preRoll, frame];
      speechFrames = 1;
      quietFrames = 0;
      return;
    }
    frames.push(frame);
    if (loud) {
      speechFrames++;
      quietFrames = 0;
    } else quietFrames++;
    if (quietFrames >= PAUSE_FRAMES || frames.length >= MAX_FRAMES) cut();
  }

  function cut() {
    const piece = frames;
    const spoke = speechFrames >= MIN_SPEECH_FRAMES;
    frames = [];
    preRoll = [];
    speaking = false;
    speechFrames = 0;
    quietFrames = 0;
    if (!spoke) return;
    const samples = new Float32Array(piece.length * FRAME);
    piece.forEach((frame, index) => samples.set(frame, index * FRAME));
    onCut(samples);
  }

  function release() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    context?.close();
  }

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (stopped) return release();
      context = new AudioContext({ sampleRate: RATE });
      await context.audioWorklet.addModule(TAP);
      const tap = new AudioWorkletNode(context, "tap");
      tap.port.onmessage = (event) => onFrame(event.data);
      const muted = context.createGain();
      muted.gain.value = 0;
      context.createMediaStreamSource(stream).connect(tap).connect(muted).connect(context.destination);
    } catch (error) {
      onProblem(error.name === "NotAllowedError" ? MICROPHONE_BLOCKED : `Local dictation cannot record: ${error.message}`);
    }
  })();

  return {
    stop() {
      if (speaking && !stopped) cut();
      stopped = true;
      release();
    },
    abort() {
      stopped = true;
      release();
    },
  };
}

async function transcribe(samples, model, language) {
  const response = await fetch(`/api/transcribe?model=${model}&language=${language}&docId=${encodeURIComponent(docId)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: samples,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Local dictation failed: ${body.detail ?? body.error ?? response.status}`);
  if (body.runtime && body.runtime !== status.runtime) updateStatus({ ...status, runtime: body.runtime });
  return body.text ?? "";
}

function updateStatus(next) {
  status = next;
  for (const listener of statusListeners) listener();
}
