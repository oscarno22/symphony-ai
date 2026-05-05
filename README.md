# Symphony AI

AI-powered music generation. Describe a piece in natural language; Claude composes it as structured JSON; the browser plays it via Tone.js.

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

Open [http://localhost:3000](http://localhost:3000), enter a prompt (e.g. *"A slow melancholic 8-bar melody in A minor"*), click **Generate**, then **Play**.

## How it works

1. Frontend `POST /generate` with `{ prompt }`.
2. Backend calls Claude with a tool definition derived from the `MusicScore` Pydantic model. `tool_choice` forces Claude to return structured input matching the schema.
3. Pydantic validates the tool input and returns a `MusicScore` JSON: title, tempo, time signature, key, and a list of notes (`pitch`, `duration`, `start_beat`, optional `dotted`).
4. Frontend feeds the score into a Tone.js `PolySynth`, scheduling each note at `start_beat × (60 / tempo)` seconds.

## Project structure

```
backend/
  app/
    schema.py    # Pydantic music model
    claude.py    # Anthropic client + tool definition
    config.py    # pydantic-settings (.env loader)
    main.py      # FastAPI app, /health, /generate
frontend/
  src/
    app/page.tsx # Prompt UI, Generate / Play / Stop
    lib/
      api.ts     # fetch wrapper
      player.ts  # Tone.js scheduling
      types.ts   # mirror of MusicScore
```

## Roadmap

- VexFlow sheet rendering
- Multi-track / multi-instrument schema
- Dynamics, articulation, ties
- MIDI export (server-side via `pretty_midi` or `music21`)
- "Regenerate with variation" action
