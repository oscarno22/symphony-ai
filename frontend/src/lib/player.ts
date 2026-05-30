import * as Tone from "tone";

import type { MusicScore, Note, NoteDuration } from "./types";

const WHOLE_NOTE_FRACTION: Record<NoteDuration, number> = {
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  sixteenth: 1 / 16,
};

let synth: Tone.PolySynth | null = null;
let playStartToneTime: number | null = null;

function getSynth(): Tone.PolySynth {
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth).toDestination();
    synth.volume.value = -8;
  }
  return synth;
}

function durationInSeconds(
  note: Note,
  tempo: number,
  denominator: number,
): number {
  const beats = WHOLE_NOTE_FRACTION[note.duration] * denominator;
  const adjusted = note.dotted ? beats * 1.5 : beats;
  return adjusted * (60 / tempo);
}

function startInSeconds(note: Note, tempo: number): number {
  return note.start_beat * (60 / tempo);
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
    const startSec = startInSeconds(note, tempo);
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
  }
  playStartToneTime = null;
}

export function getPlayheadSeconds(): number | null {
  if (playStartToneTime === null) return null;
  return Math.max(0, Tone.now() - playStartToneTime);
}
