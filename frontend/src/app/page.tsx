"use client";

import { useRef, useState } from "react";

import { PianoRoll } from "@/components/piano-roll";
import { streamScore } from "@/lib/api";
import {
  getPlayheadSeconds,
  playMultiTrackScore,
  preparePlayback,
  primeAudioContext,
  registerTracks,
  scheduleCompletedTrack,
  scheduleTrackNote,
  stopPlayback,
} from "@/lib/player";
import type { MultiTrackScore, Track, TrackInstrument } from "@/lib/types";

const DUR_FRAC: Record<string, number> = {
  whole: 1,
  half: 0.5,
  quarter: 0.25,
  eighth: 0.125,
  sixteenth: 0.0625,
};

const TRACK_LABELS: Record<string, string> = {
  melody: "Melody",
  harmony: "Harmony",
  bass: "Bass",
};

const INSTRUMENT_LABELS: Record<string, string> = {
  synth: "Synth",
  piano: "Piano",
  strings: "Strings",
  bells: "Bells",
  bass_synth: "Bass Synth",
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [score, setScore] = useState<MultiTrackScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track which track ids have completed (for UI status)
  const [completedTracks, setCompletedTracks] = useState<Set<string>>(new Set());

  function clearPlayTimeout() {
    if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
  }

  function scheduleStop(endSec: number) {
    clearPlayTimeout();
    const elapsed = getPlayheadSeconds() ?? 0;
    const remaining = Math.max(0, endSec - elapsed);
    playTimeoutRef.current = setTimeout(
      () => setIsPlaying(false),
      remaining * 1000 + 200,
    );
  }

  async function onGenerate() {
    if (!prompt.trim()) return;

    primeAudioContext();

    clearPlayTimeout();
    stopPlayback();
    setLoading(true);
    setError(null);
    setScore(null);
    setIsPlaying(false);
    setCompletedTracks(new Set());

    let tempo = 120;
    let denominator = 4;
    let startTime: number | null = null;
    let lastEndSec = 0;

    // Track instruments from meta, needed for scheduleCompletedTrack
    const trackInstruments = new Map<string, TrackInstrument>();

    try {
      for await (const event of streamScore(prompt)) {
        if (event.type === "meta") {
          tempo = event.data.tempo;
          denominator = event.data.time_signature.denominator;

          // Register track instruments with the player before any notes arrive
          registerTracks(event.data.tracks);
          for (const t of event.data.tracks) {
            trackInstruments.set(t.id, t.instrument);
          }

          // Initialize score with empty track slots
          const emptyTracks: Track[] = event.data.tracks.map((t) => ({
            id: t.id as Track["id"],
            instrument: t.instrument,
            notes: [],
          }));
          setScore({
            title: event.data.title,
            tempo: event.data.tempo,
            time_signature: event.data.time_signature,
            key_signature: event.data.key_signature,
            tracks: emptyTracks,
          });

          startTime = await preparePlayback();
          setIsPlaying(true);

        } else if (event.type === "track_note" && startTime !== null) {
          const { track_id, ...note } = event.data;

          setScore((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              tracks: prev.tracks.map((t) =>
                t.id === track_id ? { ...t, notes: [...t.notes, note] } : t,
              ),
            };
          });

          scheduleTrackNote(track_id, note, tempo, denominator, startTime);

          const widthBeats =
            (DUR_FRAC[note.duration] ?? 0.25) * denominator * (note.dotted ? 1.5 : 1);
          const endSec = (note.start_beat + widthBeats) * (60 / tempo);
          if (endSec > lastEndSec) lastEndSec = endSec;

        } else if (event.type === "track_complete") {
          const track = event.data;

          setScore((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              tracks: prev.tracks.map((t) => (t.id === track.id ? track : t)),
            };
          });
          setCompletedTracks((prev) => new Set([...prev, track.id]));

          // Schedule future notes for this track (past notes are silently skipped)
          if (startTime !== null) {
            scheduleCompletedTrack(track, tempo, denominator, startTime);
            for (const note of track.notes) {
              const widthBeats =
                (DUR_FRAC[note.duration] ?? 0.25) * denominator * (note.dotted ? 1.5 : 1);
              const endSec = (note.start_beat + widthBeats) * (60 / tempo);
              if (endSec > lastEndSec) lastEndSec = endSec;
            }
          }
        }
      }

      if (startTime !== null) scheduleStop(lastEndSec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  async function onPlay() {
    if (!score) return;
    clearPlayTimeout();
    try {
      setIsPlaying(true);
      const endTime = await playMultiTrackScore(score);
      scheduleStop(endTime);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsPlaying(false);
    }
  }

  function onStop() {
    clearPlayTimeout();
    stopPlayback();
    setIsPlaying(false);
  }

  const totalNotes = score?.tracks.reduce((sum, t) => sum + t.notes.length, 0) ?? 0;

  return (
    <main className="flex flex-1 flex-col w-full max-w-3xl mx-auto px-6 py-12 gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Symphony AI</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Describe a piece. Claude composes it. Tone.js plays it.
        </p>
      </header>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. A melancholic piece in A minor, 8 bars, with a flowing melody"
        rows={4}
        disabled={loading}
        className="w-full p-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
      />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onGenerate}
          disabled={loading || !prompt.trim()}
          className="px-4 py-2 rounded-lg bg-foreground text-background font-medium disabled:opacity-50"
        >
          {loading ? "Composing…" : "Generate"}
        </button>
        <button
          onClick={onPlay}
          disabled={!score || loading || isPlaying}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50"
        >
          Play
        </button>
        <button
          onClick={onStop}
          disabled={!score || !isPlaying}
          className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 disabled:opacity-50"
        >
          Stop
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {score && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold">{score.title}</h2>
            <p className="text-sm text-zinc-500 mt-1">
              {score.key_signature} · {score.tempo} BPM ·{" "}
              {score.time_signature.numerator}/{score.time_signature.denominator} · {totalNotes} notes
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {score.tracks.map((track) => {
              const done = completedTracks.has(track.id) || !loading;
              return (
                <div
                  key={track.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    done
                      ? TRACK_CHIP_DONE[track.id] ?? "border-zinc-600 text-zinc-300 bg-zinc-800"
                      : "border-zinc-700 text-zinc-500 bg-zinc-900"
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: TRACK_COLORS[track.id] ?? "#818cf8" }}
                  />
                  {TRACK_LABELS[track.id] ?? track.id}
                  <span className="opacity-60">
                    · {INSTRUMENT_LABELS[track.instrument] ?? track.instrument}
                  </span>
                  {track.notes.length > 0 && (
                    <span className="opacity-50">· {track.notes.length}</span>
                  )}
                </div>
              );
            })}
          </div>

          <PianoRoll score={score} isPlaying={isPlaying} />
        </section>
      )}
    </main>
  );
}

const TRACK_COLORS: Record<string, string> = {
  melody: "#818cf8",
  harmony: "#34d399",
  bass: "#f59e0b",
};

const TRACK_CHIP_DONE: Record<string, string> = {
  melody: "border-indigo-700 text-indigo-300 bg-indigo-950/60",
  harmony: "border-emerald-700 text-emerald-300 bg-emerald-950/60",
  bass: "border-amber-700 text-amber-300 bg-amber-950/60",
};
