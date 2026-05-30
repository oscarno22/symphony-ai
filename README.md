# Symphony AI

AI-powered music generation. Describe a piece in natural language; Claude composes it as structured JSON; the browser plays it via Tone.js with a live piano roll.

## Stack

- **Backend** — FastAPI, Anthropic Python SDK (forced tool use), Pydantic, `uv`
- **Frontend** — Next.js 16 (App Router), TypeScript, Tailwind 4, Tone.js
- **Model** — `claude-sonnet-4-6` (configurable via `ANTHROPIC_MODEL`)

## Prerequisites

- Python 3.14+ and [`uv`](https://github.com/astral-sh/uv)
- Node.js 20.9+ and npm
- An Anthropic API key with credit balance

## Setup

```bash
# Backend
cd backend
uv sync
cp .env.example .env  # then add your real ANTHROPIC_API_KEY

# Frontend
cd ../frontend
npm install
```

The frontend reads `NEXT_PUBLIC_API_URL` from `.env.local` (defaults to `http://localhost:8000`).

## Run

```bash
# Terminal 1 — backend on :8000
cd backend
uv run uvicorn app.main:app --reload

# Terminal 2 — frontend on :3000
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a prompt (e.g. *"A slow melancholic 8-bar melody in A minor"*) and click **Generate**. Playback starts automatically as notes stream in.

## How it works

1. Frontend `POST /stream` with `{ prompt }` and opens a Server-Sent Events connection.
2. Backend calls Claude with `tool_choice` forced to `render_music_score`. The tool's `input_schema` is generated directly from the `MusicScore` Pydantic model.
3. As Claude streams the tool input JSON, the backend parses it incrementally — emitting a `meta` event (title, tempo, key, time signature) as soon as those fields arrive, then one `note` event per complete note object.
4. The frontend starts Tone.js playback immediately on the `meta` event and schedules each note as it arrives, so music begins before the full score is generated.
5. A piano roll renders in real time alongside playback, with an animated red playhead.

The `/generate` endpoint also exists for non-streaming use (returns the full `MusicScore` JSON in one response).

## Features

- **Progressive streaming** — playback starts mid-generation, not after
- **Piano roll** — scrollable SVG visualization with black/white key shading, measure grid, and animated playhead
- **Instrument selection** — Synth, Piano, Strings, Bells (each a differently-configured `PolySynth`)
- **Stop** — cancels both the UI playhead and all Web Audio scheduled events immediately

## Project structure

```
backend/
  app/
    schema.py      # Pydantic MusicScore / Note models (single source of truth)
    claude.py      # Anthropic client, tool definition, streaming note parser
    config.py      # pydantic-settings (.env loader)
    main.py        # FastAPI app — /health, /generate, /stream (SSE)
frontend/
  src/
    app/page.tsx         # Prompt UI, Generate / Play / Stop, instrument picker
    components/
      piano-roll.tsx     # Animated SVG piano roll
    lib/
      api.ts             # fetch wrappers (generateScore, streamScore async generator)
      player.ts          # Tone.js scheduling, instrument management, playhead
      types.ts           # TypeScript mirror of MusicScore / Note
```

## Roadmap

- VexFlow sheet rendering
- Multi-track / multi-instrument schema
- Dynamics, articulation, ties
- MIDI export (server-side via `pretty_midi` or `music21`)
- "Regenerate with variation" action
