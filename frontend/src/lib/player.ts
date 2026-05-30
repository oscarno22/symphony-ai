import * as Tone from "tone";

import type { MultiTrackScore, Note, NoteDuration, Track, TrackInstrument } from "./types";

// ─── Instrument definitions ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPoly = Tone.PolySynth<any>;

const TRACK_VOLUMES: Record<string, number> = {
  melody: -4,
  harmony: -16,
  bass: -10,
};

function buildSynth(instrument: TrackInstrument, trackId: string): AnyPoly {
  let p: AnyPoly;
  switch (instrument) {
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
        envelope: { attack: 0.5, decay: 0.1, sustain: 0.9, release: 2.0 },
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
    case "bass_synth":
      p = new Tone.PolySynth(Tone.Synth);
      p.set({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.02, decay: 0.4, sustain: 0.7, release: 0.6 },
      });
      break;
    default: // "synth"
      p = new Tone.PolySynth(Tone.Synth);
      p.set({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.5 },
      });
  }
  p.volume.value = TRACK_VOLUMES[trackId] ?? -8;
  p.toDestination();
  return p;
}

// ─── Module state ─────────────────────────────────────────────────────────────

const _trackSynths = new Map<string, AnyPoly>();
let _playStartToneTime: number | null = null;

// instrument assigned to each track at meta time, used for lazy synth creation
const _trackInstruments = new Map<string, TrackInstrument>();

function getOrCreateSynth(trackId: string): AnyPoly {
  const existing = _trackSynths.get(trackId);
  if (existing) return existing;
  const instrument = _trackInstruments.get(trackId) ?? "synth";
  const s = buildSynth(instrument, trackId);
  _trackSynths.set(trackId, s);
  return s;
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

const WHOLE_NOTE_FRACTION: Record<NoteDuration, number> = {
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  sixteenth: 1 / 16,
};

function durationInSeconds(note: Note, tempo: number, denominator: number): number {
  const beats = WHOLE_NOTE_FRACTION[note.duration] * denominator;
  const adjusted = note.dotted ? beats * 1.5 : beats;
  return adjusted * (60 / tempo);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Register which instrument each track should use. Call this when meta arrives. */
export function registerTracks(tracks: { id: string; instrument: TrackInstrument }[]): void {
  for (const t of tracks) {
    _trackInstruments.set(t.id, t.instrument);
  }
}

export async function playMultiTrackScore(score: MultiTrackScore): Promise<number> {
  await Tone.start();
  stopPlayback();

  const { tempo, time_signature: { denominator } } = score;
  const now = Tone.now() + 0.05;
  _playStartToneTime = now;

  let endTime = 0;
  for (const track of score.tracks) {
    _trackInstruments.set(track.id, track.instrument);
    const s = getOrCreateSynth(track.id);
    for (const note of track.notes) {
      if (note.pitch === "rest") continue;
      const startSec = note.start_beat * (60 / tempo);
      const durSec = durationInSeconds(note, tempo, denominator);
      s.triggerAttackRelease(note.pitch, durSec, now + startSec);
      endTime = Math.max(endTime, startSec + durSec);
    }
  }

  return endTime;
}

export function stopPlayback(): void {
  for (const [, s] of _trackSynths) {
    s.releaseAll();
    s.dispose();
  }
  _trackSynths.clear();
  _playStartToneTime = null;
}

export function getPlayheadSeconds(): number | null {
  if (_playStartToneTime === null) return null;
  return Math.max(0, Tone.now() - _playStartToneTime);
}

export function primeAudioContext(): void {
  Tone.start();
}

export async function preparePlayback(): Promise<number> {
  await Tone.start();
  for (const [, s] of _trackSynths) {
    s.releaseAll();
  }
  const startTime = Tone.now() + 0.1;
  _playStartToneTime = startTime;
  return startTime;
}

/** Schedule a single note for a track. Used during streaming. */
export function scheduleTrackNote(
  trackId: string,
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
    getOrCreateSynth(trackId).triggerAttackRelease(note.pitch, durSec, absTime);
  }
}

/** Schedule all future notes for a completed track. Used when track_complete arrives mid-stream. */
export function scheduleCompletedTrack(
  track: Track,
  tempo: number,
  denominator: number,
  startToneTime: number,
): void {
  _trackInstruments.set(track.id, track.instrument);
  for (const note of track.notes) {
    scheduleTrackNote(track.id, note, tempo, denominator, startToneTime);
  }
}
