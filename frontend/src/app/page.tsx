"use client";

import { useRef, useState } from "react";

import { PianoRoll } from "@/components/piano-roll";
import { streamScore } from "@/lib/api";
import {
  getPlayheadSeconds,
  playScore,
  preparePlayback,
  primeAudioContext,
  scheduleNote,
  stopPlayback,
} from "@/lib/player";
import type { MusicScore } from "@/lib/types";

// Duration as a fraction of a whole note — mirrors player.ts WHOLE_NOTE_FRACTION.
const DUR_FRAC: Record<string, number> = {
  whole: 1,
  half: 0.5,
  quarter: 0.25,
  eighth: 0.125,
  sixteenth: 0.0625,
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [score, setScore] = useState<MusicScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    primeAudioContext(); // synchronous — registers browser gesture before any awaits

    clearPlayTimeout();
    stopPlayback();
    setLoading(true);
    setError(null);
    setScore(null);
    setIsPlaying(false);

    let tempo = 120;
    let denominator = 4;
    let startTime: number | null = null;
    let lastEndSec = 0;

    try {
      for await (const event of streamScore(prompt)) {
        if (event.type === "meta") {
          tempo = event.data.tempo;
          denominator = event.data.time_signature.denominator;
          setScore({ ...event.data, notes: [] });
          startTime = await preparePlayback();
          setIsPlaying(true);
        } else if (event.type === "note" && startTime !== null) {
          const note = event.data;
          setScore((prev) =>
            prev ? { ...prev, notes: [...prev.notes, note] } : prev,
          );
          scheduleNote(note, tempo, denominator, startTime);
          const widthBeats =
            (DUR_FRAC[note.duration] ?? 0.25) *
            denominator *
            (note.dotted ? 1.5 : 1);
          const endSec = (note.start_beat + widthBeats) * (60 / tempo);
          if (endSec > lastEndSec) lastEndSec = endSec;
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
      const endTime = await playScore(score);
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
        placeholder="e.g. A short cheerful melody in C major, 8 bars long"
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
              {score.time_signature.numerator}/{score.time_signature.denominator}{" "}
              · {score.notes.length} notes
            </p>
          </div>
          <PianoRoll score={score} isPlaying={isPlaying} />
        </section>
      )}
    </main>
  );
}
