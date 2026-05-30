import type { Note, Track, TrackInstrument } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type MultiTrackMeta = {
  title: string;
  tempo: number;
  time_signature: { numerator: number; denominator: number };
  key_signature: string;
  tracks: { id: string; instrument: TrackInstrument }[];
};

export type TrackNoteData = Note & { track_id: string };

export type StreamEvent =
  | { type: "meta"; data: MultiTrackMeta }
  | { type: "track_note"; data: TrackNoteData }
  | { type: "track_complete"; data: Track };

export async function* streamScore(prompt: string): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${API_URL}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Stream failed (${res.status} ${res.statusText})${text ? `: ${text}` : ""}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          if (currentEvent === "meta") {
            yield { type: "meta", data: JSON.parse(raw) as MultiTrackMeta };
          } else if (currentEvent === "track_note") {
            yield { type: "track_note", data: JSON.parse(raw) as TrackNoteData };
          } else if (currentEvent === "track_complete") {
            yield { type: "track_complete", data: JSON.parse(raw) as Track };
          } else if (currentEvent === "error") {
            const parsed = JSON.parse(raw) as { detail?: string };
            throw new Error(parsed.detail ?? "Unknown stream error");
          } else if (currentEvent === "done") {
            return;
          }
          currentEvent = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
