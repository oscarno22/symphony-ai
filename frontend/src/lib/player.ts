import * as Tone from "tone";

import type { MusicScore, Note, NoteDuration } from "./types";

// ─── Instrument definitions ───────────────────────────────────────────────────

export type InstrumentId = "synth" | "piano" | "strings" | "bells";

export const INSTRUMENTS: Record<InstrumentId, { label: string }> = {
  synth:   { label: "Synth" },
  piano:   { label: "Piano" },
  strings: { label: "Strings" },
  bells:   { label: "Bells" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPoly = Tone.PolySynth<any>;

function buildSynth(id: InstrumentId): AnyPoly {
  let p: AnyPoly;
  switch (id) {
    case "piano":
      p = new Tone.PolySynth(Tone.FMSynth);
      p.set({
        harmonicity: 2,
        modulationIndex: 8,
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 1.0, sustain: 0.2, release: 1.2 },
        modulation: { type: "square" },
        modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 0.5 },
      });
      break;
    case "strings":
      p = new Tone.PolySynth(Tone.AMSynth);
      p.set({
        harmonicity: 1.5,
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.4, decay: 0.1, sustain: 0.9, release: 1.5 },
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.5, decay: 0.1, sustain: 1, release: 0.5 },
      });
      break;
    case "bells":
      p = new Tone.PolySynth(Tone.FMSynth);
      p.set({
        harmonicity: 5.1,
        modulationIndex: 32,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 2.0, sustain: 0, release: 0.5 },
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 },
      });
      break;
    default:
      p = new Tone.PolySynth(Tone.Synth);
      p.set({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.5 },
      });
  }
  p.volume.value = -8;
  p.toDestination();
  return p;
}

// ─── Module state ─────────────────────────────────────────────────────────────

let synth: AnyPoly | null = null;
let currentInstrumentId: InstrumentId = "synth";
let playStartToneTime: number | null = null;

function getSynth(): AnyPoly {
  if (!synth) {
    synth = buildSynth(currentInstrumentId);
  }
  return synth;
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

const WHOLE_NOTE_FRACTION: Record<NoteDuration, number> = {
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  sixteenth: 1 / 16,
};

function durationInSeconds(
  note: Note,
  tempo: number,
  denominator: number,
): number {
  const beats = WHOLE_NOTE_FRACTION[note.duration] * denominator;
  const adjusted = note.dotted ? beats * 1.5 : beats;
  return adjusted * (60 / tempo);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function setInstrument(id: InstrumentId): void {
  currentInstrumentId = id;
  if (synth) {
    synth.releaseAll();
    synth.dispose();
    synth = null;
  }
  playStartToneTime = null;
}

export async function playScore(score: MusicScore): Promise<number> {
  await Tone.start();
  stopPlayback();

  const denominator = score.time_signature.denominator;
  const tempo = score.tempo;
  const s = getSynth();
  const now = Tone.now() + 0.05;
  playStartToneTime = now;

  let endTime = 0;
  for (const note of score.notes) {
    const startSec = note.start_beat * (60 / tempo);
    const durSec = durationInSeconds(note, tempo, denominator);
    if (note.pitch !== "rest") {
      s.triggerAttackRelease(note.pitch, durSec, now + startSec);
    }
    endTime = Math.max(endTime, startSec + durSec);
  }

  return endTime;
}

export function stopPlayback(): void {
  if (synth) {
    synth.releaseAll();
    synth.dispose();
    synth = null;
  }
  playStartToneTime = null;
}

export function getPlayheadSeconds(): number | null {
  if (playStartToneTime === null) return null;
  return Math.max(0, Tone.now() - playStartToneTime);
}

export function primeAudioContext(): void {
  Tone.start();
}

export async function preparePlayback(): Promise<number> {
  await Tone.start();
  if (synth) synth.releaseAll();
  const startTime = Tone.now() + 0.1;
  playStartToneTime = startTime;
  return startTime;
}

export function scheduleNote(
  note: Note,
  tempo: number,
  denominator: number,
  startToneTime: number,
): void {
  if (note.pitch === "rest") return;
  const startSec = note.start_beat * (60 / tempo);
  const durSec = durationInSeconds(note, tempo, denominator);
  const absTime = startToneTime + startSec;
  if (absTime > Tone.now()) {
    getSynth().triggerAttackRelease(note.pitch, durSec, absTime);
  }
}
