import asyncio
import json
import logging
from collections.abc import AsyncGenerator, Generator

from anthropic import Anthropic, AsyncAnthropic

from .config import settings
from .schema import (
    ArrangementPlan,
    MusicScore,
    Note,
    Track,
    TrackNotes,
    TrackSpec,
)

log = logging.getLogger(__name__)

_client = Anthropic(api_key=settings.anthropic_api_key)
_async_client = AsyncAnthropic(api_key=settings.anthropic_api_key)

# ─── Legacy single-track ──────────────────────────────────────────────────────

_TOOL_NAME = "render_music_score"

_SYSTEM_PROMPT = """You are a composer that writes short pieces of music.

When the user describes a piece, call the `render_music_score` tool with a complete score.

Composition guidelines:
- Keep pieces under ~32 beats unless the user asks for longer.
- Use scientific pitch notation: middle C is "C4", the A above is "A4", sharps are "C#4", flats are "Bb4".
- For rests, set pitch to the literal string "rest".
- Notes should be sequential: each note's start_beat should equal the previous note's start_beat plus its duration in beats.
- Stay diatonic to the chosen key unless the prompt suggests chromaticism.
- Pick a tempo and time signature that suit the requested style.
"""


def _tool_definition() -> dict:
    schema = MusicScore.model_json_schema()
    return {
        "name": _TOOL_NAME,
        "description": "Render a complete music score as structured data.",
        "input_schema": schema,
    }


def generate_score(prompt: str) -> MusicScore:
    log.info("generate_score: prompt=%r model=%s", prompt, settings.anthropic_model)
    response = _client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        tools=[_tool_definition()],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
        messages=[{"role": "user", "content": prompt}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == _TOOL_NAME:
            score = MusicScore.model_validate(block.input)
            log.info("generate_score: done title=%r notes=%d", score.title, len(score.notes))
            return score

    raise RuntimeError("Claude did not call the render_music_score tool.")


def stream_score(prompt: str) -> Generator[tuple[str, dict], None, None]:
    """Yield (event_type, data) tuples as notes arrive from the streaming response.

    Emits one "meta" event (title/tempo/key/time_signature) as soon as the
    notes array starts, then one "note" event per complete Note object.
    """
    pending = ""      # unconsumed portion of the notes-array JSON
    pending_scanned = 0  # how far into pending we've already scanned
    depth = 0         # brace depth inside the current note object
    note_start = -1
    notes_started = False
    full_accumulated = ""
    note_count = 0
    delta_count = 0

    log.info("stream_score: start prompt=%r model=%s", prompt, settings.anthropic_model)

    with _client.messages.stream(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        tools=[_tool_definition()],
        tool_choice={"type": "tool", "name": _TOOL_NAME},
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        for event in stream:
            if event.type != "content_block_delta":
                continue
            if not hasattr(event.delta, "partial_json"):
                continue

            chunk: str = event.delta.partial_json
            delta_count += 1

            if not notes_started:
                full_accumulated += chunk

                key_idx = full_accumulated.find('"notes"')
                if key_idx == -1:
                    continue
                bracket_idx = full_accumulated.find('[', key_idx)
                if bracket_idx == -1:
                    continue

                notes_started = True
                meta_json = full_accumulated[:key_idx] + '"notes":[]}'
                log.debug("stream_score: meta_json=%r", meta_json)
                try:
                    meta = json.loads(meta_json)
                    log.info(
                        "stream_score: meta title=%r tempo=%s key=%s",
                        meta.get("title"),
                        meta.get("tempo"),
                        meta.get("key_signature"),
                    )
                    yield "meta", {
                        k: meta[k]
                        for k in ("title", "tempo", "time_signature", "key_signature")
                        if k in meta
                    }
                except json.JSONDecodeError as exc:
                    log.warning("stream_score: meta parse failed: %s | raw=%r", exc, meta_json)

                pending = full_accumulated[bracket_idx + 1:]
                pending_scanned = 0
                log.info(
                    "stream_score: notes array opened; pending len=%d first=%r",
                    len(pending), pending[:80],
                )
            else:
                pending += chunk

            changed = True
            while changed:
                changed = False
                for rel_i, ch in enumerate(pending[pending_scanned:]):
                    i = rel_i + pending_scanned
                    if ch == "{":
                        if depth == 0:
                            note_start = i
                        depth += 1
                    elif ch == "}" and depth > 0:
                        depth -= 1
                        if depth == 0 and note_start >= 0:
                            note_json = pending[note_start : i + 1]
                            try:
                                note = Note.model_validate_json(note_json)
                                note_count += 1
                                log.info(
                                    "stream_score: note #%d pitch=%s beat=%s dur=%s",
                                    note_count, note.pitch, note.start_beat, note.duration,
                                )
                                yield "note", note.model_dump()
                            except Exception as exc:
                                log.warning("stream_score: note parse FAILED: %s | raw=%r", exc, note_json)
                            pending = pending[i + 1:]
                            pending_scanned = 0
                            note_start = -1
                            changed = True
                            break
                else:
                    pending_scanned = len(pending)

            if depth == 0 and note_start == -1:
                pending = ""
                pending_scanned = 0
            elif note_start > 0:
                pending_scanned = max(0, pending_scanned - note_start)
                pending = pending[note_start:]
                note_start = 0

    log.info(
        "stream_score: done deltas=%d notes_emitted=%d pending_leftover=%r",
        delta_count, note_count, pending[:80] if pending else "",
    )


# ─── Multi-track orchestration ────────────────────────────────────────────────

_PLAN_TOOL_NAME = "create_arrangement_plan"
_TRACK_TOOL_NAME = "render_track"

_PLAN_SYSTEM = """You are a musical arranger. Design a 3-track arrangement based on the user's request.

Always produce exactly 3 tracks with these IDs in this order: "melody", "harmony", "bass".

Track roles:
- melody: The main musical idea — singable, expressive. Use: synth, piano, strings, or bells.
- harmony: Chord pads or gentle arpeggios filling the harmonic space. Use: strings or piano.
- bass: The bass line anchoring the progression. Must use: bass_synth.

The chord_progression must be explicit and specific, e.g. "Am - F - C - G (repeat 4x)".
length_bars should be 8–16 unless the user specifies otherwise.
style_notes for each track should be brief but specific (register, rhythm feel, articulation).
"""


def _melody_system(plan: ArrangementPlan) -> str:
    total_beats = plan.length_bars * plan.time_signature.denominator
    return (
        "You are a composer writing the melody track for an arrangement.\n\n"
        "Use the render_track tool. Guidelines:\n"
        "- Write an expressive, singable melodic line.\n"
        "- Vary the rhythm — mix quarter, eighth, half, and dotted notes.\n"
        "- Stay diatonic to the key unless chromaticism is called for.\n"
        "- Notes must be sequential: each start_beat = previous start_beat + previous duration in beats.\n"
        f"- Total length ≈ {total_beats} beats ({plan.length_bars} bars × "
        f"{plan.time_signature.denominator} beats/bar).\n"
        "- End on a note that resolves the phrase.\n"
    )


def _harmony_system(plan: ArrangementPlan) -> str:
    total_beats = plan.length_bars * plan.time_signature.denominator
    return (
        "You are a composer writing the harmony/chord pad track.\n\n"
        "Use the render_track tool. Guidelines:\n"
        "- Play chord tones following the chord progression exactly.\n"
        "- Use long note values (half notes, dotted half, whole notes) for a lush pad sound.\n"
        "- Spread each chord across 3–4 voices in the mid range (C3–C5).\n"
        "- Each chord change should align with a beat boundary.\n"
        "- Sustain notes ring — avoid busy rhythmic patterns.\n"
        f"- Total length ≈ {total_beats} beats.\n"
    )


def _bass_system(plan: ArrangementPlan) -> str:
    total_beats = plan.length_bars * plan.time_signature.denominator
    return (
        "You are a composer writing the bass line track.\n\n"
        "Use the render_track tool. Guidelines:\n"
        "- Stay in the low register: C2–C3.\n"
        "- Emphasize root notes on downbeats; add passing tones on weak beats.\n"
        "- Mix quarter notes and half notes for rhythmic drive.\n"
        "- Follow the chord progression closely — root movement is the priority.\n"
        f"- Total length ≈ {total_beats} beats.\n"
    )


def _plan_tool() -> dict:
    return {
        "name": _PLAN_TOOL_NAME,
        "description": "Create a multi-track musical arrangement plan.",
        "input_schema": ArrangementPlan.model_json_schema(),
    }


def _track_tool() -> dict:
    return {
        "name": _TRACK_TOOL_NAME,
        "description": "Render all notes for this track.",
        "input_schema": TrackNotes.model_json_schema(),
    }


def _track_context(plan: ArrangementPlan, spec: TrackSpec) -> str:
    return (
        f"Arrangement:\n"
        f"  Title: {plan.title}\n"
        f"  Key: {plan.key_signature}\n"
        f"  Tempo: {plan.tempo} BPM\n"
        f"  Time: {plan.time_signature.numerator}/{plan.time_signature.denominator}\n"
        f"  Chord progression: {plan.chord_progression}\n"
        f"  Length: {plan.length_bars} bars\n\n"
        f"Your track role: {spec.role}\n"
        f"Style notes: {spec.style_notes}\n"
    )


async def _generate_plan(prompt: str) -> ArrangementPlan:
    log.info("_generate_plan: prompt=%r", prompt)
    response = await _async_client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1024,
        system=_PLAN_SYSTEM,
        tools=[_plan_tool()],
        tool_choice={"type": "tool", "name": _PLAN_TOOL_NAME},
        messages=[{"role": "user", "content": prompt}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == _PLAN_TOOL_NAME:
            plan = ArrangementPlan.model_validate(block.input)
            log.info(
                "_generate_plan: title=%r tempo=%d bars=%d chords=%r",
                plan.title, plan.tempo, plan.length_bars, plan.chord_progression,
            )
            return plan
    raise RuntimeError("Plan generation failed: Claude did not call the tool.")


async def _generate_track(plan: ArrangementPlan, spec: TrackSpec) -> list[Note]:
    if spec.id == "melody":
        system = _melody_system(plan)
    elif spec.id == "harmony":
        system = _harmony_system(plan)
    else:
        system = _bass_system(plan)

    log.info("_generate_track: track=%s instrument=%s", spec.id, spec.instrument)
    response = await _async_client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=system,
        tools=[_track_tool()],
        tool_choice={"type": "tool", "name": _TRACK_TOOL_NAME},
        messages=[{"role": "user", "content": _track_context(plan, spec)}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == _TRACK_TOOL_NAME:
            track_notes = TrackNotes.model_validate(block.input)
            log.info("_generate_track: track=%s notes=%d", spec.id, len(track_notes.notes))
            return track_notes.notes
    raise RuntimeError(f"Track generation failed for {spec.id}: Claude did not call the tool.")


def _parse_notes_from_stream(chunk: str, state: dict) -> list[Note]:
    """Incrementally parse Note objects from a partial JSON stream of a 'notes' array.

    state keys: pending, pending_scanned, depth, note_start, notes_started, full_accumulated
    Returns newly completed Note objects found in this chunk.
    """
    notes_out: list[Note] = []

    if not state["notes_started"]:
        state["full_accumulated"] += chunk
        key_idx = state["full_accumulated"].find('"notes"')
        if key_idx == -1:
            return notes_out
        bracket_idx = state["full_accumulated"].find('[', key_idx)
        if bracket_idx == -1:
            return notes_out
        state["notes_started"] = True
        state["pending"] = state["full_accumulated"][bracket_idx + 1:]
        state["pending_scanned"] = 0
    else:
        state["pending"] += chunk

    changed = True
    while changed:
        changed = False
        pending = state["pending"]
        for rel_i, ch in enumerate(pending[state["pending_scanned"]:]):
            i = rel_i + state["pending_scanned"]
            if ch == "{":
                if state["depth"] == 0:
                    state["note_start"] = i
                state["depth"] += 1
            elif ch == "}" and state["depth"] > 0:
                state["depth"] -= 1
                if state["depth"] == 0 and state["note_start"] >= 0:
                    note_json = pending[state["note_start"] : i + 1]
                    try:
                        notes_out.append(Note.model_validate_json(note_json))
                    except Exception as exc:
                        log.warning("note parse failed: %s | raw=%r", exc, note_json)
                    state["pending"] = pending[i + 1:]
                    state["pending_scanned"] = 0
                    state["note_start"] = -1
                    changed = True
                    break
        else:
            state["pending_scanned"] = len(state["pending"])

    if state["depth"] == 0 and state["note_start"] == -1:
        state["pending"] = ""
        state["pending_scanned"] = 0
    elif state["note_start"] > 0:
        state["pending_scanned"] = max(0, state["pending_scanned"] - state["note_start"])
        state["pending"] = state["pending"][state["note_start"]:]
        state["note_start"] = 0

    return notes_out


async def _stream_melody_to_queue(
    plan: ArrangementPlan,
    spec: TrackSpec,
    queue: asyncio.Queue,
) -> None:
    note_count = 0
    parse_state = {
        "pending": "",
        "pending_scanned": 0,
        "depth": 0,
        "note_start": -1,
        "notes_started": False,
        "full_accumulated": "",
    }
    try:
        async with _async_client.messages.stream(
            model=settings.anthropic_model,
            max_tokens=4096,
            system=_melody_system(plan),
            tools=[_track_tool()],
            tool_choice={"type": "tool", "name": _TRACK_TOOL_NAME},
            messages=[{"role": "user", "content": _track_context(plan, spec)}],
        ) as stream:
            async for event in stream:
                if event.type != "content_block_delta":
                    continue
                if not hasattr(event.delta, "partial_json"):
                    continue
                chunk: str = event.delta.partial_json
                for note in _parse_notes_from_stream(chunk, parse_state):
                    note_count += 1
                    log.info(
                        "melody note #%d pitch=%s beat=%s", note_count, note.pitch, note.start_beat
                    )
                    await queue.put(("track_note", {"track_id": spec.id, **note.model_dump()}))
    except Exception as exc:
        log.error("_stream_melody_to_queue error: %s", exc)
        await queue.put(("error", {"detail": f"Melody streaming failed: {exc}"}))
    finally:
        log.info("_stream_melody_to_queue: done, emitted %d notes", note_count)
        await queue.put(None)


async def _generate_track_to_queue(
    plan: ArrangementPlan,
    spec: TrackSpec,
    queue: asyncio.Queue,
) -> None:
    try:
        notes = await _generate_track(plan, spec)
        await queue.put(("track_complete", {
            "id": spec.id,
            "instrument": spec.instrument,
            "notes": [n.model_dump() for n in notes],
        }))
    except Exception as exc:
        log.error("_generate_track_to_queue %s error: %s", spec.id, exc)
        await queue.put(("error", {"detail": f"Track {spec.id} failed: {exc}"}))
    finally:
        await queue.put(None)


async def orchestrate_multi_track(prompt: str) -> AsyncGenerator[tuple[str, dict], None]:
    plan = await _generate_plan(prompt)

    melody_spec = next((t for t in plan.tracks if t.id == "melody"), None)
    harmony_spec = next((t for t in plan.tracks if t.id == "harmony"), None)
    bass_spec = next((t for t in plan.tracks if t.id == "bass"), None)

    if not melody_spec or not harmony_spec or not bass_spec:
        missing = [r for r, s in [("melody", melody_spec), ("harmony", harmony_spec), ("bass", bass_spec)] if not s]
        raise RuntimeError(f"Arrangement plan missing tracks: {missing}")

    yield "meta", {
        "title": plan.title,
        "tempo": plan.tempo,
        "time_signature": plan.time_signature.model_dump(),
        "key_signature": plan.key_signature,
        "tracks": [{"id": t.id, "instrument": t.instrument} for t in plan.tracks],
    }

    queue: asyncio.Queue = asyncio.Queue()
    tasks = [
        asyncio.create_task(_stream_melody_to_queue(plan, melody_spec, queue)),
        asyncio.create_task(_generate_track_to_queue(plan, harmony_spec, queue)),
        asyncio.create_task(_generate_track_to_queue(plan, bass_spec, queue)),
    ]

    remaining = len(tasks)
    try:
        while remaining > 0:
            item = await queue.get()
            if item is None:
                remaining -= 1
            else:
                yield item[0], item[1]
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
