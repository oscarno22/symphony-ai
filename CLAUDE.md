# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend (from backend/)
uv sync
uv run uvicorn app.main:app --reload      # :8000, auto-reload

# Frontend (from frontend/)
npm install
npm run dev                                # :3000
npm run build
npm run lint
```

Backend env: copy `backend/.env.example` → `backend/.env`, then set `ANTHROPIC_API_KEY`.
Frontend env: `frontend/.env.local` sets `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).

There are no tests yet.

## Architecture

### Request flow

1. User submits a natural-language prompt → `POST /generate`
2. FastAPI (`main.py`) delegates to `claude.py`
3. `claude.py` calls Claude with **forced tool use**: `tool_choice={"type":"tool","name":"render_music_score"}` — Claude *must* return a structured `MusicScore` object, never free text
4. The tool's `input_schema` is generated directly from the Pydantic `MusicScore` model via `model_json_schema()`, so the schema is the single source of truth
5. Pydantic validates the tool input; the validated object is returned as JSON
6. Frontend receives `MusicScore` and schedules playback via Tone.js `PolySynth`

### Schema: the contract between backend and frontend

`backend/app/schema.py` defines the canonical `MusicScore` model. `frontend/src/lib/types.ts` is a hand-maintained TypeScript mirror — keep them in sync whenever the schema changes.

Key fields:
- `notes[].start_beat` — onset in beats from beat 0 (not cumulative delta)
- `notes[].pitch` — scientific notation (`"C4"`, `"F#5"`, `"Bb3"`) or `"rest"`
- `notes[].dotted` — multiplies duration by 1.5

### Tone.js playback (`frontend/src/lib/player.ts`)

A singleton `PolySynth` is lazily created and reused across calls. `playScore` calls `Tone.start()` (required by browsers to unlock the AudioContext), then schedules every non-rest note with `triggerAttackRelease`. Start time = `start_beat × (60 / tempo)` seconds; duration is computed from the duration name and the time-signature denominator.

### Configuration (`backend/app/config.py`)

`pydantic-settings` loads from `backend/.env`. The model is configurable via `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`). CORS origin is controlled by `CORS_ORIGIN` (default `http://localhost:3000`).

## Next.js version note

The frontend uses Next.js 16 with breaking API changes vs. training data. Before writing frontend code, read `frontend/AGENTS.md` — it points to the in-tree docs at `node_modules/next/dist/docs/`.
