"use client";

import { useEffect, useRef } from "react";

import { getPlayheadSeconds } from "@/lib/player";
import type { MultiTrackScore } from "@/lib/types";

const PX_PER_BEAT = 40;
const PX_PER_SEMI = 12;
const PADDING_SEMI = 3;
const LEFT_MARGIN = 36;
const NOTE_RADIUS = 2;

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const PITCH_MAP: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const DUR_FRAC: Record<string, number> = {
  whole: 1, half: 0.5, quarter: 0.25, eighth: 0.125, sixteenth: 0.0625,
};

const TRACK_COLORS: Record<string, string> = {
  melody: "#818cf8",
  harmony: "#34d399",
  bass: "#f59e0b",
};

function parseMidi(pitch: string): number | null {
  if (pitch === "rest") return null;
  const m = pitch.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const pc = PITCH_MAP[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

function widthBeats(note: { duration: string; dotted?: boolean }, denom: number): number {
  const base = DUR_FRAC[note.duration] * denom;
  return note.dotted ? base * 1.5 : base;
}

export function PianoRoll({
  score,
  isPlaying,
}: {
  score: MultiTrackScore;
  isPlaying: boolean;
}) {
  const playheadRef = useRef<SVGLineElement>(null);
  const rafRef = useRef<number>(0);
  const { tempo, time_signature: { numerator, denominator } } = score;

  // Collect all notes across all tracks for range + total beats
  const allNotes = score.tracks.flatMap((t) => t.notes.map((n) => ({ ...n, trackId: t.id })));

  const midis = allNotes
    .map((n) => parseMidi(n.pitch))
    .filter((m): m is number => m !== null);

  const maxMidi = midis.length > 0 ? Math.max(...midis) + PADDING_SEMI : 60 + PADDING_SEMI;
  const minMidi = midis.length > 0 ? Math.min(...midis) - PADDING_SEMI : 60 - PADDING_SEMI;
  const numSemis = maxMidi - minMidi + 1;

  let totalBeats = 0;
  for (const n of allNotes) {
    const end = n.start_beat + widthBeats(n, denominator);
    if (end > totalBeats) totalBeats = end;
  }
  totalBeats = Math.max(Math.ceil(totalBeats), 4);

  const W = LEFT_MARGIN + totalBeats * PX_PER_BEAT;
  const H = numSemis * PX_PER_SEMI;

  function midiY(midi: number) {
    return (maxMidi - midi) * PX_PER_SEMI;
  }

  useEffect(() => {
    const el = playheadRef.current;
    if (!isPlaying) {
      if (el) {
        el.setAttribute("x1", "-9999");
        el.setAttribute("x2", "-9999");
      }
      return;
    }
    function tick() {
      const secs = getPlayheadSeconds();
      if (secs !== null && playheadRef.current) {
        const x = String(LEFT_MARGIN + (secs * tempo / 60) * PX_PER_BEAT);
        playheadRef.current.setAttribute("x1", x);
        playheadRef.current.setAttribute("x2", x);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, tempo]);

  if (midis.length === 0) return null;

  const bgRows = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const pc = ((midi % 12) + 12) % 12;
    const y = midiY(midi);
    bgRows.push(
      <rect
        key={`r${midi}`}
        x={LEFT_MARGIN}
        y={y}
        width={totalBeats * PX_PER_BEAT}
        height={PX_PER_SEMI}
        fill={BLACK_KEYS.has(pc) ? "#18181b" : "#27272a"}
      />,
    );
    if (pc === 0) {
      const oct = Math.floor(midi / 12) - 1;
      bgRows.push(
        <text
          key={`l${midi}`}
          x={LEFT_MARGIN - 4}
          y={y + PX_PER_SEMI - 2}
          textAnchor="end"
          fontSize={8}
          fill="#71717a"
        >
          C{oct}
        </text>,
      );
    }
  }

  const gridLines = [];
  for (let b = 0; b <= totalBeats; b++) {
    const x = LEFT_MARGIN + b * PX_PER_BEAT;
    const isMeasure = b % numerator === 0;
    gridLines.push(
      <line
        key={`g${b}`}
        x1={x}
        y1={0}
        x2={x}
        y2={H}
        stroke={isMeasure ? "#52525b" : "#3f3f46"}
        strokeWidth={isMeasure ? 1 : 0.5}
      />,
    );
  }

  // Render tracks back-to-front: bass → harmony → melody (melody on top)
  const trackOrder = ["bass", "harmony", "melody"];
  const sortedTracks = [...score.tracks].sort(
    (a, b) => trackOrder.indexOf(a.id) - trackOrder.indexOf(b.id),
  );

  const noteRects = sortedTracks.flatMap((track) => {
    const color = TRACK_COLORS[track.id] ?? "#818cf8";
    return track.notes
      .filter((n) => n.pitch !== "rest")
      .map((n, i) => {
        const midi = parseMidi(n.pitch);
        if (midi === null) return null;
        const x = LEFT_MARGIN + n.start_beat * PX_PER_BEAT;
        const w = Math.max(3, widthBeats(n, denominator) * PX_PER_BEAT - 2);
        const y = midiY(midi) + 1;
        return (
          <rect
            key={`${track.id}-${i}`}
            x={x}
            y={y}
            width={w}
            height={PX_PER_SEMI - 2}
            rx={NOTE_RADIUS}
            fill={color}
            opacity={track.id === "harmony" ? 0.7 : 1}
          />
        );
      });
  });

  return (
    <div
      className="overflow-x-auto rounded-lg border border-zinc-700"
      style={{ background: "#18181b" }}
    >
      <svg width={W} height={H} style={{ display: "block", minWidth: "100%" }}>
        {bgRows}
        {gridLines}
        {noteRects}
        <line
          ref={playheadRef}
          x1={-9999}
          y1={0}
          x2={-9999}
          y2={H}
          stroke="#ef4444"
          strokeWidth={2}
        />
      </svg>
    </div>
  );
}
