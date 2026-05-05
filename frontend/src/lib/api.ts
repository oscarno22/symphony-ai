import type { MusicScore } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
