import type { MusicScore, Note } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ScoreMeta = Omit<MusicScore, "notes">;
export type StreamEvent =
  | { type: "meta"; data: ScoreMeta }
  | { type: "note"; data: Note };

export async function generateScore(prompt: string): Promise<MusicScore> {
  const res = await fetch(`${API_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Generation failed (${res.status} ${res.statusText})${text ? `: ${text}` : ""}`,
    );
  }

  return (await res.json()) as MusicScore;
}

export async function* streamScore(
  prompt: string,
): AsyncGenerator<StreamEvent> {
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
            yield { type: "meta", data: JSON.parse(raw) as ScoreMeta };
          } else if (currentEvent === "note") {
            yield { type: "note", data: JSON.parse(raw) as Note };
          } else if (currentEvent === "done" || currentEvent === "error") {
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
