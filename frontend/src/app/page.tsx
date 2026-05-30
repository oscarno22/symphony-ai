"use client";

import { useRef, useState } from "react";

import { PianoRoll } from "@/components/piano-roll";
import { generateScore } from "@/lib/api";
import { playScore, stopPlayback } from "@/lib/player";
import type { MusicScore } from "@/lib/types";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [score, setScore] = useState<MusicScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function onGenerate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setScore(null);
    stopPlayback();
    setIsPlaying(false);
    if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
    try {
      const result = await generateScore(prompt);
      setScore(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onPlay() {
    if (!score) return;
    if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
    try {
      setIsPlaying(true);
      const endTime = await playScore(score);
      playTimeoutRef.current = setTimeout(
        () => setIsPlaying(false),
        endTime * 1000 + 200,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsPlaying(false);
    }
  }

  function onStop() {
    if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
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
